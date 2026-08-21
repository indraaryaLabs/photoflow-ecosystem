package handlers

import (
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"photoflow-backend/middleware"
	"photoflow-backend/models"
	"photoflow-backend/storage"
)

// DriveToken menghasilkan access token Google Drive milik pemanggil, untuk
// dipakai desktop app mengunduh berkas aslinya.
func (h *Handler) DriveToken(c *gin.Context) {
	userID := c.GetString(middleware.ContextUserIDKey)

	token, err := storage.GetUserAccessToken(c.Request.Context(), h.DB, userID)
	if err != nil {
		if code, ok := driveErrorCode(err); ok {
			// Bukan kegagalan server: user perlu menghubungkan Drive-nya.
			// Kode ini yang dipakai klien untuk menampilkan ajakan reconnect
			// alih-alih pesan error mentah.
			c.JSON(http.StatusConflict, gin.H{"error": code, "code": code})
			return
		}
		log.Printf("[ERROR] GDrive access token untuk user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not obtain an access token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"access_token": token.AccessToken,
		"expiry":       token.Expiry,
	})
}

// driveErrorCode memetakan kesalahan koneksi Drive ke kode yang bisa
// ditindaklanjuti klien. Kesalahan lain sengaja tidak dipetakan supaya tidak
// ada detail internal yang bocor ke pemanggil.
func driveErrorCode(err error) (string, bool) {
	switch {
	case errors.Is(err, storage.ErrDriveNotConnected):
		return "drive_not_connected", true
	case errors.Is(err, storage.ErrDriveReconnectRequired):
		return "drive_reconnect_required", true
	default:
		return "", false
	}
}

// GalleryPhotos melayani daftar foto sebuah galeri lewat magic link.
//
// Menggantikan GET /api/gdrive/:folderId, yang menerima ID folder apa pun dari
// siapa pun tanpa memeriksa hubungan pemanggil dengan folder itu. Magic link
// menentukan project, project menentukan pemiliknya, dan kredensial pemilik
// itulah yang dipakai membaca Drive — jadi tidak ada lagi cara meminta isi
// folder yang bukan bagian dari galeri mana pun.
//
// Rute ini publik dan tidak boleh gagal hanya karena Drive tidak terbaca:
// fotonya sudah tersimpan di database, dan galeri klien harus tetap tampil.
// Bentuk responsnya seragam untuk kedua sumber sehingga frontend tidak perlu
// tahu yang mana yang sedang dipakai.
func (h *Handler) GalleryPhotos(c *gin.Context) {
	magicLink := c.Param("magic_link")

	var project models.Project
	if err := h.DB.Where("magic_link_token = ?", magicLink).First(&project).Error; err != nil {
		if h.Limiter.TooManyFailures(c) {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Too many attempts. Please try again later."})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": "Gallery not found, or the link is not valid"})
		return
	}

	// Salinan di database yang dilayani, BUKAN pembacaan Drive.
	//
	// Sebelumnya rute ini memanggil Google pada setiap kunjungan. Untuk folder
	// berisi 2.000 berkas itu dua halaman berurutan ke Drive — beberapa detik,
	// dibayar oleh setiap klien setiap kali membuka galerinya, untuk daftar yang
	// hampir tidak pernah berubah di antara dua kunjungan.
	//
	// Komentar yang dulu ada di sini menyebut salinan itu tidak dapat dipakai
	// karena "setelah submit, tabel photos hanya berisi pilihan klien dengan
	// thumbnail_url kosong". Itu sudah tidak berlaku sejak markSelection
	// menandai pilihan alih-alih mengganti barisnya: salinannya kini utuh,
	// termasuk untuk galeri yang sudah disubmit.
	if !shouldReadDrive(project, c.Query("refresh") == "1") {
		h.respondWithStoredPhotos(c, project, "")
		return
	}

	store, err := h.StoreForUser(c.Request.Context(), project.UserID)
	if err != nil {
		h.respondWithStoredPhotos(c, project, driveFallbackReason(err))
		return
	}

	files, err := store.ListPhotos(c.Request.Context(), project.DriveFolderID)
	if err != nil {
		log.Printf("[WARN] Baca folder Drive %s untuk galeri %s: %v", project.DriveFolderID, project.ID, err)
		h.respondWithStoredPhotos(c, project, driveFallbackReason(err))
		return
	}

	// Hasilnya disimpan supaya kunjungan berikutnya tidak perlu menunggu Drive
	// lagi. Kegagalannya tidak menggagalkan balasan: yang diminta klien adalah
	// daftar fotonya, dan daftar itu sudah ada di tangan.
	if err := h.storePhotoCopy(project, files); err != nil {
		log.Printf("[WARN] Gagal menyimpan salinan foto project %s: %v", project.ID, err)
	}

	c.JSON(http.StatusOK, gin.H{"files": files, "source": "drive"})
}

