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

		return markSelection(tx, projectID, photos)
	})
}

// markSelection menandai foto mana yang dipilih klien, tanpa membuang sisanya.
//
// Sebelumnya langkah ini menghapus SELURUH baris foto project lalu menyisipkan
// ulang hanya yang dipilih. Tabel photos memikul dua tugas sekaligus — salinan
// daftar isi folder Drive, sekaligus catatan pilihan klien — dan submit
// meleburkan yang pertama ke dalam yang kedua. Empat foto yang dipilih satu
// menyisakan satu baris; tiga sisanya hilang dari database untuk selamanya.
//
// Selama Drive terbaca, kerusakan itu tidak kelihatan: galeri membaca Drive
// lebih dulu dan tetap menampilkan keempat fotonya. Ia baru muncul ketika Drive
// tidak terbaca dan galeri jatuh ke salinan database — yang isinya tinggal satu
// foto, dan tanpa thumbnail karena baris sisipan submit memang tidak
// membawanya. Itu persis yang terlihat: galeri menyusut dan gambarnya kosong.
//
// Menandai, bukan mengganti, juga yang membuat "buka kembali pemilihan"
// bermakna. Membuka status project tidak ada gunanya kalau baris fotonya sudah
// dihapus — tidak ada yang bisa dipilih ulang.
//
// Aplikasi desktop tetap bekerja tanpa perubahan: ia membaca photos dengan
// saringan is_selected, bukan menganggap seluruh isi tabel sebagai pilihan.
func markSelection(tx *gorm.DB, projectID string, selected []models.Photo) error {
	if err := tx.Model(&models.Photo{}).
		Where("project_id = ?", projectID).
		Update("is_selected", false).Error; err != nil {
		return err
	}

	names := make([]string, 0, len(selected))
	seen := make(map[string]struct{}, len(selected))
	for _, photo := range selected {
		if _, ada := seen[photo.FileName]; ada {
			continue
		}
		seen[photo.FileName] = struct{}{}
		names = append(names, photo.FileName)
	}
	if len(names) == 0 {
		return nil
	}

	if err := tx.Model(&models.Photo{}).
		Where("project_id = ? AND file_name IN ?", projectID, names).
		Update("is_selected", true).Error; err != nil {
		return err
	}

	// Nama yang tidak punya baris di database tetap harus tercatat, kalau tidak
	// aplikasi desktop tidak akan pernah tahu foto itu dipilih. Ini terjadi
	// ketika daftar isi folder berubah setelah project dibuat, atau ketika
	// project dibuat saat Drive sedang tidak terbaca sehingga salinannya kosong.
	var tersimpan []string
	if err := tx.Model(&models.Photo{}).
		Where("project_id = ? AND file_name IN ?", projectID, names).
		Pluck("file_name", &tersimpan).Error; err != nil {
		return err
	}
	ada := make(map[string]struct{}, len(tersimpan))
	for _, nama := range tersimpan {
		ada[nama] = struct{}{}
	}

	kurang := make([]models.Photo, 0)
	for _, nama := range names {
		if _, ok := ada[nama]; ok {
			continue
		}
		kurang = append(kurang, models.Photo{
			ProjectID:  projectID,
			FileName:   nama,
			IsSelected: true,
			// Thumbnail-nya tidak diketahui di jalur ini: yang dikirim klien
			// hanya nama berkas. Baris yang lahir dari sini memang tidak punya
			// gambar, tapi keberadaannya yang penting.
			ThumbnailURL: "",
		})
	}
	if len(kurang) == 0 {
		return nil
	}
	return tx.Create(&kurang).Error
}
