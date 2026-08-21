package handlers

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"photoflow-backend/middleware"
	"photoflow-backend/models"
)

// fetchDrivePhotos menarik daftar foto sebuah folder memakai kredensial Drive
// milik user, lalu memetakannya ke baris siap simpan.
//
// Sebelumnya folder ditarik lewat GOOGLE_API_KEY, yang hanya berhasil untuk
// folder yang dibagikan publik, dan pembacaan galeri memakai service account
// bersama. Keduanya kini digantikan kredensial pemilik project, sehingga hanya
// ada satu sumber kebenaran untuk "siapa yang boleh membaca folder ini".
//
// ok bernilai false kalau folder tidak dapat dibaca, sehingga pemanggil bisa
// memutuskan sendiri nasib foto yang sudah tersimpan.
func (h *Handler) fetchDrivePhotos(ctx context.Context, userID, folderID, projectID string) (photos []models.Photo, ok bool) {
	store, err := h.StoreForUser(ctx, userID)
	if err != nil {
		log.Printf("[WARN] Drive tidak tersedia untuk user %s: %v", userID, err)
		return nil, false
	}

	files, err := store.ListPhotos(ctx, folderID)
	if err != nil {
		log.Printf("[WARN] Gagal membaca folder Drive %s: %v", folderID, err)
		return nil, false
	}

	for _, file := range files {
		photos = append(photos, models.Photo{
			ProjectID:    projectID,
			FileName:     file.Name,
			ThumbnailURL: store.ThumbnailURL(file),
		})
	}
	return photos, true
}

// CreateProject membuat project baru lalu menarik daftar fotonya dari Drive.
func (h *Handler) CreateProject(c *gin.Context) {
	userID := c.GetString(middleware.ContextUserIDKey)

	var input models.CreateProjectInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "That input is not valid"})
		return
	}

	folderID := extractDriveFolderID(input.DriveFolderURL)
	if folderID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "That Google Drive link is not valid"})
		return
	}

	magicLink, err := generateMagicLink()
	if err != nil {
		log.Printf("[ERROR] %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not create the project"})
		return
	}

	newProject := models.Project{
		ProjectName:    input.ProjectName,
		ClientName:     input.ClientName,
		MaxSelections:  input.MaxSelections,
		DriveFolderURL: input.DriveFolderURL,
		DriveFolderID:  folderID,
		UserID:         userID,
		AdminWhatsApp:  input.AdminWhatsApp,
		ClientWhatsApp: input.ClientWhatsApp,
		MagicLinkToken: magicLink,
	}
	if newProject.MaxSelections == 0 {
		newProject.MaxSelections = 50
	}

	// Kuota diperiksa dan dipakai DI DALAM transaksi yang menyimpan project.
	//
	// Memeriksa dulu di luar transaksi lalu menyimpan kemudian akan menyisakan
	// celah: dua permintaan bersamaan sama-sama membaca "masih ada sisa satu"
	// sebelum salah satunya sempat menaikkan penghitung, dan keduanya lolos.
	// Di sini penghitungnya dinaikkan lebih dulu secara atomik, dan kalau nilai
	// barunya melewati kuota seluruh transaksi dibatalkan — project tidak
	// tersimpan, dan jatah yang tadi naik ikut kembali.
	sekarang := time.Now().UTC()
	sub, err := langganan(h.DB, userID)
	if err != nil {
		log.Printf("[ERROR] Membaca langganan user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not save the project"})
		return
	}

	err = h.DB.Transaction(func(tx *gorm.DB) error {
		if err := pakaiKuotaGaleri(tx, userID, sub.KuotaBulanan(sekarang), sekarang); err != nil {
			return err
		}
		return tx.Create(&newProject).Error
	})
	switch {
	case errors.Is(err, ErrKuotaHabis):
		// 402, bukan 403. Yang menghalangi bukan izin melainkan pembayaran, dan
		// kodenya membuat frontend dapat membedakan "Anda tidak boleh" dari
		// "jatah bulan ini habis, ini caranya menambah".
		kuota := sub.KuotaBulanan(sekarang)
		c.JSON(http.StatusPaymentRequired, gin.H{
			"error": fmt.Sprintf(
				"Jatah %d galeri bulan ini sudah terpakai. Perpanjang paket untuk membuat lagi.", kuota),
			"code":  "quota_exceeded",
			"plan":  sub.PlanEfektif(sekarang),
			"quota": kuota,
		})
		return
	case err != nil:
		log.Printf("[ERROR] Menyimpan project untuk user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not save the project"})
		return
	}

	// Balasan dikirim TANPA menunggu Drive.
	//
	// Sebelumnya pembuatan project menarik seluruh daftar foto lebih dulu.
	// Untuk folder berisi 2.000 berkas itu dua halaman berurutan ke Google —
	// beberapa detik ketika yang sebenarnya diminta orangnya cuma satu baris
	// project, dan barisnya sudah tersimpan pada saat ini.
	//
	// Penarikan fotonya dipindahkan ke permintaan kedua: frontend memanggil
	// /resync sesudah formulirnya tertutup. Endpoint itu sudah ada, sudah
	// dipakai, dan sudah menangani folder yang tidak terbaca.
	//
	// Ongkos yang diterima: kegagalan membaca folder tidak lagi muncul saat
	// tombol ditekan, melainkan beberapa detik sesudahnya. Sebagai gantinya
	// tombolnya tidak pernah menggantung, dan project yang folder-nya belum
	// siap tetap tersimpan alih-alih hilang bersama kegagalannya.
	c.JSON(http.StatusCreated, gin.H{
		"message": "Project created.",
		"data":    newProject,
		// Frontend memakainya sebagai tanda bahwa daftar foto masih harus
		// ditarik, dan menampilkan "Syncing photos..." sampai selesai.
		"needs_sync": true,
	})
}

