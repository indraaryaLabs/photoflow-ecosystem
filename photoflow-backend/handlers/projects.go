package handlers

import (
	"context"
	"log"
	"net/http"

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
		log.Printf("⚠️ Drive tidak tersedia untuk user %s: %v", userID, err)
		return nil, false
	}

	files, err := store.ListPhotos(ctx, folderID)
	if err != nil {
		log.Printf("⚠️ Gagal membaca folder Drive %s: %v", folderID, err)
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
		c.JSON(http.StatusBadRequest, gin.H{"error": "Input tidak valid"})
		return
	}

	folderID := extractDriveFolderID(input.DriveFolderURL)
	if folderID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Link Google Drive tidak valid"})
		return
	}

	magicLink, err := generateMagicLink()
	if err != nil {
		log.Printf("🔴 %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal membuat project"})
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

	if err := h.DB.Create(&newProject).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal menyimpan project"})
		return
	}

	photosToInsert, ok := h.fetchDrivePhotos(c.Request.Context(), userID, folderID, newProject.ID)
	if !ok {
		c.JSON(http.StatusCreated, gin.H{
			"message": "Project dibuat, tapi gagal menarik foto dari Drive.",
			"project": newProject,
		})
		return
	}

	if len(photosToInsert) > 0 {
		h.DB.Create(&photosToInsert)
	}

	c.JSON(http.StatusCreated, gin.H{
		"message":      "Project berhasil dibuat & tersinkronisasi!",
		"data":         newProject,
		"photos_found": len(photosToInsert),
	})
}

// ListProjects mengembalikan project milik pemanggil saja.
func (h *Handler) ListProjects(c *gin.Context) {
	userID := c.GetString(middleware.ContextUserIDKey)

	var projects []models.Project
	// Ambil semua project dari database, urutkan dari yang paling baru dibuat
	if err := h.DB.Where("user_id = ?", userID).Order("created_at desc").Find(&projects).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal mengambil data project"})
		return
	}
	c.JSON(http.StatusOK, projects)
}

// UpdateProject mengubah metadata project dan, kalau folder Drive-nya berganti,
// menyegarkan daftar fotonya.
func (h *Handler) UpdateProject(c *gin.Context) {
	userID := c.GetString(middleware.ContextUserIDKey)

	projectID := c.Param("id")
	var input models.CreateProjectInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Input tidak valid"})
		return
	}

	var project models.Project
	if err := h.DB.Where("id = ? AND user_id = ?", projectID, userID).First(&project).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project tidak ditemukan atau akses ditolak"})
		return
	}

	newFolderID := extractDriveFolderID(input.DriveFolderURL)
	if newFolderID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Link Google Drive tidak valid"})
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
			log.Printf("⚠️ Gagal menarik foto dari Drive untuk folder %s, foto lama dipertahankan", newFolderID)
		}
	}

	if err := h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&project).Error; err != nil {
			return err
		}
		if !photosRefreshed {
			return nil
		}
		if err := tx.Where("project_id = ?", project.ID).Delete(&models.Photo{}).Error; err != nil {
			return err
		}
		if len(newPhotos) == 0 {
			return nil
		}
		return tx.Create(&newPhotos).Error
	}); err != nil {
		log.Printf("🔴 Update project %s: %v", project.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal mengupdate project"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":          "Project berhasil diupdate",
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
		c.JSON(http.StatusNotFound, gin.H{"error": "Project tidak ditemukan atau akses ditolak"})
		return
	}

	// Delete photos associated with the project
	h.DB.Where("project_id = ?", projectID).Delete(&models.Photo{})

	if err := h.DB.Delete(&project).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal menghapus project"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Project berhasil dihapus"})
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
		c.JSON(http.StatusNotFound, gin.H{"error": "Project tidak ditemukan atau akses ditolak"})
		return
	}

	if project.Status != models.StatusSubmitted {
		// Bukan kegagalan: hasil yang diminta sudah tercapai. Membalasnya
		// sebagai error akan memaksa frontend membedakan dua keadaan yang
		// bagi pemakainya sama saja.
		c.JSON(http.StatusOK, gin.H{"message": "Pemilihan memang masih terbuka"})
		return
	}

	// Keduanya dalam satu transaksi. Kalau pengosongan pilihan gagal setelah
	// status terlanjur dibuka, klien akan masuk ke galeri terbuka yang seluruh
	// fotonya tercentang — persis keadaan yang ingin dihindari.
	err := h.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.Photo{}).
			Where("project_id = ?", project.ID).
			Update("is_selected", false).Error; err != nil {
			return err
		}
		return tx.Model(&models.Project{}).
			Where("id = ?", project.ID).
			Update("status", models.StatusPending).Error
	})
	if err != nil {
		log.Printf("reopen selection %s: %v", project.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal membuka kembali pemilihan"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Pemilihan dibuka kembali"})
}
