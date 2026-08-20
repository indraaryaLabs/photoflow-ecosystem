package api

import (
	"log"
	"net/http"
	"sync" // Kita butuh library ini untuk mencegah koneksi ganda

	"photoflow-backend/app"
)

var (
	ginApp   http.Handler
	setupErr error
	once     sync.Once // Fitur pengaman agar database tidak disambung berulang kali
)

// Handler adalah entry point mutlak untuk Vercel Serverless
func Handler(w http.ResponseWriter, r *http.Request) {
	// LAZY INITIALIZATION:
	// SetupRouter hanya akan dijalankan 1 KALI saja tepat saat request pertama masuk.
	// Di detik ini, Vercel DIJAMIN sudah memuat semua Environment Variables.
	once.Do(func() {
		ginApp, setupErr = app.SetupRouter()
		if setupErr != nil {
			log.Printf("[ERROR] Gagal menyiapkan server: %v", setupErr)
		}
	})

	// Setup yang gagal dibalas sebagai 503, bukan panic. Penyebabnya ada di log;
	// pemanggil tidak perlu tahu detail konfigurasi.
	if setupErr != nil {
		http.Error(w, "Service unavailable", http.StatusServiceUnavailable)
		return
	}

	ginApp.ServeHTTP(w, r)
}
