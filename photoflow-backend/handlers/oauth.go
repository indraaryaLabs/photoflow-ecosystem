package handlers

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"golang.org/x/oauth2"

	"photoflow-backend/models"
)

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

// GoogleLogin mengalihkan user ke layar consent Google.
//
// PERHATIAN: user_id diambil mentah dari query dan dipakai sebagai parameter
// `state`. Itu kerentanan yang tercatat sebagai F-05 di FINDINGS.md dan
// dijadwalkan diperbaiki di Fase 2. Perilakunya sengaja tidak diubah di sini
// karena Fase 5 adalah refactor murni.
func (h *Handler) GoogleLogin(c *gin.Context) {
	userID := c.Query("user_id")
	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id wajib disertakan sebagai query parameter"})
		return
	}

	// Encode user_id ke dalam state agar bisa diambil kembali di callback
	state := userID

	// Generate URL OAuth Google dengan prompt select_account + consent & access_type offline
	// select_account = paksa pilih akun (Fast Account Switching)
	// consent = paksa consent screen agar Google selalu memberikan Refresh Token
	url := h.OAuth.AuthCodeURL(state,
		oauth2.AccessTypeOffline,
		oauth2.SetAuthURLParam("prompt", "select_account consent"),
	)

	c.Redirect(http.StatusTemporaryRedirect, url)
}

// GoogleCallback menukar authorization code jadi refresh token lalu
// menyimpannya ke profil user.
func (h *Handler) GoogleCallback(c *gin.Context) {
	// Ambil authorization code & state (user_id) dari Google
	code := c.Query("code")
	state := c.Query("state") // berisi user_id

	if code == "" {
		c.String(http.StatusBadRequest, "Authorization code tidak ditemukan.")
		return
	}

	if state == "" {
		c.String(http.StatusBadRequest, "State (user_id) tidak valid.")
		return
	}

	userID := state

	// Tukar authorization code menjadi Access Token + Refresh Token
	token, err := h.OAuth.Exchange(c.Request.Context(), code)
	if err != nil {
		log.Printf("🔴 OAuth Exchange Error: %v", err)
		c.String(http.StatusInternalServerError, "Gagal menukar authorization code: %v", err)
		return
	}

	refreshToken := token.RefreshToken

	// Safety: Jika Google tidak memberikan refresh_token (edge case),
	// biarkan token lama di database tetap utuh, jangan overwrite dengan string kosong.
	if refreshToken == "" {
		log.Printf("⚠️ Refresh Token kosong untuk user %s. Token lama dipertahankan.", userID)
	} else {
		// Simpan Refresh Token ke tabel profiles berdasarkan user_id
		result := h.DB.Model(&models.Profile{}).Where("id = ?", userID).Update("gdrive_refresh_token", refreshToken)
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

	// Tampilkan halaman sukses sederhana
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(oauthSuccessPage))
}