// markSynced mencatat bahwa daftar foto project baru saja ditarik dari
// Drive.
//
// Galeri klien memakai penanda ini untuk memutuskan kapan salinannya layak
// disegarkan. Tanpa penanda, setiap kunjungan akan menyimpulkan salinannya
// belum pernah ada dan kembali membaca Drive — persis yang hendak dihentikan.
func markSynced(db *gorm.DB, projectID string) error {
	return db.Model(&models.Project{}).
		Where("id = ?", projectID).
		Update("photos_synced_at", time.Now().UTC()).Error
}

// ListProjects mengembalikan project milik pemanggil saja.
//
// Jumlah foto ikut dihitung. Tanpa itu dashboard tidak punya cara membedakan
// project yang fotonya berhasil ditarik dari project yang kosong karena Drive
// tidak terbaca — dan kartunya selama ini menampilkan `max_selections`, yaitu
// batas yang diketik fotografer, bukan berapa foto yang benar-benar ada.
func (h *Handler) ListProjects(c *gin.Context) {
	userID := c.GetString(middleware.ContextUserIDKey)

	var projects []models.Project
	// Ambil semua project dari database, urutkan dari yang paling baru dibuat
	if err := h.DB.Where("user_id = ?", userID).Order("created_at desc").Find(&projects).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not load your projects"})
		return
	}

	c.JSON(http.StatusOK, h.withPhotoCounts(projects))
}

// projectWithCount adalah baris project ditambah jumlah fotonya.
type projectWithCount struct {
	models.Project
	PhotoCount int64 `json:"photo_count"`
	// Beberapa thumbnail pertama, untuk ditampilkan di kartu project.
	//
	// Dashboard sebelumnya tidak memuat satu foto pun — hanya ikon folder di
	// aplikasi yang seluruh isinya fotografi. Selain membuatnya terlihat
	// seperti dashboard mana pun, itu juga membuang cara tercepat mengenali
	// sebuah project: melihat isinya.
	Previews []string `json:"previews"`
}

