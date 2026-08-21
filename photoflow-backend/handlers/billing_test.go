package handlers

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"photoflow-backend/middleware"
	"photoflow-backend/models"
)

// Dua hal yang dijaga berkas ini, dan keduanya adalah pertahanan komersial
// aplikasi ini — bukan sekadar perilaku yang rapi:
//
//  1. Kuota tidak dapat dipulihkan dengan menghapus project. Kalau bisa, siapa
//     pun memakai galeri tanpa batas dengan cara buat, kirim, hapus.
//  2. Merek PhotoFlow pada galeri gratis tidak dapat dilepas. Batas jumlah bisa
//     direset dengan membuat akun baru; merek tidak. Itulah yang membuat akun
//     ganda tidak menyelesaikan apa pun.

func siapkanBilling(t *testing.T, db *gorm.DB) {
	t.Helper()
	db.Exec("DROP TABLE IF EXISTS subscriptions")
	db.Exec("DROP TABLE IF EXISTS usage_counters")
	db.Exec("DROP TABLE IF EXISTS redeem_codes")
	if err := db.AutoMigrate(&models.Subscription{}, &models.UsageCounter{}, &models.RedeemCode{}); err != nil {
		t.Fatalf("gagal menyiapkan tabel billing: %v", err)
	}
}

// beriLangganan menyetel paket seorang user langsung di database.
func beriLangganan(t *testing.T, db *gorm.DB, userID, plan string, berlakuSampai time.Time) {
	t.Helper()
	s := models.Subscription{UserID: userID, Plan: plan, ExpiresAt: &berlakuSampai}
	if err := db.Save(&s).Error; err != nil {
		t.Fatalf("gagal menyetel langganan: %v", err)
	}
}

// buatProject memanggil CreateProject dan mengembalikan status beserta body.
func buatProject(t *testing.T, h *Handler, userID, nama string) (int, map[string]any) {
	t.Helper()

	body := fmt.Sprintf(`{
		"project_name": %q,
		"client_name": "Klien",
		"max_selections": 10,
		"drive_folder_url": "https://drive.google.com/drive/folders/1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	}`, nama)

	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest("POST", "/api/projects", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set(middleware.ContextUserIDKey, userID)

	h.CreateProject(c)

	var keluar map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &keluar)
	return rec.Code, keluar
}

func jumlahProject(t *testing.T, db *gorm.DB, userID string) int64 {
	t.Helper()
	var n int64
	db.Model(&models.Project{}).Where("user_id = ?", userID).Count(&n)
	return n
}

func TestPaketGratisDibatasiTigaGaleri(t *testing.T) {
	db := newSubmitTestDB(t)
	siapkanBilling(t, db)
	h := &Handler{DB: db}
	user := uuid.NewString()

	for i := 1; i <= 3; i++ {
		if kode, _ := buatProject(t, h, user, fmt.Sprintf("Project %d", i)); kode != 201 {
			t.Fatalf("galeri ke-%d ditolak dengan %d, seharusnya masih dalam kuota", i, kode)
		}
	}

	kode, body := buatProject(t, h, user, "Project 4")
	if kode != 402 {
		t.Fatalf("galeri ke-4 dibalas %d, mau 402", kode)
	}
	if body["code"] != "quota_exceeded" {
		t.Errorf("code = %v, mau quota_exceeded", body["code"])
	}
	if n := jumlahProject(t, db, user); n != 3 {
		t.Errorf("tersimpan %d project, mau 3 — percobaan yang ditolak ikut tersimpan", n)
	}
}

// Inti pertahanannya. Kalau menghapus mengembalikan jatah, seluruh batas kuota
// kehilangan artinya: buat, kirim tautannya, hapus, ulangi.
func TestMenghapusProjectTidakMengembalikanKuota(t *testing.T) {
	db := newSubmitTestDB(t)
	siapkanBilling(t, db)
	h := &Handler{DB: db}
	user := uuid.NewString()

	for i := 1; i <= 3; i++ {
		buatProject(t, h, user, fmt.Sprintf("Project %d", i))
	}

	// Hapus semuanya, seolah fotografer merapikan project yang sudah selesai.
	if err := db.Where("user_id = ?", user).Delete(&models.Project{}).Error; err != nil {
		t.Fatalf("gagal menghapus project: %v", err)
	}
	if n := jumlahProject(t, db, user); n != 0 {
		t.Fatalf("masih ada %d project setelah dihapus", n)
	}

	kode, _ := buatProject(t, h, user, "Project baru setelah menghapus")
	if kode != 402 {
		t.Fatalf("dibalas %d setelah menghapus semua project, mau 402 — "+
			"kuota dapat dipulihkan dengan menghapus", kode)
	}
}

