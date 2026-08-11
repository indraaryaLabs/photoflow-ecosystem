package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"net/http"
	neturl "net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/oauth2"
	"gorm.io/gorm"

	"photoflow-backend/middleware"
	"photoflow-backend/models"
)

// oauthStateBytes menentukan entropi parameter `state`. 32 byte membuatnya
// tidak dapat ditebak, yang justru merupakan seluruh gunanya.
const oauthStateBytes = 32

// oauthStateTTL membatasi umur satu permintaan koneksi. Cukup panjang untuk
// user memilih akun dan membaca layar consent, cukup pendek supaya state yang
// terlantar tidak menumpuk.
const oauthStateTTL = 10 * time.Minute

// oauthSuccessPage ditampilkan setelah user menyelesaikan koneksi Google Drive.
const oauthSuccessPage = `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PhotoFlow - Koneksi Berhasil</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #0f0f23 0%, #1a1a3e 50%, #0f0f23 100%);
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            color: #e0e0e0;
        }
        .card {
            background: rgba(255,255,255,0.05);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 24px;
            padding: 48px;
            text-align: center;
            max-width: 480px;
            box-shadow: 0 25px 60px rgba(0,0,0,0.5);
        }
        .icon { font-size: 64px; margin-bottom: 24px; }
        h1 {
            font-size: 24px;
            font-weight: 700;
            color: #ffffff;
            margin-bottom: 12px;
        }
        p {
            font-size: 16px;
            line-height: 1.6;
            color: #a0a0b8;
        }
        .highlight { color: #6ee7b7; font-weight: 600; }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">✅</div>
        <h1>Koneksi Google Drive Berhasil!</h1>
        <p>Akun Google Anda telah terhubung dengan <span class="highlight">PhotoFlow</span>.</p>
        <p style="margin-top: 16px;">Silakan kembali ke aplikasi PhotoFlow dan lanjutkan pekerjaan Anda.</p>
    </div>
</body>
</html>
	`

// newOAuthState membangkitkan nilai state yang tidak dapat ditebak.
func newOAuthState() (string, error) {
	buf := make([]byte, oauthStateBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("gagal membangkitkan state OAuth: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// GoogleAuthURL memulai alur koneksi Google Drive untuk user yang sedang login.
//
// Rute ini terautentikasi dan mengembalikan URL, BUKAN redirect. Alasannya
// teknis: navigasi teratas browser tidak membawa header Authorization, jadi
// sebuah redirect tidak punya cara membuktikan siapa yang memintanya. Dulu
// masalah itu "diselesaikan" dengan menerima user_id dari query string, yang
// berarti identitasnya ditentukan oleh pihak yang sedang diautentikasi.
//
// Frontend memanggil rute ini dengan Bearer token, lalu mengarahkan browser ke
// auth_url yang dikembalikan.
func (h *Handler) GoogleAuthURL(c *gin.Context) {
	userID := c.GetString(middleware.ContextUserIDKey)

	// Body-nya opsional: aplikasi desktop memanggil endpoint ini tanpa isi.
	var input struct {
		ReturnTo string `json:"return_to"`
	}
	_ = c.ShouldBindJSON(&input)

	state, err := newOAuthState()
	if err != nil {
		log.Printf("🔴 %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal memulai koneksi Google Drive"})
		return
	}

	// Pemetaan state ke user disimpan di sisi server. Inilah yang membuat
	// callback tidak perlu mempercayai apa pun yang dibawa kembali browser.
	record := models.OAuthState{
		State:     state,
		UserID:    userID,
		ExpiresAt: time.Now().Add(oauthStateTTL),
	}
	if err := h.DB.Create(&record).Error; err != nil {
		log.Printf("🔴 Gagal menyimpan state OAuth: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal memulai koneksi Google Drive"})
		return
	}

	// Buang state kedaluwarsa sekalian; tidak butuh cron untuk tabel sekecil ini.
	if err := h.DB.Where("expires_at < ?", time.Now()).Delete(&models.OAuthState{}).Error; err != nil {
		log.Printf("⚠️ Gagal membersihkan state OAuth kedaluwarsa: %v", err)
	}

	// Ke mana user dikembalikan setelah menyetujui. Aplikasi desktop tidak
	// mengirimnya dan tetap mendapat halaman "berhasil"; dashboard web
	// mengirimnya supaya orangnya kembali ke tempat ia menekan tombol, bukan
	// terdampar di halaman backend tanpa jalan pulang.
	//
	// Nilainya harus sama persis dengan Origin permintaan ini. Menerima alamat
	// sembarang akan menjadikan endpoint ini pengalih terbuka.
	if returnTo := strings.TrimSpace(input.ReturnTo); returnTo != "" {
		if !sameOrigin(returnTo, c.GetHeader("Origin")) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "return_to tidak diizinkan"})
			return
		}
		if err := h.DB.Model(&models.OAuthState{}).
			Where("state = ?", state).Update("return_to", returnTo).Error; err != nil {
			log.Printf("⚠️ Gagal menyimpan return_to: %v", err)
		}
	}

	// access_type offline agar Google memberikan refresh token.
	// prompt select_account consent agar user bisa berganti akun dan Google
	// selalu mengirim refresh token, bukan hanya pada persetujuan pertama.
	url := h.OAuth.AuthCodeURL(state,
		oauth2.AccessTypeOffline,
		oauth2.SetAuthURLParam("prompt", "select_account consent"),
	)

	c.JSON(http.StatusOK, gin.H{"auth_url": url})
}

