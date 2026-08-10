package handlers

import (
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"photoflow-backend/models"
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

	// Hanya kolom yang dipakai halaman galeri yang dikirim. Rute ini publik,
	// jadi mengirim baris Project apa adanya berarti membocorkan user_id,
	// drive_folder_id, magic_link_token, dan nomor WhatsApp klien kepada siapa
	// pun yang memegang tautannya.
	c.JSON(http.StatusOK, gin.H{
		"project": models.NewGalleryProject(project),
		"photos":  models.NewGalleryPhotos(photos),
	})
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

	c.JSON(http.StatusOK, gin.H{
		"message":      "Pilihan berhasil disimpan!",
		"photos_saved": len(input.SelectedPhotos),
	})
}
