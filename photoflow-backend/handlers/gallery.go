package handlers

import (
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"photoflow-backend/models"
	"photoflow-backend/notify"
)

// GetGallery melayani galeri klien lewat magic link. Rute ini publik: klien
// mengaksesnya tanpa login.
func (h *Handler) GetGallery(c *gin.Context) {
	magicLink := c.Param("magic_link")

	var project models.Project
	if err := h.DB.Where("magic_link_token = ?", magicLink).First(&project).Error; err != nil {
		// Hanya pencarian yang GAGAL yang dihitung, sehingga klien sah yang
		// membuka galerinya berulang kali tidak pernah tersentuh limiter.
		if h.Limiter.TooManyFailures(c) {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Terlalu banyak percobaan. Coba lagi nanti."})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": "Galeri tidak ditemukan atau link tidak valid"})
		return
	}

	var photos []models.Photo
	if err := h.DB.Where("project_id = ?", project.ID).Find(&photos).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal memuat daftar foto"})
		return
	}

	h.tandaiPernahDibuka(c, project)

	// Hanya kolom yang dipakai halaman galeri yang dikirim. Rute ini publik,
	// jadi mengirim baris Project apa adanya berarti membocorkan user_id,
	// drive_folder_id, magic_link_token, dan nomor WhatsApp klien kepada siapa
	// pun yang memegang tautannya.
	c.JSON(http.StatusOK, gin.H{
		"project": models.NewGalleryProject(project, h.namaStudio(project.UserID)),
		"photos":  models.NewGalleryPhotos(photos),
	})
}

// namaStudio membaca nama studio pemilik project.
//
// Mengembalikan string kosong pada kegagalan apa pun, termasuk profil yang
// belum ada. Galeri klien tidak boleh mati karena sebuah nama tidak terbaca —
// tanpa nama itu yang tampil hanya "PhotoFlow", persis seperti sebelum fitur
// ini ada.
func (h *Handler) namaStudio(userID string) string {
	var profil models.Profile
	if err := h.DB.Where("id = ?", userID).First(&profil).Error; err != nil {
		return ""
	}
	return strings.TrimSpace(profil.StudioName)
}

// tandaiPernahDibuka mencatat kapan galeri ini pertama kali dibuka.
//
// Satu UPDATE bersyarat, bukan baca-lalu-tulis. Klien yang menyegarkan halaman
// dua kali menjalankan dua permintaan yang boleh berjalan bersamaan di dua
// instance serverless yang berbeda; keduanya akan membaca nil dan keduanya akan
// menulis. `WHERE first_viewed_at IS NULL` membuat yang kedua tidak mengenai
// baris apa pun, sehingga waktu pertama tidak dapat tergeser oleh kunjungan
// berikutnya.
//
// Fotografer yang mengintip galerinya sendiri TIDAK dihitung. Tombol "Open
// client gallery" di dashboard membuka tautan yang sama persis dengan yang
// dipegang klien, jadi tanpa penanda ini angka "sudah dibuka" akan berbunyi
// pada detik project dibuat -- dan sinyal yang selalu menyala sama tidak
// bergunanya dengan sinyal yang tidak pernah menyala.
//
// Kegagalannya diabaikan selain dicatat: galeri klien tidak boleh mati karena
// sebuah statistik gagal ditulis.
func (h *Handler) tandaiPernahDibuka(c *gin.Context, project models.Project) {
	if project.FirstViewedAt != nil || c.Query("preview") == "1" {
		return
	}

	err := h.DB.Model(&models.Project{}).
		Where("id = ? AND first_viewed_at IS NULL", project.ID).
		Update("first_viewed_at", time.Now()).Error
	if err != nil {
		log.Printf("gallery: gagal menandai project %s pernah dibuka: %v", project.ID, err)
	}
}