// withPhotoCounts menghitung foto untuk sekumpulan project dalam satu query,
// bukan satu query per project.
func (h *Handler) withPhotoCounts(projects []models.Project) []projectWithCount {
	out := make([]projectWithCount, 0, len(projects))
	if len(projects) == 0 {
		return out
	}

	ids := make([]string, 0, len(projects))
	for _, p := range projects {
		ids = append(ids, p.ID)
	}

	type row struct {
		ProjectID string
		Jumlah    int64
	}
	var rows []row
	if err := h.DB.Model(&models.Photo{}).
		Select("project_id, count(*) as jumlah").
		Where("project_id IN ?", ids).
		Group("project_id").Scan(&rows).Error; err != nil {
		// Bukan alasan menggagalkan seluruh daftar; jumlahnya saja yang hilang.
		log.Printf("[WARN] Gagal menghitung foto: %v", err)
	}
	counts := make(map[string]int64, len(rows))
	for _, b := range rows {
		counts[b.ProjectID] = b.Jumlah
	}

	previews := h.previewThumbnails(ids)

	for _, p := range projects {
		out = append(out, projectWithCount{
			Project:    p,
			PhotoCount: counts[p.ID],
			Previews:   previews[p.ID],
		})
	}
	return out
}

// ResyncProject menarik ulang daftar foto dari Drive untuk project yang sudah ada.
//
// Sebelum ini foto hanya ditarik pada dua saat: ketika project dibuat, dan
// ketika project diedit DENGAN URL folder yang berubah. Akibatnya urutan yang
// paling wajar justru buntu: buat project saat Drive belum terhubung atau
// folder belum dibagikan, betulkan izinnya di Google, lalu kembali ke
// PhotoFlow — dan tidak ada satu pun cara memberi tahu PhotoFlow untuk membaca
// ulang. Satu-satunya jalan keluar adalah menghapus project lalu membuatnya
// lagi.
//
// Pilihan klien yang sudah tersimpan dipertahankan: baris foto yang namanya
// masih ada di folder tetap membawa is_selected-nya.
// previewThumbnails mengambil beberapa thumbnail pertama tiap project.
//
// Satu query untuk seluruh daftar, bukan satu per project: dashboard memuat
// semua project sekaligus, dan query per baris akan tumbuh bersama jumlah
// project yang dimiliki fotografer.
//
// Batasnya dipasang di SQL, memakai window function.
//
// Sebelumnya query ini mengambil SELURUH baris foto milik semua project lalu
// membuang kelebihannya di Go. Komentar di tempat ini dulu menyebut ongkosnya
// tidak sebanding karena "galeri terbesar sekalipun berisi ribuan baris
// pendek" — dan itu keliru pada dua hitungan. Barisnya tidak pendek: isinya
// URL thumbnail Google sepanjang ratusan karakter. Dan ribuan itu dikalikan
// jumlah project: seorang fotografer dengan lima pemotretan berisi 2.000 foto
// menarik 10.000 baris, sekitar satu setengah megabita, dari database ke fungsi
// serverless SETIAP KALI dashboard dibuka — untuk menampilkan dua puluh
// thumbnail.
//
// ROW_NUMBER memangkasnya di sisi database, sehingga yang melintas persis
// sebanyak yang dipakai.
func (h *Handler) previewThumbnails(ids []string) map[string][]string {
	const perProject = 4

	type row struct {
		ProjectID    string
		ThumbnailURL string
	}
	var rows []row
	err := h.DB.Raw(`
		SELECT project_id, thumbnail_url FROM (
			SELECT project_id, thumbnail_url,
			       ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY file_name) AS urutan
			FROM photos
			WHERE project_id IN ? AND thumbnail_url <> ''
		) t WHERE urutan <= ?`, ids, perProject).Scan(&rows).Error
	if err != nil {
		// Kartu tanpa pratinjau tetap berguna; ini bukan alasan menggagalkan
		// seluruh daftar project.
		log.Printf("[WARN] Gagal mengambil pratinjau: %v", err)
		return map[string][]string{}
	}

	byID := make(map[string][]string, len(ids))
	for _, b := range rows {
		byID[b.ProjectID] = append(byID[b.ProjectID], b.ThumbnailURL)
	}
	return byID
}

