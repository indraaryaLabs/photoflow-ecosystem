package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"photoflow-backend/models"
)

// ErrKuotaHabis dikembalikan ketika user sudah memakai seluruh jatah galeri
// bulan ini. Dibedakan dari kegagalan lain karena tindakan yang diminta ke user
// berbeda: ini bukan galat, melainkan tawaran berlangganan.
var ErrKuotaHabis = errors.New("kuota galeri bulan ini sudah habis")

// langganan membaca langganan user, dan mengembalikan paket gratis kalau
// barisnya belum ada.
//
// Baris yang belum ada BUKAN kesalahan. Akun dibuat oleh Supabase Auth, bukan
// oleh backend ini, jadi setiap orang yang baru mendaftar pasti belum punya
// baris langganan. Memperlakukannya sebagai galat berarti seluruh dashboard
// gagal dimuat bagi pengguna baru.
func langganan(db *gorm.DB, userID string) (models.Subscription, error) {
	var s models.Subscription
	err := db.Where("user_id = ?", userID).First(&s).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return models.Subscription{UserID: userID, Plan: models.PlanFree}, nil
	}
	if err != nil {
		return models.Subscription{}, err
	}
	return s, nil
}

// pemakaianBulanIni membaca jumlah galeri yang sudah dibuat pada periode
// berjalan. Nol kalau belum ada barisnya.
func pemakaianBulanIni(db *gorm.DB, userID string, pada time.Time) (int, error) {
	var c models.UsageCounter
	err := db.Where("user_id = ? AND period = ?", userID, models.PeriodeSekarang(pada)).
		First(&c).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return c.Galleries, nil
}

// pakaiKuotaGaleri menaikkan penghitung pemakaian dan menolak kalau jatahnya
// sudah habis.
//
// WAJIB dipanggil di dalam transaksi yang sama dengan penyimpanan project.
// Alasannya balapan: memeriksa dulu lalu menaikkan kemudian menyisakan celah di
// antara keduanya, dan dua permintaan bersamaan akan sama-sama lolos
// pemeriksaan sebelum salah satunya sempat menaikkan. Di sini kenaikannya
// terjadi LEBIH DULU, secara atomik, dan nilai barunya yang dinilai — jadi
// pemenang balapan ditentukan Postgres, bukan urutan yang kebetulan.
//
// Kalau nilai barunya melewati kuota, fungsi ini mengembalikan error sehingga
// transaksinya dibatalkan dan kenaikan tadi ikut hilang. Tidak ada jatah yang
// terbuang oleh percobaan yang ditolak.
func pakaiKuotaGaleri(tx *gorm.DB, userID string, kuota int, pada time.Time) error {
	if kuota == models.KuotaTakTerbatas {
		// Paket tanpa batas tetap dihitung. Angkanya dipakai untuk memahami
		// pemakaian nyata saat menentukan harga, dan tanpa itu tidak ada dasar
		// menilai apakah batas paket di bawahnya masuk akal.
		return catatPemakaian(tx, userID, pada, nil)
	}
	return catatPemakaian(tx, userID, pada, &kuota)
}

// catatPemakaian menaikkan penghitung satu langkah dan, kalau batas diberikan,
// menolak hasil yang melewatinya.
func catatPemakaian(tx *gorm.DB, userID string, pada time.Time, batas *int) error {
	periode := models.PeriodeSekarang(pada)

	// INSERT ... ON CONFLICT DO UPDATE dalam satu perintah. Baris baru dan
	// baris yang sudah ada ditangani sekaligus, dan nilai sesudahnya
	// dikembalikan tanpa pembacaan kedua yang bisa disusupi transaksi lain.
	var sesudah int
	err := tx.Raw(`
		INSERT INTO usage_counters (user_id, period, galleries, updated_at)
		VALUES (?, ?, 1, now())
		ON CONFLICT (user_id, period)
		DO UPDATE SET galleries = usage_counters.galleries + 1, updated_at = now()
		RETURNING galleries
	`, userID, periode).Scan(&sesudah).Error
	if err != nil {
		return fmt.Errorf("menaikkan penghitung pemakaian: %w", err)
	}

	if batas != nil && sesudah > *batas {
		return ErrKuotaHabis
	}
	return nil
}