// maxCopyAge menentukan kapan salinan dianggap layak disegarkan.
//
// Sepuluh menit adalah kompromi: cukup pendek sehingga foto yang baru
// ditambahkan ke folder muncul dalam satu sesi kerja, cukup panjang sehingga
// satu galeri yang dibuka berkali-kali tidak memanggil Drive berkali-kali.
const maxCopyAge = 10 * time.Minute

// minRefreshInterval menahan pembacaan Drive yang terlalu berdekatan.
//
// Rute ini publik: siapa pun yang memegang magic link dapat menambahkan
// `?refresh=1`. Tanpa jeda, satu orang yang menyegarkan halaman berulang kali
// akan memanggil Drive berulang kali atas nama fotografernya.
const minRefreshInterval = time.Minute

// shouldReadDrive memutuskan apakah Drive harus dibaca untuk permintaan ini.
//
// Salinan yang sudah lawas TIDAK membuat klien menunggu. Ia tetap disajikan
// apa adanya, ditandai `stale`, dan frontend yang meminta penyegarannya lewat
// permintaan kedua sesudah fotonya tergambar. Itulah arti "segarkan di latar":
// yang menunggu Google tidak boleh orang yang sedang membuka galeri.
//
// Jadi hanya ada dua alasan membaca Drive di sini: belum ada salinan sama
// sekali, atau permintaan penyegaran yang jedanya sudah lewat.
func shouldReadDrive(project models.Project, requested bool) bool {
	if project.PhotosSyncedAt == nil {
		return true
	}
	return requested && time.Since(*project.PhotosSyncedAt) >= minRefreshInterval
}

// storePhotoCopy memperbarui daftar foto tersimpan dari hasil pembacaan Drive.
//
// Pilihan klien dipertahankan: baris yang namanya masih ada di folder tetap
// membawa is_selected-nya. Itu sebabnya daftarnya tidak sekadar dihapus lalu
// disisipkan ulang.
func (h *Handler) storePhotoCopy(project models.Project, files []storage.PhotoRef) error {
	return h.DB.Transaction(func(tx *gorm.DB) error {
		var selected []string
		if err := tx.Model(&models.Photo{}).
			Where("project_id = ? AND is_selected", project.ID).
			Pluck("file_name", &selected).Error; err != nil {
			return err
		}
		picks := make(map[string]bool, len(selected))
		for _, n := range selected {
			picks[n] = true
		}

		if err := tx.Where("project_id = ?", project.ID).Delete(&models.Photo{}).Error; err != nil {
			return err
		}

		baru := make([]models.Photo, 0, len(files))
		for _, f := range files {
			baru = append(baru, models.Photo{
				ProjectID:    project.ID,
				FileName:     f.Name,
				ThumbnailURL: f.ThumbnailLink,
				IsSelected:   picks[f.Name],
			})
		}
		if err := insertPhotos(tx, baru); err != nil {
			return err
		}

		sekarang := time.Now().UTC()
		return tx.Model(&models.Project{}).
			Where("id = ?", project.ID).
			Update("photos_synced_at", sekarang).Error
	})
}

// driveFallbackReason menerjemahkan kesalahan jadi alasan singkat yang aman
// ditampilkan, untuk menjelaskan kenapa foto diambil dari salinan tersimpan.
func driveFallbackReason(err error) string {
	if code, ok := driveErrorCode(err); ok {
		return code
	}
	return "drive_unavailable"
}