func (h *Handler) ResyncProject(c *gin.Context) {
	userID := c.GetString(middleware.ContextUserIDKey)
	projectID := c.Param("id")

	var project models.Project
	if err := h.DB.Where("id = ? AND user_id = ?", projectID, userID).First(&project).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found, or you do not have access to it"})
		return
	}

	store, err := h.StoreForUser(c.Request.Context(), userID)
	if err != nil {
		if code, ok := driveErrorCode(err); ok {
			c.JSON(http.StatusConflict, gin.H{"error": code, "code": code})
			return
		}
		log.Printf("[ERROR] Resync %s: %v", project.ID, err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "Google Drive could not be reached"})
		return
	}

	files, err := store.ListPhotos(c.Request.Context(), project.DriveFolderID)
	if err != nil {
		if code, ok := driveErrorCode(err); ok {
			c.JSON(http.StatusConflict, gin.H{"error": code, "code": code})
			return
		}
		log.Printf("[WARN] Resync: gagal membaca folder %s: %v", project.DriveFolderID, err)
		// Dua jalur sudah dicoba dan keduanya gagal, jadi pesannya menyebut
		// kedua jalan keluarnya. Menyebut hanya "bagikan ke akun terhubung"
		// akan mengarahkan orang ke langkah yang lebih rumit daripada yang
		// diperlukan: menjadikan folder publik sudah cukup, dan itu memang yang
		// biasanya dilakukan fotografer sebelum mengirimkannya ke klien.
		c.JSON(http.StatusBadGateway, gin.H{
			"error": "That Drive folder could not be read. Share it as 'Anyone with the link', or share it with the connected Google account.",
			"code":  "folder_unreadable",
		})
		return
	}

	// Nama yang sebelumnya dipilih klien, supaya pilihannya tidak hilang hanya
	// karena daftarnya ditarik ulang.
	var selected []string
	if err := h.DB.Model(&models.Photo{}).
		Where("project_id = ? AND is_selected", project.ID).
		Pluck("file_name", &selected).Error; err != nil {
		log.Printf("[WARN] Resync: gagal membaca pilihan lama: %v", err)
	}
	stillSelected := make(map[string]bool, len(selected))
	for _, name := range selected {
		stillSelected[name] = true
	}

	baru := make([]models.Photo, 0, len(files))
	for _, file := range files {
		baru = append(baru, models.Photo{
			ProjectID:    project.ID,
			FileName:     file.Name,
			ThumbnailURL: store.ThumbnailURL(file),
			IsSelected:   stillSelected[file.Name],
		})
	}

	if err := h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("project_id = ?", project.ID).Delete(&models.Photo{}).Error; err != nil {
			return err
		}
		if err := insertPhotos(tx, baru); err != nil {
			return err
		}
		return markSynced(tx, project.ID)
	}); err != nil {
		log.Printf("[ERROR] Resync %s: %v", project.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not save the photo list"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":      "Photo list refreshed from Google Drive",
		"photos_found": len(baru),
	})
}