func TestPaketStudioTidakDibatasi(t *testing.T) {
	db := newSubmitTestDB(t)
	siapkanBilling(t, db)
	h := &Handler{DB: db}
	user := uuid.NewString()
	beriLangganan(t, db, user, models.PlanStudio, time.Now().UTC().AddDate(0, 3, 0))

	for i := 1; i <= 25; i++ {
		if kode, _ := buatProject(t, h, user, fmt.Sprintf("Project %d", i)); kode != 201 {
			t.Fatalf("galeri ke-%d ditolak dengan %d pada paket tanpa batas", i, kode)
		}
	}

	// Pemakaian tetap dicatat walau tanpa batas: angkanya yang jadi dasar
	// menilai apakah batas paket di bawahnya masuk akal.
	var c models.UsageCounter
	db.Where("user_id = ?", user).First(&c)
	if c.Galleries != 25 {
		t.Errorf("tercatat %d galeri, mau 25", c.Galleries)
	}
}

func TestLanggananYangSudahLewatKembaliKeKuotaGratis(t *testing.T) {
	db := newSubmitTestDB(t)
	siapkanBilling(t, db)
	h := &Handler{DB: db}
	user := uuid.NewString()
	beriLangganan(t, db, user, models.PlanStudio, time.Now().UTC().AddDate(0, 0, -1))

	for i := 1; i <= 3; i++ {
		buatProject(t, h, user, fmt.Sprintf("Project %d", i))
	}
	if kode, _ := buatProject(t, h, user, "Project 4"); kode != 402 {
		t.Fatalf("dibalas %d, mau 402 — langganan kedaluwarsa masih memberi kuota studio", kode)
	}
}

// Pertahanan terhadap akun ganda. Batas jumlah dapat direset dengan mendaftar
// lagi; merek tidak. Fotografer yang ingin kliennya melihat nama studionya
// sendiri harus membayar, berapa pun akun yang ia buat.
func TestGaleriGratisSelaluBermerekPhotoFlow(t *testing.T) {
	db := newSubmitTestDB(t)
	siapkanBilling(t, db)
	siapkanProfiles(t, db)
	h := &Handler{DB: db}
	user := uuid.NewString()

	if err := db.Exec(
		"INSERT INTO profiles (id, studio_name) VALUES (?, ?)", user, "Studio Sembilan",
	).Error; err != nil {
		t.Fatalf("gagal menyiapkan profil: %v", err)
	}

	if got := h.namaStudio(user); got != "" {
		t.Errorf("paket gratis mengembalikan nama studio %q, mau kosong", got)
	}

	beriLangganan(t, db, user, models.PlanFreelance, time.Now().UTC().AddDate(0, 3, 0))
	if got := h.namaStudio(user); got != "Studio Sembilan" {
		t.Errorf("paket berbayar mengembalikan %q, mau %q", got, "Studio Sembilan")
	}
}

func TestMenebusKodeMengaktifkanLangganan(t *testing.T) {
	db := newSubmitTestDB(t)
	siapkanBilling(t, db)
	h := &Handler{DB: db}
	user := uuid.NewString()

	db.Create(&models.RedeemCode{Code: "PF-TEST-AAAA", Plan: models.PlanFreelance, Months: 3})

	kode, body := tebusKode(t, h, user, "pf-test-aaaa") // huruf kecil, sengaja
	if kode != 200 {
		t.Fatalf("penebusan dibalas %d, mau 200 (body: %v)", kode, body)
	}
	if body["plan"] != models.PlanFreelance {
		t.Errorf("plan = %v, mau %v", body["plan"], models.PlanFreelance)
	}
	if body["active"] != true {
		t.Errorf("active = %v, mau true", body["active"])
	}

	// Kuota freelance sekarang berlaku: galeri ke-4 tidak lagi ditolak.
	for i := 1; i <= 4; i++ {
		if k, _ := buatProject(t, h, user, fmt.Sprintf("Project %d", i)); k != 201 {
			t.Fatalf("galeri ke-%d ditolak dengan %d setelah menebus kode", i, k)
		}
	}
}