// GoogleCallback menyelesaikan alur koneksi: mencocokkan state, menukar
// authorization code, lalu menyimpan refresh token ke profil user.
func (h *Handler) GoogleCallback(c *gin.Context) {
	code := c.Query("code")
	state := c.Query("state")

	if code == "" {
		c.String(http.StatusBadRequest, "Authorization code tidak ditemukan.")
		return
	}
	if state == "" {
		c.String(http.StatusBadRequest, "State tidak valid.")
		return
	}

	userID, returnTo, err := h.consumeOAuthState(state)
	if err != nil {
		// Pesannya sengaja seragam: pemanggil tidak perlu tahu apakah state-nya
		// tidak pernah ada, sudah terpakai, atau kedaluwarsa.
		log.Printf("⚠️ State OAuth ditolak: %v", err)
		c.String(http.StatusBadRequest, "Permintaan koneksi tidak valid atau sudah kedaluwarsa. Silakan ulangi dari aplikasi.")
		return
	}

	token, err := h.OAuth.Exchange(c.Request.Context(), code)
	if err != nil {
		log.Printf("🔴 OAuth Exchange Error: %v", err)
		c.String(http.StatusInternalServerError, "Gagal menukar authorization code.")
		return
	}

	// Safety: Jika Google tidak memberikan refresh_token (edge case),
	// biarkan token lama di database tetap utuh, jangan overwrite dengan string kosong.
	if token.RefreshToken == "" {
		log.Printf("⚠️ Refresh Token kosong untuk user %s. Token lama dipertahankan.", userID)
	} else {
		result := h.DB.Model(&models.Profile{}).Where("id = ?", userID).
			Update("gdrive_refresh_token", token.RefreshToken)
		if result.Error != nil {
			log.Printf("🔴 DB Update Error: %v", result.Error)
			c.String(http.StatusInternalServerError, "Gagal menyimpan refresh token ke database.")
			return
		}
		if result.RowsAffected == 0 {
			c.String(http.StatusNotFound, "Profile dengan user_id tersebut tidak ditemukan.")
			return
		}
		log.Printf("✅ Refresh Token berhasil disimpan untuk user: %s", userID)
	}

	if returnTo != "" {
		c.Redirect(http.StatusFound, returnTo)
		return
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(oauthSuccessPage))
}

// sameOrigin melaporkan apakah rawURL punya skema dan host yang sama persis
// dengan origin. Perbandingannya sengaja ketat: cocok sebagian (misalnya
// memeriksa awalan string) adalah cara klasik pengalih terbuka lolos, karena
// "https://photoflow.app.penyerang.com" berawalan sama dengan situs aslinya.
func sameOrigin(rawURL, origin string) bool {
	if origin == "" {
		return false
	}
	a, err := neturl.Parse(rawURL)
	if err != nil || (a.Scheme != "http" && a.Scheme != "https") || a.Host == "" {
		return false
	}
	b, err := neturl.Parse(origin)
	if err != nil {
		return false
	}
	return a.Scheme == b.Scheme && a.Host == b.Host
}

// consumeOAuthState menukar state dengan user yang memulainya, sekali pakai.
//
// Penghapusan dan pembacaan dilakukan dalam satu perintah DELETE ... RETURNING,
// bukan SELECT lalu DELETE terpisah. Alasannya sama seperti gallery lock: dua
// perintah terpisah menyisakan celah bagi dua callback bersamaan untuk
// sama-sama lolos memakai state yang sama.
func (h *Handler) consumeOAuthState(state string) (string, string, error) {
	var record models.OAuthState
	err := h.DB.Raw(
		`DELETE FROM oauth_states WHERE state = ? RETURNING state, user_id, expires_at, return_to`,
		state,
	).Scan(&record).Error
	if err != nil {
		return "", "", fmt.Errorf("gagal membaca state: %w", err)
	}
	if record.UserID == "" {
		return "", "", errors.New("state tidak dikenal atau sudah dipakai")
	}
	if time.Now().After(record.ExpiresAt) {
		return "", "", errors.New("state sudah kedaluwarsa")
	}
	return record.UserID, record.ReturnTo, nil
}

// ensureNoLegacyStateUsage menahan agar tipe gorm.DB tetap terpakai eksplisit
// pada berkas ini; dihapus kalau tidak lagi diperlukan.
var _ = func(db *gorm.DB) {}
