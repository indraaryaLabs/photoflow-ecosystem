package handlers

import (
	"crypto/rand"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"photoflow-backend/middleware"
	"photoflow-backend/models"
)

// GetSubscription mengembalikan keadaan langganan pemanggil.
//
// Dipakai dashboard untuk menampilkan sisa kuota dan ajakan berlangganan. Tidak
// pernah gagal karena barisnya belum ada: pengguna baru dijawab sebagai paket
// gratis dengan kuota penuh.
func (h *Handler) GetSubscription(c *gin.Context) {
	userID := c.GetString(middleware.ContextUserIDKey)

	status, err := statusLangganan(h.DB, userID, time.Now().UTC())
	if err != nil {
		log.Printf("[ERROR] Membaca langganan user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not read your subscription"})
		return
	}
	c.JSON(http.StatusOK, status)
}

// RedeemCode menukar kode jadi langganan aktif.
//
// Ada supaya aktivasi tidak menuntut pemilik aplikasi online. Pembeli
// mentransfer, menerima kode lewat WhatsApp, lalu menebusnya sendiri kapan pun.
func (h *Handler) RedeemCode(c *gin.Context) {
	userID := c.GetString(middleware.ContextUserIDKey)

	var input struct {
		Code string `json:"code"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "That input is not valid"})
		return
	}

	// Dinormalkan sebelum dicocokkan. Kode dibacakan lewat WhatsApp dan
	// diketik ulang, jadi spasi dan huruf kecil pasti terjadi. Menolaknya
	// hanya membuat orang mengira kodenya salah.
	kode := strings.ToUpper(strings.TrimSpace(input.Code))
	if kode == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "The code cannot be empty"})
		return
	}

	sekarang := time.Now().UTC()
	var berakhir time.Time

	err := h.DB.Transaction(func(tx *gorm.DB) error {
		// SELECT ... FOR UPDATE mengunci baris kodenya sampai transaksi
		// selesai. Tanpa itu, satu kode yang dikirim dua kali dalam sekejap
		// bisa ditebus dua akun sekaligus.
		var rc models.RedeemCode
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("code = ?", kode).First(&rc).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errKodeTidakDikenal
		}
		if err != nil {
			return err
		}
		if rc.Terpakai() {
			return errKodeSudahDipakai
		}

		sub, err := langganan(tx, userID)
		if err != nil {
			return err
		}

		// Perpanjangan dihitung dari tanggal berakhir yang sudah ada, bukan
		// dari hari ini. Pelanggan yang memperpanjang lebih awal tidak boleh
		// kehilangan sisa masa yang sudah ia bayar.
		mulai := sekarang
		if sub.Aktif(sekarang) {
			mulai = *sub.ExpiresAt
		}
		berakhir = mulai.AddDate(0, rc.Months, 0)

		baru := models.Subscription{
			UserID:    userID,
			Plan:      rc.Plan,
			ExpiresAt: &berakhir,
		}
		if err := tx.Save(&baru).Error; err != nil {
			return err
		}

		return tx.Model(&models.RedeemCode{}).
			Where("code = ?", kode).
			Updates(map[string]any{"used_by": userID, "used_at": sekarang}).Error
	})

	switch {
	case errors.Is(err, errKodeTidakDikenal):
		c.JSON(http.StatusNotFound, gin.H{"error": "That code is not recognised.", "code": "code_unknown"})
		return
	case errors.Is(err, errKodeSudahDipakai):
		c.JSON(http.StatusConflict, gin.H{"error": "This code has already been used.", "code": "code_used"})
		return
	case err != nil:
		log.Printf("[ERROR] Menebus kode untuk user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not redeem the code"})
		return
	}

	status, err := statusLangganan(h.DB, userID, sekarang)
	if err != nil {
		// Penebusannya sudah berhasil dan tersimpan. Gagal menyusun ringkasan
		// sesudahnya bukan alasan memberi tahu user bahwa kodenya gagal.
		log.Printf("[WARN] Kode tertebus tapi status gagal dibaca untuk %s: %v", userID, err)
		c.JSON(http.StatusOK, gin.H{"message": "Your code was redeemed."})
		return
	}
	c.JSON(http.StatusOK, status)
}

var (
	errKodeTidakDikenal = errors.New("kode tidak dikenal")
	errKodeSudahDipakai = errors.New("kode sudah dipakai")
)

// ── Admin ─────────────────────────────────────────────────────────────
//
// Dijaga daftar user id di environment, bukan kolom peran di database.
// Alasannya: peran yang tersimpan di database dapat diubah oleh siapa pun yang
// berhasil menulis ke database, sedangkan environment hanya dapat diubah lewat
// dashboard hosting. Untuk satu-dua administrator, daftar di env lebih sulit
// disalahgunakan dan tidak menuntut tabel baru.

// adminIDs membaca ADMIN_USER_IDS, dipisahkan koma.
func adminIDs() map[string]bool {
	set := map[string]bool{}
	for _, id := range strings.Split(os.Getenv("ADMIN_USER_IDS"), ",") {
		id = strings.TrimSpace(id)
		if id != "" {
			set[id] = true
		}
	}
	return set
}

// RequireAdmin menolak siapa pun yang bukan administrator.
//
// Dipasang SESUDAH middleware autentikasi, sehingga identitasnya sudah berasal
// dari JWT yang terverifikasi, bukan dari apa pun yang dikirim pemanggil.
func RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		daftar := adminIDs()
		if len(daftar) == 0 {
			// Belum dikonfigurasi berarti TIDAK ADA yang administrator.
			// Membiarkannya terbuka saat daftar kosong akan mengubah variabel
			// yang lupa diisi jadi rute admin tanpa penjaga.
			c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": "Not found"})
			return
		}
		if !daftar[c.GetString(middleware.ContextUserIDKey)] {
			// 404, bukan 403. Rute admin tidak perlu memberi tahu orang asing
			// bahwa ia ada.
			c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": "Not found"})
			return
		}
		c.Next()
	}
}

// AdminSetSubscription menyetel paket seorang user secara langsung.
//
// Jalur aktivasi paling sederhana: pembeli mentransfer, mengirim bukti, lalu
// paketnya disetel dari sini. Cukup sampai puluhan pelanggan; di atas itu,
// kode tebus yang mengangkat bebannya.
func (h *Handler) AdminSetSubscription(c *gin.Context) {
	var input struct {
		UserID string `json:"user_id"`
		Plan   string `json:"plan"`
		Months int    `json:"months"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "That input is not valid"})
		return
	}
	if input.UserID == "" || !planDikenal(input.Plan) || input.Months < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id, plan, and months must all be filled in correctly"})
		return
	}

	sekarang := time.Now().UTC()
	sub, err := langganan(h.DB, input.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not read your subscription"})
		return
	}

	mulai := sekarang
	if sub.Aktif(sekarang) {
		mulai = *sub.ExpiresAt
	}
	berakhir := mulai.AddDate(0, input.Months, 0)

	baru := models.Subscription{UserID: input.UserID, Plan: input.Plan, ExpiresAt: &berakhir}
	if err := h.DB.Save(&baru).Error; err != nil {
		log.Printf("[ERROR] Menyetel langganan %s: %v", input.UserID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not save the subscription"})
		return
	}

	status, _ := statusLangganan(h.DB, input.UserID, sekarang)
	c.JSON(http.StatusOK, status)
}

