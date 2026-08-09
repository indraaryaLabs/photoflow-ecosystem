package handlers

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"photoflow-backend/middleware"
	"photoflow-backend/storage"
)

// DriveToken menghasilkan access token Google Drive dari refresh token milik
// pemanggil. Dipakai desktop app; rute ini terautentikasi.
func (h *Handler) DriveToken(c *gin.Context) {
	userID := c.GetString(middleware.ContextUserIDKey)

	// Generate GDrive Access Token dari Refresh Token milik user
	accessToken, expiry, err := storage.GetUserAccessToken(userID, h.DB)
	if err != nil {
		log.Printf("🔴 GDrive access token untuk user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal menghasilkan access token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"access_token": accessToken,
		"expiry":       expiry,
	})
}

// DriveFolder membaca isi folder Google Drive, termasuk format RAW.
//
// Sengaja tetap publik: dipanggil galeri klien yang diakses lewat magic link
// tanpa login.
func (h *Handler) DriveFolder(c *gin.Context) {
	folderID := c.Param("folderId")

	files, err := storage.GetImagesFromFolder(folderID)
	if err != nil {
		// Rute ini publik: pesan error mentah dari Google API tidak boleh
		// sampai ke pemanggil.
		log.Printf("🔴 Baca folder Drive %s: %v", folderID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal membaca folder Google Drive"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"files": files})
}
