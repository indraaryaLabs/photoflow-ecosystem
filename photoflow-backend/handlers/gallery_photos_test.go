package handlers

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"photoflow-backend/middleware"
	"photoflow-backend/models"
	"photoflow-backend/storage"
)

// Tes di berkas ini adalah alasan PhotoStore dibuat: seluruh jalur handler
// dijalankan tanpa satu pun panggilan ke Google, sehingga perilaku saat Drive
// gagal bisa diuji dengan pasti alih-alih ditunggu terjadi di produksi.

// photosResponse adalah bentuk respons GET /api/p/:magic_link/photos.
type photosResponse struct {
	Files  []storage.PhotoRef `json:"files"`
	Source string             `json:"source"`
	Reason string             `json:"reason"`
}

// newGalleryHandler menyiapkan handler dengan database tes dan PhotoStore
// palsu, lalu mengembalikan project yang sudah punya foto tersimpan.
func newGalleryHandler(t *testing.T, store storage.PhotoStore, storeErr error) (*Handler, models.Project) {
	t.Helper()

	db := newSubmitTestDB(t)
	project := seedProject(t, db, 2)

	h := &Handler{
		DB:      db,
		Limiter: middleware.NewLimiter(db, 0, 1_000_000),
		StoreForUser: func(_ context.Context, _ string) (storage.PhotoStore, error) {
			if storeErr != nil {
				return nil, storeErr
			}
			return store, nil
		},
	}
	return h, project
}

// callGalleryPhotos menjalankan handler untuk satu magic link.
func callGalleryPhotos(t *testing.T, h *Handler, magicLink string) (int, photosResponse) {
	t.Helper()

	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest("GET", "/api/p/"+magicLink+"/photos", nil)
	c.Params = gin.Params{{Key: "magic_link", Value: magicLink}}

	h.GalleryPhotos(c)

	var body photosResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("respons bukan JSON yang diharapkan: %v (%s)", err, rec.Body.String())
	}
	return rec.Code, body
}

func TestGalleryPhotosReadsFromDrive(t *testing.T) {
	h, project := newGalleryHandler(t, nil, nil)
	h.StoreForUser = func(_ context.Context, _ string) (storage.PhotoStore, error) {
		return storage.NewFakeStore(project.DriveFolderID, []storage.PhotoRef{
			{ID: "drive-1", Name: "satu.jpg", ThumbnailLink: "https://contoh/1"},
			{ID: "drive-2", Name: "dua.jpg", ThumbnailLink: "https://contoh/2"},
		}), nil
	}

	code, body := callGalleryPhotos(t, h, project.MagicLinkToken)

	if code != 200 {
		t.Fatalf("status %d, seharusnya 200", code)
	}
	if body.Source != "drive" {
		t.Fatalf("source %q, seharusnya drive", body.Source)
	}
	if len(body.Files) != 2 || body.Files[0].Name != "satu.jpg" {
		t.Fatalf("isi files tidak sesuai: %+v", body.Files)
	}
}

// TestGalleryPhotosFallsBackWhenDriveNotConnected menjaga janji yang paling
// penting dari perubahan ini: memindahkan pembacaan Drive ke kredensial
// per-user tidak boleh mematikan galeri milik fotografer yang belum pernah
// menghubungkan Drive-nya. Fotonya ada di database, dan itu yang dikirim.
func TestGalleryPhotosFallsBackWhenDriveNotConnected(t *testing.T) {
	h, project := newGalleryHandler(t, nil, storage.ErrDriveNotConnected)

	code, body := callGalleryPhotos(t, h, project.MagicLinkToken)

	if code != 200 {
		t.Fatalf("status %d, seharusnya tetap 200: galeri tidak boleh mati", code)
	}
	if body.Source != "stored" {
		t.Fatalf("source %q, seharusnya stored", body.Source)
	}
	if body.Reason != "drive_not_connected" {
		t.Fatalf("reason %q, seharusnya drive_not_connected", body.Reason)
	}
	if len(body.Files) != 2 {
		t.Fatalf("%d foto tersimpan terkirim, seharusnya 2", len(body.Files))
	}
}

// TestGalleryPhotosFallbackUsesGalleryFieldNames menjaga penyeragaman bentuk.
// Baris database memakai file_name dan thumbnail_url, sedangkan galeri membaca
// name dan thumbnailLink; jalur cadangan yang mengirim bentuk mentah akan
// menghasilkan gambar kosong dan nama berkas yang hilang saat submit.
func TestGalleryPhotosFallbackUsesGalleryFieldNames(t *testing.T) {
	h, project := newGalleryHandler(t, nil, storage.ErrDriveReconnectRequired)

	_, body := callGalleryPhotos(t, h, project.MagicLinkToken)

	if body.Reason != "drive_reconnect_required" {
		t.Fatalf("reason %q, seharusnya drive_reconnect_required", body.Reason)
	}
	for _, file := range body.Files {
		if file.Name == "" || file.ThumbnailLink == "" {
			t.Fatalf("foto tersimpan tidak dipetakan ke bentuk galeri: %+v", file)
		}
	}
}

// TestGalleryPhotosUsesStoredAfterSubmit memastikan galeri yang sudah dikunci
// menampilkan pilihan kliennya, bukan seluruh isi folder Drive seolah belum
// ada yang dipilih.
func TestGalleryPhotosUsesStoredAfterSubmit(t *testing.T) {
	h, project := newGalleryHandler(t, nil, nil)
	driveCalled := false
	h.StoreForUser = func(_ context.Context, _ string) (storage.PhotoStore, error) {
		driveCalled = true
		return storage.NewFakeStore(project.DriveFolderID, nil), nil
	}

	if err := submitSelection(h.DB, project.ID, []models.Photo{
		{ProjectID: project.ID, FileName: "pilihan.jpg", ThumbnailURL: "https://contoh/p", IsSelected: true},
	}); err != nil {
		t.Fatalf("submit gagal disiapkan: %v", err)
	}

	code, body := callGalleryPhotos(t, h, project.MagicLinkToken)

	if code != 200 {
		t.Fatalf("status %d, seharusnya 200", code)
	}
	if driveCalled {
		t.Fatal("Drive dibaca untuk galeri yang sudah disubmit")
	}
	if body.Source != "stored" || body.Reason != "submitted" {
		t.Fatalf("source=%q reason=%q, seharusnya stored/submitted", body.Source, body.Reason)
	}
	if len(body.Files) != 1 || body.Files[0].Name != "pilihan.jpg" {
		t.Fatalf("isi files tidak sesuai: %+v", body.Files)
	}
}

func TestGalleryPhotosUnknownMagicLink(t *testing.T) {
	h, _ := newGalleryHandler(t, nil, nil)

	code, _ := callGalleryPhotos(t, h, "token-yang-tidak-ada")

	if code != 404 {
		t.Fatalf("status %d, seharusnya 404", code)
	}
}
