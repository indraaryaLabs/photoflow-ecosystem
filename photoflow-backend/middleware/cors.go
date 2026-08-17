package middleware

import (
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

// defaultOrigins dipakai ketika ALLOWED_ORIGINS tidak disetel.
//
// Nilai bawaan ini ada supaya repo dapat di-clone lalu dijalankan tanpa
// menyiapkan apa pun, sama seperti alasan VITE_API_BASE punya nilai bawaan.
var defaultOrigins = []string{
	"https://photoflow-ecosystem.vercel.app",
	"http://localhost:5173", // Vite dev server
}

// AllowedOrigins membaca daftar origin yang diizinkan.
//
// Sebelumnya daftar ini ditulis langsung di dalam fungsi CORS. Akibatnya
// mengganti alamat frontend -- misalnya mengubah nama project Vercel dari
// photoflow-ecosystem jadi photoflow -- menuntut perubahan kode dan deploy
// ulang backend. Sampai keduanya selesai, seluruh aplikasi mati: setiap
// panggilan API ditolak peramban, dan yang terlihat bukan pesan yang jelas
// melainkan galeri kosong dan dashboard yang gagal memuat.
//
// Dengan dibaca dari environment, alamat baru cukup ditambahkan sebagai
// variabel di Vercel.
func AllowedOrigins() map[string]bool {
	mentah := strings.TrimSpace(os.Getenv("ALLOWED_ORIGINS"))

	daftar := defaultOrigins
	if mentah != "" {
		daftar = strings.Split(mentah, ",")
	}

	izin := make(map[string]bool, len(daftar))
	for _, o := range daftar {
		// Spasi dan garis miring di ujung dibersihkan. Header Origin yang
		// dikirim peramban tidak pernah berakhiran garis miring, jadi satu
		// karakter itu di variabel environment membuat pencocokannya meleset
		// tanpa petunjuk apa pun.
		o = strings.TrimRight(strings.TrimSpace(o), "/")
		if o != "" {
			izin[o] = true
		}
	}
	return izin
}

// CORS mengizinkan hanya origin yang terdaftar.
func CORS() gin.HandlerFunc {
	// Dibaca sekali saat router dibangun, bukan pada tiap permintaan.
	allowedOrigins := AllowedOrigins()

	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")

		if allowedOrigins[origin] {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
		}

		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With, ngrok-skip-browser-warning")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE, PATCH")
		c.Writer.Header().Set("Vary", "Origin")

		// Tangani Preflight Request
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}
