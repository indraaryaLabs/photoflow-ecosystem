// Package app merangkai dependensi lalu mendaftarkan rute.
//
// Paket ini sengaja tidak memuat logika: model ada di models, akses database di
// db, integrasi Drive di storage, dan handler di handlers. Yang tersisa di sini
// hanyalah peta rute, sehingga daftar endpoint beserta middleware yang menjaga
// masing-masing bisa dibaca sekali lihat.
package app

import (
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"

	"photoflow-backend/db"
	"photoflow-backend/handlers"
	"photoflow-backend/middleware"
	"photoflow-backend/storage"
)

// magicLinkWindow dan magicLinkMaxFailures membatasi percobaan gagal pada
// pencarian magic link. Ini lapis kedua: yang benar-benar membuat token tidak
// dapat ditebak adalah entropinya, dan pembatasan per IP tetap bisa dilewati
// penyerang yang punya banyak IP.
const (
	magicLinkWindow      = 10 * time.Minute
	magicLinkMaxFailures = 20
	maxRequestBodyBytes  = 1 << 20
)

// SetupRouter membangun engine gin beserta dependensinya.
//
// Kegagalan dikembalikan sebagai error, bukan diakhiri log.Fatal. Backend ini
// berjalan sebagai fungsi serverless: mematikan proses di jalur setup mengubah
// kesalahan konfigurasi jadi crash tanpa konteks pada setiap cold start.
//
// Migrasi skema TIDAK dijalankan di sini. Sebelumnya AutoMigrate dan ALTER TABLE
// ikut berjalan pada setiap cold start, sehingga perubahan skema jadi efek
// samping dari lalu lintas biasa. Sekarang keduanya ada di cmd/migrate dan harus
// dijalankan dengan sengaja.
func SetupRouter() (*gin.Engine, error) {
	godotenv.Load()

	conn, err := db.Open(os.Getenv("DATABASE_URL"))
	if err != nil {
		return nil, err
	}
	fmt.Println("🚀 Database Terkoneksi!")

	// Verifier JWT Supabase. Konfigurasi yang salah dihentikan di sini supaya
	// server tidak pernah menyala dengan rute admin yang tidak terlindungi.
	authVerifier, err := middleware.NewVerifier(os.Getenv("SUPABASE_URL"))
	if err != nil {
		return nil, fmt.Errorf("konfigurasi auth tidak valid: %w", err)
	}
	requireAuth := authVerifier.RequireAuth()

	limiter := middleware.NewLimiter(conn, magicLinkWindow, magicLinkMaxFailures)
	h := handlers.New(conn, storage.GetOAuthConfig(), limiter)

	r := gin.Default()

	// Jangan percayai header proxy secara otomatis. Penentuan IP klien untuk
	// rate limiting dilakukan eksplisit di middleware.Limiter, dari header yang
	// diset platform saja.
	if err := r.SetTrustedProxies(nil); err != nil {
		return nil, fmt.Errorf("gagal menyetel trusted proxies: %w", err)
	}

	// Middleware dipasang SEBELUM rute apa pun didaftarkan. Sebelumnya rute "/"
	// terdaftar lebih dulu sehingga tidak pernah melewati CORS.
	r.Use(middleware.CORS())
	r.Use(middleware.MaxBodySize(maxRequestBodyBytes))

	r.GET("/", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"message": "PhotoFlow API is running perfectly! 🚀"})
	})

	// Diagnostik untuk membuktikan header sumber IP di lingkungan nyata.
	// Mengembalikan 404 kecuali DEBUG_CLIENT_IP=1.
	r.GET("/api/debug/client-ip", limiter.DebugClientIP)

	// --- KONEKSI GOOGLE DRIVE (OAUTH2) ---
	// Rute pembuka alur butuh JWT dan mengembalikan URL, bukan redirect:
	// navigasi teratas browser tidak membawa header Authorization, sehingga
	// sebuah redirect tidak punya cara membuktikan siapa yang memintanya.
	r.POST("/api/auth/google/url", requireAuth, h.GoogleAuthURL)
	r.GET("/api/auth/google/callback", h.GoogleCallback)

	// --- GALERI KLIEN: publik, diakses lewat magic link tanpa login ---
	r.GET("/api/p/:magic_link", h.GetGallery)
	r.GET("/api/p/:magic_link/photos", h.GalleryPhotos)
	r.POST("/api/p/:magic_link/submit", h.SubmitSelection)

	// --- DASHBOARD ADMIN: butuh JWT Supabase yang sah ---
	r.POST("/api/projects", requireAuth, h.CreateProject)
	r.GET("/api/projects", requireAuth, h.ListProjects)
	r.PUT("/api/projects/:id", requireAuth, h.UpdateProject)
	r.DELETE("/api/projects/:id", requireAuth, h.DeleteProject)

	// Daftar nama berkas yang dipilih klien, untuk ditempel ke penyaring
	// Lightroom. Lihat handlers.ListSelections.
	r.GET("/api/projects/:id/selections", requireAuth, h.ListSelections)

	// Menerbitkan magic link baru dan mematikan yang lama. Lihat
	// handlers.RotateMagicLink.
	r.POST("/api/projects/:id/rotate-link", requireAuth, h.RotateMagicLink)

	// Jalan pulang dari status "submitted". Lihat handlers.ReopenSelection
	// untuk alasan kenapa ini perlu ada.
	r.POST("/api/projects/:id/reopen", requireAuth, h.ReopenSelection)

	// Menarik ulang daftar foto dari Drive untuk project yang sudah ada. Tanpa
	// ini, membetulkan izin folder setelah project dibuat tidak ada gunanya.
	r.POST("/api/projects/:id/resync", requireAuth, h.ResyncProject)

	// --- GOOGLE DRIVE ---
	// Dipakai desktop app untuk mengunduh berkas aslinya.
	//
	// GET /api/gdrive/:folderId sudah DIHAPUS. Rute itu menerima ID folder apa
	// pun dari siapa pun tanpa memeriksa hubungan pemanggil dengan folder
	// tersebut, sehingga berfungsi sebagai proxy terbuka ke setiap folder yang
	// terjangkau service account. Penggantinya GET /api/p/:magic_link/photos,
	// yang menentukan pemilik lewat galeri yang diminta.
	r.GET("/api/gdrive/token", requireAuth, h.DriveToken)

	// Dipakai dashboard web untuk tahu apakah Drive sudah terhubung, sebelum
	// kegagalan pertama terjadi.
	r.GET("/api/gdrive/status", requireAuth, h.DriveStatus)

	return r, nil
}
