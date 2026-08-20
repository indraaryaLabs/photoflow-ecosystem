package handlers

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"photoflow-backend/middleware"
	"photoflow-backend/models"
	"photoflow-backend/storage"
)

// Galeri klien kini dilayani dari salinan database, bukan dengan memanggil
// Drive setiap kali dibuka. Yang harus dijaga: Drive tetap dibaca ketika memang
// belum ada salinan, TIDAK dibaca ketika salinannya masih segar, dan penyegaran
// tidak boleh menghapus pilihan yang sudah dikirim klien.

// storePenghitung mencatat berapa kali Drive benar-benar dibaca.
type storePenghitung struct {
	wasRead int
	files   []storage.PhotoRef
}

func (s *storePenghitung) ListPhotos(context.Context, string) ([]storage.PhotoRef, error) {
	s.wasRead++
	return s.files, nil
}
func (s *storePenghitung) ThumbnailURL(ref storage.PhotoRef) string { return ref.ThumbnailLink }

func handlerDenganStore(t *testing.T, db *gorm.DB, store storage.PhotoStore) *Handler {
	t.Helper()
	return &Handler{
		DB:      db,
		Limiter: middleware.NewLimiter(db, 0, 1_000_000),
		StoreForUser: func(context.Context, string) (storage.PhotoStore, error) {
			return store, nil
		},
	}
}

func requestPhotos(t *testing.T, h *Handler, magicLink, query string) map[string]any {
	t.Helper()
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest("GET", "/api/p/"+magicLink+"/photos"+query, nil)
	c.Params = gin.Params{{Key: "magic_link", Value: magicLink}}

	h.GalleryPhotos(c)

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("balasan tidak terbaca: %v", err)
	}
	return body
}

func drivePunya(name ...string) []storage.PhotoRef {
	out := make([]storage.PhotoRef, 0, len(name))
	for _, n := range name {
		out = append(out, storage.PhotoRef{ID: "drive-" + n, Name: n, ThumbnailLink: "https://x/" + n})
	}
	return out
}

func setSyncedAt(t *testing.T, db *gorm.DB, projectID string, kapan time.Time) {
	t.Helper()
	if err := db.Model(&models.Project{}).Where("id = ?", projectID).
		Update("photos_synced_at", kapan).Error; err != nil {
		t.Fatalf("gagal menyetel photos_synced_at: %v", err)
	}
}

func TestGalleryReadsDriveWhenNoCopyExists(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 0)
	store := &storePenghitung{files: drivePunya("a.jpg", "b.jpg")}
	h := handlerDenganStore(t, db, store)

	// photos_synced_at masih nil: tidak ada apa pun untuk disajikan.
	body := requestPhotos(t, h, project.MagicLinkToken, "")

	if store.wasRead != 1 {
		t.Fatalf("Drive dibaca %d kali, seharusnya 1", store.wasRead)
	}
	if body["source"] != "drive" {
		t.Fatalf("source = %v, seharusnya drive", body["source"])
	}
}

func TestGallerySkipsDriveWhenCopyIsFresh(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 0)
	store := &storePenghitung{files: drivePunya("a.jpg", "b.jpg")}
	h := handlerDenganStore(t, db, store)

	requestPhotos(t, h, project.MagicLinkToken, "") // mengisi salinan
	afterFill := store.wasRead

	// Inilah inti perubahannya: kunjungan berikutnya tidak boleh menyentuh
	// Google sama sekali. Sebelum ini setiap klien membayar pembacaan folder
	// berisi ribuan berkas, pada setiap kunjungan.
	for i := 0; i < 5; i++ {
		body := requestPhotos(t, h, project.MagicLinkToken, "")
		if body["source"] != "cache" {
			t.Fatalf("kunjungan ke-%d: source = %v, seharusnya cache", i, body["source"])
		}
		if n := len(body["files"].([]any)); n != 2 {
			t.Fatalf("kunjungan ke-%d: %d foto, seharusnya 2", i, n)
		}
	}

	if store.wasRead != afterFill {
		t.Fatalf("Drive dibaca %d kali tambahan, seharusnya nol", store.wasRead-afterFill)
	}
}

