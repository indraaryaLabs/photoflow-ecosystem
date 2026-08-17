package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"photoflow-backend/middleware"
	"photoflow-backend/models"
)

// Nama studio adalah satu-satunya bagian aplikasi ini yang dilihat klien
// membawa nama fotografernya. Dua hal yang harus benar: namanya tersimpan
// meski baris profilnya belum pernah ada, dan galeri tetap hidup ketika
// namanya tidak ada.

// siapkanProfiles membuat tiruan tabel profiles milik Supabase.
//
// Tabel ini TIDAK dibuat newSubmitTestDB: barisnya dibuat trigger
// handle_new_user() saat pendaftaran, jadi backend tidak pernah memilikinya.
// Tanpa tiruannya setiap tes di sini gagal pada persiapan, bukan pada perilaku
// yang hendak diuji.
func siapkanProfiles(t *testing.T, db *gorm.DB) {
	t.Helper()
	db.Exec("DROP TABLE IF EXISTS profiles")
	if err := db.Exec(`CREATE TABLE profiles (
		id uuid PRIMARY KEY,
		gdrive_refresh_token text,
		studio_name text
	)`).Error; err != nil {
		t.Fatalf("gagal menyiapkan profiles: %v", err)
	}
}

func callProfile(t *testing.T, h *Handler, method, userID, body string) (int, map[string]any) {
	t.Helper()

	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(method, "/api/profile", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set(middleware.ContextUserIDKey, userID)

	if method == "GET" {
		h.GetProfile(c)
	} else {
		h.UpdateProfile(c)
	}

	var keluar map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &keluar)
	return rec.Code, keluar
}

func TestNamaStudioTersimpanWalauProfilBelumAda(t *testing.T) {
	db := newSubmitTestDB(t)
	siapkanProfiles(t, db)
	h := &Handler{DB: db}
	user := uuid.NewString()

	// Sengaja TIDAK membuat baris profilnya lebih dulu. Akun yang mendaftar
	// sebelum trigger Supabase ada tidak punya barisnya, dan UPDATE terhadap
	// baris yang tidak ada berhasil tanpa mengubah apa pun: permintaannya
	// dijawab 200 dan namanya tetap hilang tanpa satu pun tanda.
	code, body := callProfile(t, h, "PUT", user, `{"studio_name":"Cahaya Studio"}`)
	if code != 200 {
		t.Fatalf("kode %d, seharusnya 200", code)
	}
	if body["studio_name"] != "Cahaya Studio" {
		t.Fatalf("balasan = %v", body)
	}

	_, dibaca := callProfile(t, h, "GET", user, "")
	if dibaca["studio_name"] != "Cahaya Studio" {
		t.Fatalf("dibaca kembali = %v, seharusnya tersimpan", dibaca)
	}
}

func TestNamaStudioDapatDiubahDanDikosongkan(t *testing.T) {
	db := newSubmitTestDB(t)
	siapkanProfiles(t, db)
	h := &Handler{DB: db}
	user := uuid.NewString()

	callProfile(t, h, "PUT", user, `{"studio_name":"Nama Lama"}`)
	callProfile(t, h, "PUT", user, `{"studio_name":"Nama Baru"}`)

	_, body := callProfile(t, h, "GET", user, "")
	if body["studio_name"] != "Nama Baru" {
		t.Fatalf("= %v, seharusnya tergantikan", body)
	}

	// Mengosongkan harus mungkin: fitur ini pilihan, dan yang sudah terlanjur
	// mengisinya harus punya jalan kembali ke bawaan.
	callProfile(t, h, "PUT", user, `{"studio_name":"   "}`)
	_, kosong := callProfile(t, h, "GET", user, "")
	if kosong["studio_name"] != "" {
		t.Fatalf("= %v, seharusnya kosong", kosong)
	}
}

func TestNamaStudioTerlaluPanjangDitolak(t *testing.T) {
	db := newSubmitTestDB(t)
	siapkanProfiles(t, db)
	h := &Handler{DB: db}
	user := uuid.NewString()

	code, _ := callProfile(t, h, "PUT", user,
		`{"studio_name":"`+strings.Repeat("a", maksimalNamaStudio+1)+`"}`)
	if code != 400 {
		t.Fatalf("kode %d, seharusnya 400", code)
	}
}

func TestNamaStudioDihitungPerHurufBukanPerByte(t *testing.T) {
	db := newSubmitTestDB(t)
	siapkanProfiles(t, db)
	h := &Handler{DB: db}
	user := uuid.NewString()

	// Tiga byte per huruf. Dibatasi per byte, nama sepanjang 20 huruf ini
	// ditolak padahal di layar jelas-jelas pendek.
	nama := strings.Repeat("写", 20)
	if code, _ := callProfile(t, h, "PUT", user, `{"studio_name":"`+nama+`"}`); code != 200 {
		t.Fatalf("kode %d, seharusnya 200 — %d huruf, %d byte",
			code, len([]rune(nama)), len(nama))
	}
}

func TestProfilKosongDijawabBukanError(t *testing.T) {
	db := newSubmitTestDB(t)
	siapkanProfiles(t, db)
	h := &Handler{DB: db}

	// User yang belum pernah menyentuh halaman profil. Dashboard membaca
	// endpoint ini saat dimuat; menjawab 404 di sini akan menampilkan galat
	// pada orang yang tidak melakukan apa-apa salah.
	code, body := callProfile(t, h, "GET", uuid.NewString(), "")
	if code != 200 {
		t.Fatalf("kode %d, seharusnya 200", code)
	}
	if body["studio_name"] != "" {
		t.Fatalf("= %v, seharusnya kosong", body)
	}
}

func TestGaleriMembawaNamaStudioPemiliknya(t *testing.T) {
	db := newSubmitTestDB(t)
	siapkanProfiles(t, db)
	project := seedProject(t, db, 2)
	h := handlerGaleri(t, db)

	callProfile(t, h, "PUT", project.UserID, `{"studio_name":"Cahaya Studio"}`)

	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest("GET", "/api/p/"+project.MagicLinkToken, nil)
	c.Params = gin.Params{{Key: "magic_link", Value: project.MagicLinkToken}}
	h.GetGallery(c)

	var keluar struct {
		Project models.GalleryProject `json:"project"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &keluar); err != nil {
		t.Fatalf("balasan tidak terbaca: %v", err)
	}
	if keluar.Project.StudioName != "Cahaya Studio" {
		t.Fatalf("studio_name = %q", keluar.Project.StudioName)
	}
}

func TestGaleriTetapHidupTanpaTabelProfiles(t *testing.T) {
	db := newSubmitTestDB(t)
	// Tabelnya sengaja tidak dibuat sama sekali — keadaan terburuk yang bisa
	// dihadapi pembacaan nama studio. Galeri klien tidak boleh mati karena
	// sebuah nama tidak terbaca; yang hilang cukup namanya.
	db.Exec("DROP TABLE IF EXISTS profiles")

	project := seedProject(t, db, 2)
	h := handlerGaleri(t, db)

	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest("GET", "/api/p/"+project.MagicLinkToken, nil)
	c.Params = gin.Params{{Key: "magic_link", Value: project.MagicLinkToken}}
	h.GetGallery(c)

	if rec.Code != 200 {
		t.Fatalf("kode %d, seharusnya tetap 200", rec.Code)
	}
}
