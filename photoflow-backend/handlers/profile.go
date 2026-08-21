package handlers

import (
	"log"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"photoflow-backend/middleware"
	"photoflow-backend/models"
)

// maxStudioNameLength membatasi panjang nama studio.
//
// Batasnya ada bukan demi database — kolomnya text dan tidak peduli — melainkan
// demi tempat namanya muncul: satu baris di kepala galeri klien, di sebelah
// lambang, pada layar ponsel. Nama yang lebih panjang dari ini tidak akan
// terbaca utuh di sana, jadi lebih baik ditolak saat diketik daripada dipotong
// diam-diam saat ditampilkan.
const maxStudioNameLength = 60

type profilInput struct {
	StudioName string `json:"studio_name"`
}

// GetProfile mengembalikan profil milik pemanggil.
func (h *Handler) GetProfile(c *gin.Context) {
	userID := c.GetString(middleware.ContextUserIDKey)

	var profil models.Profile
	err := h.DB.Where("id = ?", userID).First(&profil).Error
	if err != nil {
		// Profil dibuat oleh trigger handle_new_user() milik Supabase, bukan
		// oleh backend ini. Akun yang mendaftar sebelum trigger itu ada tidak
		// punya barisnya, dan itu bukan alasan untuk menggagalkan permintaan:
		// yang benar adalah melaporkan keadaan kosong, yang memang keadaannya.
		c.JSON(http.StatusOK, gin.H{"studio_name": ""})
		return
	}

	c.JSON(http.StatusOK, gin.H{"studio_name": strings.TrimSpace(profil.StudioName)})
}

// UpdateProfile menyimpan nama studio milik pemanggil.
func (h *Handler) UpdateProfile(c *gin.Context) {
	userID := c.GetString(middleware.ContextUserIDKey)

	var input profilInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "The profile data is not valid"})
		return
	}

	name := strings.TrimSpace(input.StudioName)
	// Dihitung dalam rune, bukan byte. Nama yang memuat huruf beraksen atau
	// aksara non-Latin memakai beberapa byte per huruf, dan membatasi per byte
	// akan menolak nama yang di layar jelas-jelas pendek.
	if utf8.RuneCountInString(name) > maxStudioNameLength {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Studio name is too long. Keep it under 60 characters.",
		})
		return
	}

	// UPSERT, bukan UPDATE. Baris profil dibuat trigger Supabase saat
	// pendaftaran; akun yang mendaftar sebelum trigger itu ada tidak punya
	// barisnya sama sekali, dan UPDATE terhadapnya berhasil tanpa mengubah apa
	// pun — permintaannya dijawab 200 dan namanya tetap hilang.
	err := h.DB.Exec(`
		INSERT INTO profiles (id, studio_name) VALUES (?, ?)
		ON CONFLICT (id) DO UPDATE SET studio_name = EXCLUDED.studio_name`,
		userID, name).Error
	if err != nil {
		log.Printf("[ERROR] Menyimpan nama studio untuk %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not save your profile"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"studio_name": name})
}
