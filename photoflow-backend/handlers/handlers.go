// Package handlers berisi handler HTTP beserta logika yang dipanggilnya.
//
// Sebelumnya seluruh handler adalah closure di dalam SetupRouter, sehingga
// tidak satu pun bisa dipanggil dari tes tanpa membangun router lengkap beserta
// koneksi database dan konfigurasi auth-nya. Di sini handler menjadi method
// dengan dependensi eksplisit.
package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"

	"golang.org/x/oauth2"
	"gorm.io/gorm"

	"photoflow-backend/middleware"
	"photoflow-backend/models"
	"photoflow-backend/storage"
)

// Handler menyimpan dependensi yang dibutuhkan handler-handler di paket ini.
type Handler struct {
	DB      *gorm.DB
	OAuth   *oauth2.Config
	Limiter *middleware.Limiter

	// StoreForUser membangun PhotoStore memakai kredensial Drive milik user
	// tertentu. Ini titik sisip yang membuat handler bisa diuji tanpa memanggil
	// jaringan: tes memasang fungsi yang mengembalikan storage.FakeStore.
	StoreForUser func(ctx context.Context, userID string) (storage.PhotoStore, error)
}

// New membuat Handler dengan PhotoStore yang membaca Google Drive sungguhan.
func New(db *gorm.DB, oauthConfig *oauth2.Config, limiter *middleware.Limiter) *Handler {
	return &Handler{
		DB:      db,
		OAuth:   oauthConfig,
		Limiter: limiter,
		StoreForUser: func(ctx context.Context, userID string) (storage.PhotoStore, error) {
			return storage.NewGDriveStoreForUser(ctx, db, userID)
		},
	}
}

// errGalleryLocked dikembalikan ketika galeri sudah disubmit sebelumnya.
var errGalleryLocked = errors.New("galeri sudah dikunci")

// magicLinkBytes menentukan entropi token galeri. Nilai lama 4 byte hanya
// memberi 2^32 kemungkinan — cukup kecil untuk dienumerasi, dan cukup kecil pula
// untuk bertabrakan pada kolom unique. 16 byte menaikkannya ke 2^128.
//
// Token yang sudah terlanjur dibuat tetap berlaku: pencarian memakai
// perbandingan nilai pada kolom text, tanpa asumsi panjang di mana pun.
const magicLinkBytes = 16

// generateMagicLink membangkitkan token galeri yang tidak dapat ditebak.
//
// Catatan: sejak Go 1.24 crypto/rand.Read tidak pernah mengembalikan error — ia
// menjatuhkan proses kalau sumber acak sistem gagal. Error tetap diteruskan di
// sini supaya kegagalan itu eksplisit dan tidak bergantung pada janji versi Go
// tertentu, bukan karena ada jalur kegagalan yang diam-diam menghasilkan token
// lemah.
func generateMagicLink() (string, error) {
	buf := make([]byte, magicLinkBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("gagal membangkitkan magic link: %w", err)
	}
	return hex.EncodeToString(buf), nil
}

func extractDriveFolderID(url string) string {
	re := regexp.MustCompile(`[-\w]{25,}`)
	matches := re.FindString(url)
	return matches
}

// submitSelection menyimpan pilihan klien dan mengunci galeri dalam satu
// transaksi. Mengembalikan errGalleryLocked kalau galeri sudah pernah disubmit.
//
// Urutannya penting: kunci diklaim LEBIH DULU, sebelum foto lama disentuh.
// Kalau klaim gagal, tidak ada satu pun baris foto yang berubah.
//
// Klaim itu berupa satu perintah UPDATE dengan syarat status di dalam WHERE,
// bukan SELECT untuk memeriksa lalu UPDATE terpisah. Pemeriksaan dan perubahan
// harus terjadi dalam satu operasi yang sama, karena di antara dua perintah
// terpisah selalu ada celah untuk transaksi lain menyelinap: keduanya membaca
// status yang masih "pending", keduanya menyimpulkan boleh lanjut, dan keduanya
// menghapus lalu menulis ulang daftar foto.
//
// Dengan syaratnya berada di dalam UPDATE, database yang menengahi. Perintah
// pertama mengunci baris project; perintah kedua menunggu. Setelah yang pertama
// commit, yang kedua menilai ulang syaratnya terhadap versi baris yang baru,
// menemukan status sudah "submitted", dan mengubah nol baris. RowsAffected == 0
// itulah tanda kalah, dan pemanggilnya berhenti tanpa merusak apa pun.
func submitSelection(db *gorm.DB, projectID string, photos []models.Photo) error {
	return db.Transaction(func(tx *gorm.DB) error {
		lock := tx.Model(&models.Project{}).
			Where("id = ? AND status <> ?", projectID, models.StatusSubmitted).
			Update("status", models.StatusSubmitted)
		if lock.Error != nil {
			return lock.Error
		}
		if lock.RowsAffected == 0 {
			return errGalleryLocked
		}

		if err := tx.Where("project_id = ?", projectID).Delete(&models.Photo{}).Error; err != nil {
			return err
		}
		return tx.Create(&photos).Error
	})
}
