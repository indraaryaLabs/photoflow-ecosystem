package handlers

import (
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

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
		log.Printf("🔴 GDrive access token untuk user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal menghasilkan access token"})
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
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Terlalu banyak percobaan. Coba lagi nanti."})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": "Galeri tidak ditemukan atau link tidak valid"})
		return
	}

	// Galeri yang sudah disubmit SENGAJA tetap membaca Drive, sama seperti
	// sebelumnya. Setelah submit, tabel photos hanya berisi pilihan klien dengan
	// thumbnail_url kosong, jadi menyajikannya di sini akan menampilkan gambar
	// kosong. Penguncian tampilan sudah ditangani frontend lewat status project.
	store, err := h.StoreForUser(c.Request.Context(), project.UserID)
	if err != nil {
		h.respondWithStoredPhotos(c, project, driveFallbackReason(err))
		return
	}

	files, err := store.ListPhotos(c.Request.Context(), project.DriveFolderID)
	if err != nil {
		log.Printf("⚠️ Baca folder Drive %s untuk galeri %s: %v", project.DriveFolderID, project.ID, err)
		h.respondWithStoredPhotos(c, project, driveFallbackReason(err))
		return
	}

	c.JSON(http.StatusOK, gin.H{"files": files, "source": "drive"})
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
	if err := h.DB.Where("project_id = ?", project.ID).Find(&photos).Error; err != nil {
		log.Printf("🔴 Gagal memuat foto tersimpan project %s: %v", project.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal memuat daftar foto"})
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
			log.Printf("⚠️ Status Drive user %s: %v", userID, err)
			c.JSON(http.StatusOK, gin.H{"connected": false, "unknown": true})
			return
		}
		c.JSON(http.StatusOK, gin.H{"connected": false, "code": code})
		return
	}

	c.JSON(http.StatusOK, gin.H{"connected": true})
}