func TestKodeHanyaBisaDitebusSekali(t *testing.T) {
	db := newSubmitTestDB(t)
	siapkanBilling(t, db)
	h := &Handler{DB: db}

	db.Create(&models.RedeemCode{Code: "PF-ONCE-ONLY", Plan: models.PlanFreelance, Months: 3})

	if k, _ := tebusKode(t, h, uuid.NewString(), "PF-ONCE-ONLY"); k != 200 {
		t.Fatalf("penebusan pertama dibalas %d, mau 200", k)
	}
	k, body := tebusKode(t, h, uuid.NewString(), "PF-ONCE-ONLY")
	if k != 409 {
		t.Fatalf("penebusan kedua dibalas %d, mau 409", k)
	}
	if body["code"] != "code_used" {
		t.Errorf("code = %v, mau code_used", body["code"])
	}
}

func TestKodeTidakDikenalDitolak(t *testing.T) {
	db := newSubmitTestDB(t)
	siapkanBilling(t, db)
	h := &Handler{DB: db}

	if k, _ := tebusKode(t, h, uuid.NewString(), "PF-XXXX-XXXX"); k != 404 {
		t.Fatalf("kode karangan dibalas %d, mau 404", k)
	}
}

// Memperpanjang lebih awal tidak boleh membuang sisa masa yang sudah dibayar.
func TestPerpanjanganDihitungDariTanggalBerakhirYangAda(t *testing.T) {
	db := newSubmitTestDB(t)
	siapkanBilling(t, db)
	h := &Handler{DB: db}
	user := uuid.NewString()

	sisa := time.Now().UTC().AddDate(0, 2, 0)
	beriLangganan(t, db, user, models.PlanFreelance, sisa)
	db.Create(&models.RedeemCode{Code: "PF-EXTE-ND00", Plan: models.PlanFreelance, Months: 3})

	if k, _ := tebusKode(t, h, user, "PF-EXTE-ND00"); k != 200 {
		t.Fatalf("penebusan dibalas %d, mau 200", k)
	}

	var s models.Subscription
	db.Where("user_id = ?", user).First(&s)
	mau := sisa.AddDate(0, 3, 0)
	// Toleransi satu menit: tanggalnya dihitung dari nilai yang dibaca ulang
	// dari database, yang presisinya tidak persis sama dengan nilai di memori.
	if s.ExpiresAt == nil || s.ExpiresAt.Sub(mau).Abs() > time.Minute {
		t.Errorf("berakhir pada %v, mau sekitar %v — sisa masa lama terbuang", s.ExpiresAt, mau)
	}
}

func tebusKode(t *testing.T, h *Handler, userID, kode string) (int, map[string]any) {
	t.Helper()

	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest("POST", "/api/subscription/redeem",
		strings.NewReader(fmt.Sprintf(`{"code":%q}`, kode)))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set(middleware.ContextUserIDKey, userID)

	h.RedeemCode(c)

	var keluar map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &keluar)
	return rec.Code, keluar
}

// Rute admin tidak boleh terbuka hanya karena ADMIN_USER_IDS lupa diisi.
func TestRuteAdminTertutupSaatDaftarAdminKosong(t *testing.T) {
	t.Setenv("ADMIN_USER_IDS", "")

	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest("POST", "/api/admin/codes", strings.NewReader("{}"))
	c.Set(middleware.ContextUserIDKey, uuid.NewString())

	RequireAdmin()(c)

	if rec.Code != 404 {
		t.Errorf("dibalas %d dengan daftar admin kosong, mau 404", rec.Code)
	}
	if !c.IsAborted() {
		t.Error("permintaan tidak dihentikan")
	}
}

func TestRuteAdminMenolakYangBukanAdmin(t *testing.T) {
	admin := uuid.NewString()
	t.Setenv("ADMIN_USER_IDS", admin)

	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest("POST", "/api/admin/codes", strings.NewReader("{}"))
	c.Set(middleware.ContextUserIDKey, uuid.NewString()) // bukan admin

	RequireAdmin()(c)

	if rec.Code != 404 {
		t.Errorf("orang lain dibalas %d, mau 404", rec.Code)
	}
}