// kuotaHabis melaporkan apakah jatah bulan ini sudah terpakai penuh, tanpa
// menaikkan apa pun.
//
// Ini pemeriksaan awal, BUKAN penjaga. Penjaganya tetap pakaiKuotaGaleri di
// dalam transaksi; jawaban di sini bisa basi begitu dibaca. Gunanya menghindari
// pekerjaan mahal yang sudah pasti sia-sia — memanggil Google Drive untuk
// permintaan yang akan ditolak beberapa baris kemudian. Tanpa itu, seorang user
// yang kuotanya habis dapat memancing satu pembacaan folder ke Google pada
// setiap percobaan, dan kuota API key itu dipakai bersama semua user.
func kuotaHabis(db *gorm.DB, userID string, kuota int, pada time.Time) (bool, error) {
	if kuota == models.KuotaTakTerbatas {
		return false, nil
	}
	dipakai, err := pemakaianBulanIni(db, userID, pada)
	if err != nil {
		return false, err
	}
	return dipakai >= kuota, nil
}

// StatusLangganan adalah bentuk yang dibaca frontend untuk memutuskan apa yang
// ditampilkan: sisa kuota, ajakan berlangganan, dan apakah merek PhotoFlow
// masih menempel di galeri klien.
type StatusLangganan struct {
	Plan      string     `json:"plan"`
	Aktif     bool       `json:"active"`
	ExpiresAt *time.Time `json:"expires_at"`

	Period string `json:"period"`
	Used   int    `json:"used"`
	// Kuota bulanan. -1 berarti tanpa batas.
	Quota int `json:"quota"`
	// Sisa jatah. Tidak pernah negatif, dan nil kalau tanpa batas.
	Remaining *int `json:"remaining"`

	// Apakah galeri klien menampilkan nama studio fotografernya sendiri.
	// false berarti masih memakai merek PhotoFlow.
	OwnBranding bool `json:"own_branding"`
}

// statusLangganan menyusun ringkasan langganan satu user.
func statusLangganan(db *gorm.DB, userID string, pada time.Time) (StatusLangganan, error) {
	s, err := langganan(db, userID)
	if err != nil {
		return StatusLangganan{}, err
	}
	dipakai, err := pemakaianBulanIni(db, userID, pada)
	if err != nil {
		return StatusLangganan{}, err
	}

	kuota := s.KuotaBulanan(pada)
	status := StatusLangganan{
		Plan:        s.PlanEfektif(pada),
		Aktif:       s.Aktif(pada),
		ExpiresAt:   s.ExpiresAt,
		Period:      models.PeriodeSekarang(pada),
		Used:        dipakai,
		Quota:       kuota,
		OwnBranding: s.BolehTanpaMerek(pada),
	}
	if kuota != models.KuotaTakTerbatas {
		sisa := kuota - dipakai
		if sisa < 0 {
			sisa = 0
		}
		status.Remaining = &sisa
	}
	return status, nil
}

// jedaSalahKirim adalah tenggang membuka kembali pemilihan tanpa memakai kuota.
//
// "Buka kembali" ada untuk satu keadaan: klien menekan kirim padahal belum
// selesai memilih. Kesalahan seperti itu disadari dalam hitungan menit atau jam,
// bukan minggu. Membuka kembali jauh sesudahnya berarti project lama dipakai
// ulang untuk klien berikutnya — putaran pemilihan baru, dan itu yang dihitung.
//
// Menagih setiap pembukaan kembali akan menghukum fotografer karena kesalahan
// kliennya. Tidak menagih sama sekali membuat batas kuota tidak berarti: satu
// project bisa melayani klien tanpa batas.
const jedaSalahKirim = 24 * time.Hour

// TolakKuotaHabis membalas 402 beserta keterangan yang dapat ditindaklanjuti
// frontend.
//
// 402, bukan 403: yang menghalangi bukan izin melainkan pembayaran. Kodenya
// membuat frontend dapat membedakan "Anda tidak boleh" dari "jatah bulan ini
// habis, ini caranya menambah".
func tolakKuotaHabis(c *gin.Context, sub models.Subscription, pada time.Time, tindakan string) {
	kuota := sub.KuotaBulanan(pada)
	c.JSON(http.StatusPaymentRequired, gin.H{
		"error": fmt.Sprintf(
			"Jatah %d galeri bulan ini sudah terpakai, dan %s terhitung sebagai galeri baru. "+
				"Perpanjang paket untuk melanjutkan.", kuota, tindakan),
		"code":  "quota_exceeded",
		"plan":  sub.PlanEfektif(pada),
		"quota": kuota,
	})
}
