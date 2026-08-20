package handlers

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"photoflow-backend/middleware"
	"photoflow-backend/models"
)

// ReopenSelection adalah satu-satunya jalan pulang dari status "submitted".
// Karena ia membatalkan penguncian yang sengaja dipasang SubmitSelection, dua
// hal harus dipastikan: hanya pemilik yang boleh memanggilnya, dan pilihan foto
// benar-benar ikut dikosongkan. Kalau salah satunya meleset, fitur ini justru
// jadi lubang.

// callReopen menjalankan handler seolah-olah dipanggil oleh userID.
func callReopen(t *testing.T, h *Handler, projectID, userID string) int {
	t.Helper()

	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest("POST", "/api/projects/"+projectID+"/reopen", nil)
	c.Params = gin.Params{{Key: "id", Value: projectID}}
	// Di produksi nilai ini dipasang middleware auth dari klaim `sub` pada JWT,
	// bukan dari apa pun yang dikirim browser.
	c.Set(middleware.ContextUserIDKey, userID)

	h.ReopenSelection(c)
	return rec.Code
}

// markSelected meniru keadaan setelah klien mengirim pilihannya.
func markSelected(t *testing.T, h *Handler, projectID string) {
	t.Helper()
	if err := h.DB.Model(&models.Photo{}).
		Where("project_id = ?", projectID).
		Update("is_selected", true).Error; err != nil {
		t.Fatalf("gagal menandai foto terpilih: %v", err)
	}
	if err := h.DB.Model(&models.Project{}).
		Where("id = ?", projectID).
		Update("status", models.StatusSubmitted).Error; err != nil {
		t.Fatalf("gagal mengunci project: %v", err)
	}
}

func selectedCount(t *testing.T, h *Handler, projectID string) int64 {
	t.Helper()
	var n int64
	h.DB.Model(&models.Photo{}).
		Where("project_id = ? AND is_selected", projectID).Count(&n)
	return n
}

func TestReopenSelectionUnlocksAndClearsPicks(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 3)
	h := &Handler{DB: db}

	markSelected(t, h, project.ID)
	if got := selectedCount(t, h, project.ID); got != 3 {
		t.Fatalf("persiapan salah: terpilih %d, seharusnya 3", got)
	}

	if code := callReopen(t, h, project.ID, project.UserID); code != 200 {
		t.Fatalf("kode %d, seharusnya 200", code)
	}

	if got := projectStatus(t, db, project.ID); got != models.StatusPending {
		t.Fatalf("status %q, seharusnya %q", got, models.StatusPending)
	}

	// Bagian yang paling mudah terlewat. Membuka status tanpa mengosongkan
	// pilihan menaruh klien kembali di galeri dengan semua foto tercentang.
	if got := selectedCount(t, h, project.ID); got != 0 {
		t.Fatalf("masih ada %d foto tercentang, seharusnya 0", got)
	}

	// Fotonya sendiri tidak boleh ikut terhapus — yang dibatalkan adalah
	// pilihannya, bukan galerinya.
	if got := countPhotos(t, db, project.ID); got != 3 {
		t.Fatalf("foto tersisa %d, seharusnya tetap 3", got)
	}
}

func TestReopenSelectionMenolakBukanPemilik(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 2)
	h := &Handler{DB: db}

	markSelected(t, h, project.ID)

	// UUID sah, tapi milik orang lain. Balasannya 404, bukan 403: membedakan
	// "tidak ada" dari "bukan milikmu" memberi tahu penebak bahwa project
	// dengan id itu memang ada.
	if code := callReopen(t, h, project.ID, uuid.NewString()); code != 404 {
		t.Fatalf("kode %d, seharusnya 404", code)
	}

	if got := projectStatus(t, db, project.ID); got != models.StatusSubmitted {
		t.Fatalf("status %q, seharusnya tetap %q", got, models.StatusSubmitted)
	}
	if got := selectedCount(t, h, project.ID); got != 2 {
		t.Fatalf("terpilih %d, seharusnya tetap 2", got)
	}
}

func TestReopenSelectionPadaProjectYangMasihTerbuka(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 2)
	h := &Handler{DB: db}

	// Hasil yang diminta sudah tercapai, jadi ini bukan kegagalan.
	if code := callReopen(t, h, project.ID, project.UserID); code != 200 {
		t.Fatalf("kode %d, seharusnya 200", code)
	}
	if got := projectStatus(t, db, project.ID); got != models.StatusPending {
		t.Fatalf("status %q, seharusnya %q", got, models.StatusPending)
	}
}