// SubmitSelection menerima pilihan foto dari klien lalu mengunci galerinya.
func (h *Handler) SubmitSelection(c *gin.Context) {
	magicLink := c.Param("magic_link")

	var input models.SubmitSelectionInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Data pilihan tidak valid"})
		return
	}

	// Submit menggantikan seluruh daftar foto project. Dengan daftar kosong,
	// penggantinya tidak ada: semua foto terhapus dan galeri terkunci tanpa
	// menyisakan satu pun pilihan, sehingga pekerjaan klien hilang permanen
	// dan tidak bisa diulang. Antarmuka klien sendiri tidak pernah mengirim
	// keadaan ini — tombol kirimnya baru muncul setelah ada foto terpilih.
	if len(input.SelectedPhotos) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Pilih minimal satu foto sebelum mengirim."})
		return
	}

	var project models.Project
	if err := h.DB.Where("magic_link_token = ?", magicLink).First(&project).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project tidak valid"})
		return
	}

	photosToInsert := make([]models.Photo, 0, len(input.SelectedPhotos))
	for _, sp := range input.SelectedPhotos {
		photosToInsert = append(photosToInsert, models.Photo{
			ProjectID:    project.ID,
			FileName:     sp.FileName,
			ThumbnailURL: "", // tidak diperlukan untuk desktop harvester
			IsSelected:   true,
		})
	}

	// Status TIDAK diperiksa di sini. Membacanya lebih dulu lalu mengubahnya
	// belakangan justru menciptakan celah yang hendak ditutup; satu-satunya
	// penentu ada di dalam submitSelection.
	if err := submitSelection(h.DB, project.ID, photosToInsert); err != nil {
		if errors.Is(err, errGalleryLocked) {
			c.JSON(http.StatusConflict, gin.H{"error": "Galeri ini sudah dikunci karena pilihan telah disubmit sebelumnya."})
			return
		}
		log.Printf("🔴 Submit pilihan project %s: %v", project.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal menyimpan pilihan"})
		return
	}

	h.notifySubmission(c, project, len(input.SelectedPhotos))

	c.JSON(http.StatusOK, gin.H{
		"message":      "Pilihan berhasil disimpan!",
		"photos_saved": len(input.SelectedPhotos),
	})
}

// notifySubmission memberi tahu fotografer bahwa kliennya sudah memilih.
//
// Dijalankan SEBELUM balasan dikirim, bukan di goroutine latar. Backend ini
// fungsi serverless: begitu balasan terkirim, prosesnya dapat dibekukan atau
// dimatikan kapan saja, dan goroutine yang masih berjalan ikut mati tanpa jejak.
// Pemberitahuan yang kadang terkirim kadang tidak lebih buruk daripada tidak
// ada sama sekali, karena tidak ada yang tahu kapan boleh mempercayainya.
//
// Ongkosnya jelas dan diterima: klien menunggu satu perjalanan jaringan lagi,
// dibatasi 5 detik oleh timeout milik Mailer.
//
// Kegagalannya TIDAK PERNAH menggagalkan submit. Pilihan klien sudah tersimpan
// di database pada titik ini; membalas error karena email gagal akan membuatnya
// mengira pekerjaannya hilang, lalu mencoba lagi ke galeri yang sudah terkunci.
func (h *Handler) notifySubmission(c *gin.Context, project models.Project, count int) {
	if h.Mailer == nil {
		return
	}

	var pemilik struct{ Email string }
	// Email fotografer ada di auth.users milik Supabase, bukan di tabel
	// aplikasi ini. Dibaca lewat query mentah karena tabel itu tidak dipetakan
	// sebagai model di sini.
	if err := h.DB.Raw(
		"SELECT email FROM auth.users WHERE id = ?", project.UserID,
	).Scan(&pemilik).Error; err != nil || pemilik.Email == "" {
		log.Printf("notify: tidak dapat menemukan email pemilik project %s: %v", project.ID, err)
		return
	}

	subjek, badan := notify.SelectionSubmitted(
		project.ClientName, project.ProjectName, count, h.AppBaseURL+"/dashboard")

	if err := h.Mailer.Send(c.Request.Context(), pemilik.Email, subjek, badan); err != nil {
		log.Printf("notify: gagal mengirim pemberitahuan project %s: %v", project.ID, err)
	}
}