// planDikenal menolak nama paket yang tidak ada.
//
// Tanpa ini, salah ketik pada halaman admin akan menyimpan paket yang tidak
// dikenal siapa pun, dan KuotaBulanan menurunkannya diam-diam ke gratis —
// pelanggan yang sudah membayar tiba-tiba kehabisan kuota tanpa penjelasan.
func planDikenal(p string) bool {
	return p == models.PlanFree || p == models.PlanFreelance || p == models.PlanStudio
}

// hurufKode adalah alfabet kode tebus.
//
// Tanpa 0, O, 1, I, dan L. Kode ini dibacakan lewat WhatsApp lalu diketik ulang
// orang lain, dan pasangan huruf-angka yang mirip adalah sumber keluhan
// "kodenya tidak bisa" yang sebenarnya cuma salah baca.
const hurufKode = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

// buatKode membangkitkan kode berbentuk PF-XXXX-XXXX.
//
// Memakai crypto/rand, bukan math/rand: kode ini bernilai uang, dan deret yang
// dapat ditebak berarti langganan gratis bagi siapa pun yang mau menebaknya.
func buatKode() (string, error) {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	huruf := make([]byte, 8)
	for i, b := range buf {
		huruf[i] = hurufKode[int(b)%len(hurufKode)]
	}
	return fmt.Sprintf("PF-%s-%s", huruf[:4], huruf[4:]), nil
}

// AdminCreateCodes membangkitkan sejumlah kode tebus sekaligus.
//
// Dibuat dalam jumlah banyak karena begitulah dipakainya: satu batch untuk
// promo perintis, satu batch untuk dititipkan ke reseller.
func (h *Handler) AdminCreateCodes(c *gin.Context) {
	var input struct {
		Plan   string `json:"plan"`
		Months int    `json:"months"`
		Count  int    `json:"count"`
		Note   string `json:"note"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "That input is not valid"})
		return
	}
	if !planDikenal(input.Plan) || input.Plan == models.PlanFree {
		c.JSON(http.StatusBadRequest, gin.H{"error": "plan must be freelance or studio"})
		return
	}
	if input.Months < 1 || input.Count < 1 || input.Count > 200 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "months must be at least 1, and count between 1 and 200"})
		return
	}

	kode := make([]models.RedeemCode, 0, input.Count)
	for i := 0; i < input.Count; i++ {
		k, err := buatKode()
		if err != nil {
			log.Printf("[ERROR] Membangkitkan kode: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not generate the codes"})
			return
		}
		kode = append(kode, models.RedeemCode{
			Code: k, Plan: input.Plan, Months: input.Months, Note: strings.TrimSpace(input.Note),
		})
	}

	if err := h.DB.Create(&kode).Error; err != nil {
		log.Printf("[ERROR] Menyimpan kode: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not save the codes"})
		return
	}

	daftar := make([]string, len(kode))
	for i, k := range kode {
		daftar[i] = k.Code
	}
	c.JSON(http.StatusCreated, gin.H{"codes": daftar, "plan": input.Plan, "months": input.Months})
}