// UpdateProject mengubah metadata project dan, kalau folder Drive-nya berganti,
// menyegarkan daftar fotonya.
func (h *Handler) UpdateProject(c *gin.Context) {
	userID := c.GetString(middleware.ContextUserIDKey)

	projectID := c.Param("id")
	var input models.CreateProjectInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "That input is not valid"})
		return
	}

	var project models.Project
	if err := h.DB.Where("id = ? AND user_id = ?", projectID, userID).First(&project).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found, or you do not have access to it"})
		return
	}

	newFolderID := extractDriveFolderID(input.DriveFolderURL)
	if newFolderID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "That Google Drive link is not valid"})
		return
	}

	driveChanged := project.DriveFolderID != newFolderID

	project.ProjectName = input.ProjectName
	project.ClientName = input.ClientName
	project.MaxSelections = input.MaxSelections
	if project.MaxSelections == 0 {
		project.MaxSelections = 50
	}
	project.DriveFolderURL = input.DriveFolderURL
	project.DriveFolderID = newFolderID
	if input.AdminWhatsApp != "" {
		project.AdminWhatsApp = input.AdminWhatsApp
	}
	if input.ClientWhatsApp != "" {
		project.ClientWhatsApp = input.ClientWhatsApp
	}

	// Mengganti folder pada galeri yang SUDAH pernah dibuka klien terhitung
	// sebagai galeri baru, dan memakai kuota.
	//
	// Tanpa aturan ini seluruh batas kuota dapat dilewati dengan satu project:
	// kirim ke klien A, ganti folder, kirim ke klien B, dan seterusnya tanpa
	// pernah membuat project kedua.
	//
	// Yang belum pernah dibuka TIDAK ditagih. Itu keadaan "saya menempel tautan
	// yang salah" — kesalahan yang wajar dan tidak boleh berbiaya.
	galeriBaru := driveChanged && project.FirstViewedAt != nil
	sekarang := time.Now().UTC()
	sub, err := langganan(h.DB, userID)
	if err != nil {
		log.Printf("[ERROR] Membaca langganan user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not update the project"})
		return
	}

	// Ditolak di sini, sebelum Drive disentuh. Penjaga yang sebenarnya ada di
	// dalam transaksi di bawah; yang ini hanya mencegah pembacaan folder yang
	// sudah pasti dibuang. Lihat kuotaHabis.
	if galeriBaru {
		habis, err := kuotaHabis(h.DB, userID, sub.KuotaBulanan(sekarang), sekarang)
		if err != nil {
			log.Printf("[ERROR] Membaca pemakaian user %s: %v", userID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not update the project"})
			return
		}
		if habis {
			tolakKuotaHabis(c, sub, sekarang, "mengganti folder galeri yang sudah dibuka klien")
			return
		}
	}

	// Daftar foto baru ditarik dari Drive SEBELUM transaksi dibuka. Panggilan
	// jaringan di dalam transaksi akan menahan lock baris selama permintaan
	// HTTP berlangsung, dan lamanya ditentukan pihak lain.
	var newPhotos []models.Photo
	photosRefreshed := false
	if driveChanged {
		newPhotos, photosRefreshed = h.fetchDrivePhotos(c.Request.Context(), userID, newFolderID, project.ID)
		if !photosRefreshed {
			// Foto lama SENGAJA dipertahankan. Menghapusnya tanpa punya
			// pengganti membuat galeri kosong permanen hanya karena Drive
			// sedang tidak bisa dihubungi.
			log.Printf("[WARN] Gagal menarik foto dari Drive untuk folder %s, foto lama dipertahankan", newFolderID)
		}
	}

	if err := h.DB.Transaction(func(tx *gorm.DB) error {
		if galeriBaru {
			if err := pakaiKuotaGaleri(tx, userID, sub.KuotaBulanan(sekarang), sekarang); err != nil {
				return err
			}
		}
		if err := tx.Save(&project).Error; err != nil {
			return err
		}
		if !photosRefreshed {
			return nil
		}
		if err := tx.Where("project_id = ?", project.ID).Delete(&models.Photo{}).Error; err != nil {
			return err
		}
		if err := insertPhotos(tx, newPhotos); err != nil {
			return err
		}
		return markSynced(tx, project.ID)
	}); err != nil {
		if errors.Is(err, ErrKuotaHabis) {
			tolakKuotaHabis(c, sub, sekarang, "mengganti folder galeri yang sudah dibuka klien")
			return
		}
		log.Printf("[ERROR] Update project %s: %v", project.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not update the project"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":          "Project updated",
		"data":             project,
		"photos_refreshed": !driveChanged || photosRefreshed,
	})
}

// DeleteProject menghapus project milik pemanggil beserta fotonya.
func (h *Handler) DeleteProject(c *gin.Context) {
	userID := c.GetString(middleware.ContextUserIDKey)

	projectID := c.Param("id")

	var project models.Project
	if err := h.DB.Where("id = ? AND user_id = ?", projectID, userID).First(&project).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found, or you do not have access to it"})
		return
	}

	// Delete photos associated with the project
	h.DB.Where("project_id = ?", projectID).Delete(&models.Photo{})

	if err := h.DB.Delete(&project).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not delete the project"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Project deleted"})
}