func TestStaleCopyIsMarkedStale(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 0)
	store := &storePenghitung{files: drivePunya("a.jpg")}
	h := handlerDenganStore(t, db, store)

	requestPhotos(t, h, project.MagicLinkToken, "")
	if body := requestPhotos(t, h, project.MagicLinkToken, ""); body["stale"] != false {
		t.Fatalf("salinan baru ditandai stale: %v", body["stale"])
	}

	setSyncedAt(t, db, project.ID, time.Now().Add(-maxCopyAge-time.Minute))
	if body := requestPhotos(t, h, project.MagicLinkToken, ""); body["stale"] != true {
		t.Fatalf("salinan lawas tidak ditandai stale")
	}
}

func TestRefreshIsRejectedWhenTooSoon(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 0)
	store := &storePenghitung{files: drivePunya("a.jpg")}
	h := handlerDenganStore(t, db, store)

	requestPhotos(t, h, project.MagicLinkToken, "")
	afterFill := store.wasRead

	// Rute ini publik: siapa pun yang memegang magic link dapat menambahkan
	// ?refresh=1. Tanpa jeda, menyegarkan halaman berulang kali akan memanggil
	// Drive berulang kali atas nama fotografernya.
	for i := 0; i < 5; i++ {
		requestPhotos(t, h, project.MagicLinkToken, "?refresh=1")
	}
	if store.wasRead != afterFill {
		t.Fatalf("Drive dibaca %d kali tambahan meski jeda belum lewat", store.wasRead-afterFill)
	}

	setSyncedAt(t, db, project.ID, time.Now().Add(-minRefreshInterval-time.Second))
	requestPhotos(t, h, project.MagicLinkToken, "?refresh=1")
	if store.wasRead != afterFill+1 {
		t.Fatalf("penyegaran sesudah jeda tidak membaca Drive")
	}
}

func TestRefreshPreservesClientPicks(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 0)
	store := &storePenghitung{files: drivePunya("a.jpg", "b.jpg", "c.jpg")}
	h := handlerDenganStore(t, db, store)

	requestPhotos(t, h, project.MagicLinkToken, "")

	// Klien memilih b.jpg.
	if err := db.Model(&models.Photo{}).
		Where("project_id = ? AND file_name = ?", project.ID, "b.jpg").
		Update("is_selected", true).Error; err != nil {
		t.Fatalf("gagal menandai pilihan: %v", err)
	}

	// Folder bertambah satu berkas, lalu salinannya disegarkan. Penyegaran
	// menghapus lalu menyisipkan ulang barisnya — kalau pilihannya tidak
	// dibawa serta, pekerjaan klien hilang tanpa ada yang menyadarinya.
	store.files = drivePunya("a.jpg", "b.jpg", "c.jpg", "d.jpg")
	setSyncedAt(t, db, project.ID, time.Now().Add(-minRefreshInterval-time.Second))
	requestPhotos(t, h, project.MagicLinkToken, "?refresh=1")

	var selected []string
	if err := db.Model(&models.Photo{}).
		Where("project_id = ? AND is_selected", project.ID).
		Pluck("file_name", &selected).Error; err != nil {
		t.Fatalf("gagal membaca pilihan: %v", err)
	}
	if len(selected) != 1 || selected[0] != "b.jpg" {
		t.Fatalf("pilihan sesudah penyegaran = %v, seharusnya [b.jpg]", selected)
	}

	var counts int64
	db.Model(&models.Photo{}).Where("project_id = ?", project.ID).Count(&counts)
	if counts != 4 {
		t.Fatalf("%d foto tersimpan, seharusnya 4", counts)
	}
}
