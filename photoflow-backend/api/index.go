package api

import (
	"net/http"
	"sync" // Kita butuh library ini untuk mencegah koneksi ganda

	"photoflow-backend/app"
)

var ginApp http.Handler
var once sync.Once // Fitur pengaman agar database tidak disambung berulang kali

// Handler adalah entry point mutlak untuk Vercel Serverless
func Handler(w http.ResponseWriter, r *http.Request) {
	// LAZY INITIALIZATION:
	// SetupRouter hanya akan dijalankan 1 KALI saja tepat saat request pertama masuk.
	// Di detik ini, Vercel DIJAMIN sudah memuat semua Environment Variables.
	once.Do(func() {
		ginApp = app.SetupRouter()
	})

	ginApp.ServeHTTP(w, r)
}