// ListSelections mengembalikan nama berkas yang dipilih klien pada satu proyek.
//
// Sampai sekarang daftar ini hanya bisa diambil aplikasi desktop, yang membaca
// Supabase langsung. Padahal justru di dashboard web-lah fotografer berada saat
// pemberitahuan masuk — dan yang dibutuhkannya di detik itu cuma daftar nama,
// untuk ditempel ke penyaring Lightroom. Menuntutnya memasang aplikasi desktop
// dulu hanya untuk menyalin teks adalah ongkos yang tidak perlu.
//
// Urutannya sengaja mengikuti nama berkas, bukan waktu pembuatan baris. Yang
// membaca daftar ini membandingkannya dengan isi folder, dan folder disusun
// menurut nama.
func (h *Handler) ListSelections(c *gin.Context) {
	userID := c.GetString(middleware.ContextUserIDKey)
	projectID := c.Param("id")

	var project models.Project
	if err := h.DB.Where("id = ? AND user_id = ?", projectID, userID).First(&project).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found, or you do not have access to it"})
		return
	}

	var photos []models.Photo
	if err := h.DB.
		Where("project_id = ? AND is_selected = ?", project.ID, true).
		Order("file_name").
		Find(&photos).Error; err != nil {
		log.Printf("list selections %s: %v", project.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not read the client's selection"})
		return
	}

	// Dua bentuk dari satu query. `file_names` untuk ditempel ke Lightroom;
	// `photos` supaya fotografer bisa MELIHAT pilihannya tanpa membuka Drive.
	// Sebelumnya satu-satunya cara memeriksa adalah membandingkan daftar nama
	// dengan isi folder sendiri.
	//
	// Keduanya bukan nil sekalipun kosong: nil ter-serialisasi jadi `null`, dan
	// frontend memanggil .length atasnya.
	fileNames := make([]string, 0, len(photos))
	ringkas := make([]gin.H, 0, len(photos))
	for _, p := range photos {
		fileNames = append(fileNames, p.FileName)
		ringkas = append(ringkas, gin.H{
			"id":            p.ID,
			"name":          p.FileName,
			"thumbnailLink": p.ThumbnailURL,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"project_name": project.ProjectName,
		"client_name":  project.ClientName,
		"status":       project.Status,
		"submitted_at": project.SubmittedAt,
		"count":        len(fileNames),
		"file_names":   fileNames,
		"photos":       ringkas,
	})
}

// RotateMagicLink menerbitkan magic link baru dan mematikan yang lama.
//
// Magic link tidak pernah kedaluwarsa dan tidak bisa dicabut. Sekali terkirim
// ia sah selamanya, dan galeri klien dapat dibuka siapa pun yang memegangnya —
// tautan yang diteruskan ke grup keluarga, tertinggal di riwayat percakapan,
// atau ikut terbawa saat ponsel berpindah tangan.
//
// Yang dipilih penerbitan ulang, bukan tanggal kedaluwarsa. Kedaluwarsa
// otomatis mematikan tautan pada saat yang tidak diminta siapa pun — termasuk
// di tengah klien memilih. Penerbitan ulang menaruh keputusannya pada
// fotografer, dan sekaligus jadi jalan keluar ketika tautan memang bocor.
func (h *Handler) RotateMagicLink(c *gin.Context) {
	userID := c.GetString(middleware.ContextUserIDKey)
	projectID := c.Param("id")

	var project models.Project
	if err := h.DB.Where("id = ? AND user_id = ?", projectID, userID).First(&project).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found, or you do not have access to it"})
		return
	}

	token, err := generateMagicLink()
	if err != nil {
		log.Printf("rotate magic link %s: %v", project.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not issue a new link"})
		return
	}

	if err := h.DB.Model(&models.Project{}).
		Where("id = ?", project.ID).
		Update("magic_link_token", token).Error; err != nil {
		log.Printf("rotate magic link %s: %v", project.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not issue a new link"})
		return
	}

	// Pilihan yang sudah dikirim sengaja TIDAK ikut dihapus. Menerbitkan ulang
	// tautan adalah tindakan keamanan, bukan pembatalan pekerjaan; membuang
	// pilihan klien sebagai efek sampingnya akan mengejutkan.
	c.JSON(http.StatusOK, gin.H{"magic_link_token": token})
}

// ReopenSelection mengembalikan project yang sudah dikirim ke keadaan pending.
//
// Mengirim pilihan sengaja dibuat satu arah: SubmitSelection mengunci status
// lewat `WHERE status <> 'submitted'` supaya dua klien yang menekan kirim pada
// saat bersamaan tidak saling menimpa. Yang belum ada sampai sekarang adalah
// jalan pulangnya. Akibatnya satu klik keliru dari klien membuat galerinya mati
// permanen, dan satu-satunya perbaikan adalah membuka database langsung.
//
// Hanya pemilik project yang boleh melakukannya — sama seperti UpdateProject
// dan DeleteProject, kepemilikan diperiksa lewat `user_id` yang diambil dari
// klaim `sub` pada JWT, bukan dari apa pun yang dikirim browser.
//
// Pilihan foto ikut dikosongkan. Membuka status tanpa mengosongkan pilihan akan
// menaruh klien kembali di galeri dengan semua foto sudah tercentang, sehingga
// pemilihan ulang justru lebih menyulitkan daripada memulai dari nol.
func (h *Handler) ReopenSelection(c *gin.Context) {
	userID := c.GetString(middleware.ContextUserIDKey)
	projectID := c.Param("id")

	var project models.Project
	if err := h.DB.Where("id = ? AND user_id = ?", projectID, userID).First(&project).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found, or you do not have access to it"})
		return
	}

	if project.Status != models.StatusSubmitted {
		// Bukan kegagalan: hasil yang diminta sudah tercapai. Membalasnya
		// sebagai error akan memaksa frontend membedakan dua keadaan yang
		// bagi pemakainya sama saja.
		c.JSON(http.StatusOK, gin.H{"message": "The selection was already open"})
		return
	}

	// Membuka kembali JAUH sesudah kiriman terhitung sebagai galeri baru.
	//
	// Fiturnya ada untuk satu keadaan: klien menekan kirim sebelum selesai
	// memilih. Kesalahan itu disadari dalam hitungan jam. Membukanya kembali
	// berminggu-minggu kemudian berarti project lama dipakai ulang untuk klien
	// berikutnya — dan tanpa aturan ini, satu project dapat melayani klien tanpa
	// batas sehingga seluruh kuota kehilangan artinya.
	//
	// Yang di dalam tenggang tidak ditagih: menghukum fotografer karena
	// kliennya salah tekan adalah cara tercepat membuat fitur ini tidak dipakai,
	// dan galeri yang terkunci selamanya jauh lebih merugikan.
	sekarang := time.Now().UTC()
	galeriBaru := project.SubmittedAt != nil &&
		sekarang.Sub(*project.SubmittedAt) > jedaSalahKirim

	sub, err := langganan(h.DB, userID)
	if err != nil {
		log.Printf("[ERROR] Membaca langganan user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not reopen the selection"})
		return
	}

	// Keduanya dalam satu transaksi. Kalau pengosongan pilihan gagal setelah
	// status terlanjur dibuka, klien akan masuk ke galeri terbuka yang seluruh
	// fotonya tercentang — persis keadaan yang ingin dihindari.
	err = h.DB.Transaction(func(tx *gorm.DB) error {
		if galeriBaru {
			if err := pakaiKuotaGaleri(tx, userID, sub.KuotaBulanan(sekarang), sekarang); err != nil {
				return err
			}
		}
		if err := tx.Model(&models.Photo{}).
			Where("project_id = ?", project.ID).
			Update("is_selected", false).Error; err != nil {
			return err
		}
		return tx.Model(&models.Project{}).
			Where("id = ?", project.ID).
			Updates(map[string]any{
				"status": models.StatusPending,
				// Waktu kiriman ikut dikosongkan. Kalau ditinggal, dashboard
				// menampilkan project yang kembali terbuka sebagai "dikirim
				// dua jam lalu" — keterangan yang sudah tidak benar.
				"submitted_at": nil,
			}).Error
	})
	if err != nil {
		if errors.Is(err, ErrKuotaHabis) {
			tolakKuotaHabis(c, sub, sekarang, "membuka kembali pemilihan lama")
			return
		}
		log.Printf("[ERROR] Reopen selection %s: %v", project.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not reopen the selection"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Selection reopened"})
}