// respondWithStoredPhotos mengembalikan salinan foto dari database dalam bentuk
// yang sama persis dengan hasil pembacaan Drive.
//
// Penyeragaman ini bukan kerapian belaka: baris database memakai `file_name`
// dan `thumbnail_url`, sedangkan galeri membaca `name` dan `thumbnailLink`.
// Selama ini jalur cadangan mengirim bentuk yang salah, sehingga andai ia
// pernah terpakai, gambarnya kosong dan nama berkasnya hilang saat submit.
func (h *Handler) respondWithStoredPhotos(c *gin.Context, project models.Project, reason string) {
	var photos []models.Photo
	// Diurutkan menurut nama, sama seperti pembacaan dari Drive. Tanpa ORDER BY,
	// Postgres tidak menjanjikan urutan apa pun — jadi galeri yang jatuh ke
	// salinan ini akan tampil dengan susunan berbeda dari yang dilihat klien
	// sebelumnya, pada saat yang justru sudah membingungkan.
	if err := h.DB.Where("project_id = ?", project.ID).Order("file_name").Find(&photos).Error; err != nil {
		log.Printf("[ERROR] Gagal memuat foto tersimpan project %s: %v", project.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not load the photo list"})
		return
	}

	files := make([]storage.PhotoRef, 0, len(photos))
	for _, photo := range photos {
		files = append(files, storage.PhotoRef{
			ID:            photo.ID,
			Name:          photo.FileName,
			ThumbnailLink: photo.ThumbnailURL,
		})
	}

	// Dua keadaan yang sangat berbeda, dan frontend harus dapat membedakannya.
	//
	// reason kosong berarti salinan ini memang yang sengaja disajikan, dan
	// semuanya sehat. reason terisi berarti Drive gagal dibaca dan inilah yang
	// tersisa — galeri boleh tampil, tapi klien perlu diberi tahu bahwa
	// daftarnya mungkin tertinggal.
	//
	// Sebelum ada pembedaan ini keduanya sama-sama bernama "stored", sehingga
	// menyajikan salinan sebagai jalur normal akan memunculkan spanduk
	// peringatan pada galeri yang sebenarnya baik-baik saja.
	if reason == "" {
		c.JSON(http.StatusOK, gin.H{
			"files":  files,
			"source": "cache",
			// Pemberi tahu frontend bahwa salinannya layak disegarkan di latar.
			// Keputusannya dibuat di sini, bukan di peramban, supaya ambangnya
			// hanya ada di satu tempat.
			"stale": project.PhotosSyncedAt == nil ||
				time.Since(*project.PhotosSyncedAt) >= maxCopyAge,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"files":  files,
		"source": "stored",
		"reason": reason,
	})
}

// DriveStatus melaporkan apakah pemanggil sudah menghubungkan Google Drive.
//
// Dashboard web tidak punya cara lain mengetahuinya. Tanpa endpoint ini ia
// hanya bisa menebak dari kegagalan yang muncul belakangan — dan itulah yang
// terjadi selama ini: fotografer baru mendaftar, membuat project, lalu bingung
// kenapa fotonya tidak pernah muncul, tanpa pernah diberi tahu bahwa Drive-nya
// memang belum pernah dihubungkan.
//
// Yang dikembalikan hanya keadaan terhubung atau tidak. Token, alamat email
// akun Google, maupun cakupan izinnya tidak ikut, karena tak satu pun
// diperlukan untuk menggambar antarmukanya.
func (h *Handler) DriveStatus(c *gin.Context) {
	userID := c.GetString(middleware.ContextUserIDKey)

	_, err := storage.GetUserAccessToken(c.Request.Context(), h.DB, userID)
	if err != nil {
		code, known := driveErrorCode(err)
		if !known {
			// Drive mungkin sedang tidak dapat dihubungi. Itu bukan berarti
			// izinnya tidak ada, jadi jangan laporkan sebagai "belum terhubung"
			// — nanti fotografer diminta menghubungkan ulang tanpa alasan.
			log.Printf("[WARN] Status Drive user %s: %v", userID, err)
			c.JSON(http.StatusOK, gin.H{"connected": false, "unknown": true})
			return
		}
		c.JSON(http.StatusOK, gin.H{"connected": false, "code": code})
		return
	}

	c.JSON(http.StatusOK, gin.H{"connected": true})
}
