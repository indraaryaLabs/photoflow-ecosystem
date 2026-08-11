package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"photoflow-backend/middleware"
	"photoflow-backend/models"
)

// ListSelections memberi fotografer daftar nama berkas yang dipilih kliennya,
// untuk ditempel ke penyaring Lightroom. Karena isinya data milik orang, hal
// pertama yang harus dipastikan tetap kepemilikan — dan karena yang membacanya
// adalah mesin, bentuk balasannya harus tetap sama meski hasilnya kosong.

type balasanSeleksi struct {
	ProjectName string   `json:"project_name"`
	ClientName  string   `json:"client_name"`
	Status      string   `json:"status"`
	Count       int      `json:"count"`
	FileNames   []string `json:"file_names"`
}

func callListSelections(t *testing.T, h *Handler, projectID, userID string) (int, balasanSeleksi) {
	t.Helper()

	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest("GET", "/api/projects/"+projectID+"/selections", nil)
	c.Params = gin.Params{{Key: "id", Value: projectID}}
	c.Set(middleware.ContextUserIDKey, userID)

	h.ListSelections(c)

	var body balasanSeleksi
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	return rec.Code, body
}

// namaiFoto memberi tiap foto project nama yang berbeda, lalu menandai
// sebagian di antaranya terpilih.
func namaiFoto(t *testing.T, h *Handler, projectID string, nama []string, terpilih map[string]bool) {
	t.Helper()

	if err := h.DB.Where("project_id = ?", projectID).Delete(&models.Photo{}).Error; err != nil {
		t.Fatalf("gagal mengosongkan foto: %v", err)
	}
	for _, n := range nama {
		photo := models.Photo{
			ProjectID:    projectID,
			FileName:     n,
			ThumbnailURL: "https://contoh/thumb.jpg",
			IsSelected:   terpilih[n],
		}
		if err := h.DB.Create(&photo).Error; err != nil {
			t.Fatalf("gagal menyiapkan foto %q: %v", n, err)
		}
	}
}

func TestListSelectionsHanyaMengembalikanYangTerpilih(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 0)
	h := &Handler{DB: db}

	namaiFoto(t, h, project.ID,
		[]string{"IMG_0003.jpg", "IMG_0001.jpg", "IMG_0002.jpg"},
		map[string]bool{"IMG_0001.jpg": true, "IMG_0003.jpg": true})

	code, body := callListSelections(t, h, project.ID, project.UserID)
	if code != 200 {
		t.Fatalf("kode %d, seharusnya 200", code)
	}

	// Urutannya menurut nama berkas, bukan urutan penyisipan: yang membaca
	// daftar ini membandingkannya dengan isi folder, dan folder disusun
	// menurut nama.
	want := []string{"IMG_0001.jpg", "IMG_0003.jpg"}
	if len(body.FileNames) != len(want) {
		t.Fatalf("dapat %v, seharusnya %v", body.FileNames, want)
	}
	for i := range want {
		if body.FileNames[i] != want[i] {
			t.Fatalf("dapat %v, seharusnya %v", body.FileNames, want)
		}
	}
	if body.Count != 2 {
		t.Fatalf("count %d, seharusnya 2", body.Count)
	}
}

func TestListSelectionsKosongTetapArrayBukanNull(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 2)
	h := &Handler{DB: db}

	rec := httptest.NewRecorder()
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest("GET", "/api/projects/"+project.ID+"/selections", nil)
	c.Params = gin.Params{{Key: "id", Value: project.ID}}
	c.Set(middleware.ContextUserIDKey, project.UserID)
	h.ListSelections(c)

	// Pluck mengembalikan nil untuk hasil kosong, dan nil ter-serialisasi jadi
	// `null`. Frontend memanggil .length atasnya, jadi bentuknya harus tetap
	// array — diperiksa pada JSON mentahnya, karena Unmarshal ke []string
	// menyamarkan null jadi slice kosong.
	var mentah map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &mentah); err != nil {
		t.Fatalf("balasan bukan JSON: %v", err)
	}
	if string(mentah["file_names"]) != "[]" {
		t.Fatalf("file_names = %s, seharusnya []", mentah["file_names"])
	}
}

func TestListSelectionsMenolakBukanPemilik(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 0)
	h := &Handler{DB: db}

	namaiFoto(t, h, project.ID,
		[]string{"rahasia.jpg"},
		map[string]bool{"rahasia.jpg": true})

	// 404, bukan 403 — sama seperti endpoint lain. Membedakan "tidak ada" dari
	// "bukan milikmu" memberi tahu penebak bahwa project itu memang ada.
	code, body := callListSelections(t, h, project.ID, uuid.NewString())
	if code != 404 {
		t.Fatalf("kode %d, seharusnya 404", code)
	}
	if len(body.FileNames) != 0 {
		t.Fatalf("nama berkas bocor ke bukan pemilik: %v", body.FileNames)
	}
}
