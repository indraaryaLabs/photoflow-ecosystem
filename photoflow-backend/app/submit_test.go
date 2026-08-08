package app

import (
	"errors"
	"os"
	"sync"
	"testing"

	"github.com/google/uuid"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Tes di berkas ini butuh PostgreSQL sungguhan. Yang diuji adalah perilaku
// transaksi dan penguncian baris di bawah akses bersamaan, dan itu tidak dapat
// ditiru tanpa database yang benar-benar menjalankannya.
//
// DSN dibaca dari TEST_DATABASE_URL, BUKAN dari DATABASE_URL: setiap tes di sini
// menghapus dan membangun ulang tabel projects dan photos. Tanpa variabel itu,
// berkas ini dilewati sehingga `go test ./...` tetap hijau di mesin tanpa
// Postgres.
func newSubmitTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL tidak disetel; melewati tes yang butuh Postgres")
	}

	db, err := gorm.Open(postgres.New(postgres.Config{
		DSN:                  dsn,
		PreferSimpleProtocol: true,
	}), &gorm.Config{})
	if err != nil {
		t.Fatalf("gagal terhubung ke database tes: %v", err)
	}

	db.Exec("DROP TABLE IF EXISTS photos")
	db.Exec("DROP TABLE IF EXISTS projects")
	if err := db.AutoMigrate(&Project{}, &Photo{}); err != nil {
		t.Fatalf("gagal menyiapkan skema tes: %v", err)
	}
	return db
}

// seedProject membuat satu project beserta foto awalnya, meniru galeri yang
// sudah ditarik dari Drive tapi belum disubmit klien.
func seedProject(t *testing.T, db *gorm.DB, photoCount int) Project {
	t.Helper()

	project := Project{
		// user_id bertipe uuid di database, jadi harus berupa UUID yang sah.
		// Handler produksi mengisinya dari klaim `sub` token.
		UserID:         uuid.NewString(),
		ProjectName:    "Pemotretan",
		ClientName:     "Klien",
		DriveFolderURL: "https://drive.google.com/drive/folders/abc",
		DriveFolderID:  "abc",
		MagicLinkToken: "token-" + t.Name(),
		Status:         "pending",
	}
	if err := db.Create(&project).Error; err != nil {
		t.Fatalf("gagal menyiapkan project: %v", err)
	}

	for i := 0; i < photoCount; i++ {
		photo := Photo{
			ProjectID:    project.ID,
			FileName:     "asli.jpg",
			ThumbnailURL: "https://contoh/thumb.jpg",
		}
		if err := db.Create(&photo).Error; err != nil {
			t.Fatalf("gagal menyiapkan foto: %v", err)
		}
	}
	return project
}

func countPhotos(t *testing.T, db *gorm.DB, projectID string) int64 {
	t.Helper()
	var n int64
	db.Model(&Photo{}).Where("project_id = ?", projectID).Count(&n)
	return n
}

func projectStatus(t *testing.T, db *gorm.DB, projectID string) string {
	t.Helper()
	var status string
	db.Model(&Project{}).Where("id = ?", projectID).Select("status").Scan(&status)
	return status
}

func TestSubmitSelectionReplacesPhotosAndLocks(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 3)

	err := submitSelection(db, project.ID, []Photo{
		{ProjectID: project.ID, FileName: "pilihan.jpg", IsSelected: true},
	})
	if err != nil {
		t.Fatalf("submit pertama seharusnya berhasil: %v", err)
	}

	if got := countPhotos(t, db, project.ID); got != 1 {
		t.Fatalf("foto tersisa %d, seharusnya 1", got)
	}
	if got := projectStatus(t, db, project.ID); got != statusSubmitted {
		t.Fatalf("status %q, seharusnya %q", got, statusSubmitted)
	}
}

// TestSubmitSelectionRollsBackOnInsertFailure membuktikan alasan transaksi ada
// di sini: tanpa transaksi, penghapusan foto lama sudah permanen ketika insert
// penggantinya gagal, dan pekerjaan klien hilang tanpa bisa dipulihkan.
//
// Kegagalan dipicu dengan project_id yang bukan UUID, sehingga insert ditolak
// Postgres di tengah jalan setelah penghapusan berjalan.
func TestSubmitSelectionRollsBackOnInsertFailure(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 3)

	err := submitSelection(db, project.ID, []Photo{
		{ProjectID: project.ID, FileName: "sah.jpg", IsSelected: true},
		{ProjectID: "bukan-uuid", FileName: "rusak.jpg", IsSelected: true},
	})
	if err == nil {
		t.Fatal("insert yang cacat seharusnya menghasilkan error")
	}
	if errors.Is(err, errGalleryLocked) {
		t.Fatalf("error seharusnya kegagalan insert, bukan galeri terkunci: %v", err)
	}

	if got := countPhotos(t, db, project.ID); got != 3 {
		t.Fatalf("foto tersisa %d, seharusnya 3: penghapusan tidak ter-rollback", got)
	}
	if got := projectStatus(t, db, project.ID); got != "pending" {
		t.Fatalf("status %q, seharusnya tetap pending: penguncian tidak ter-rollback", got)
	}
}

// TestSubmitSelectionRejectsSecondSubmit adalah kasus berurutan: submit kedua
// harus ditolak dan tidak boleh menyentuh foto hasil submit pertama.
func TestSubmitSelectionRejectsSecondSubmit(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 3)

	if err := submitSelection(db, project.ID, []Photo{
		{ProjectID: project.ID, FileName: "pertama.jpg", IsSelected: true},
	}); err != nil {
		t.Fatalf("submit pertama seharusnya berhasil: %v", err)
	}

	err := submitSelection(db, project.ID, []Photo{
		{ProjectID: project.ID, FileName: "kedua.jpg", IsSelected: true},
		{ProjectID: project.ID, FileName: "ketiga.jpg", IsSelected: true},
	})
	if !errors.Is(err, errGalleryLocked) {
		t.Fatalf("submit kedua seharusnya errGalleryLocked, dapat: %v", err)
	}

	if got := countPhotos(t, db, project.ID); got != 1 {
		t.Fatalf("foto tersisa %d, seharusnya tetap 1 dari submit pertama", got)
	}
}

// TestSubmitSelectionConcurrentSubmitsOnlyOneWins adalah tes yang menjaga
// perbaikan race condition-nya.
//
// Dua submit ditembakkan bersamaan pada galeri yang sama. Dengan pemeriksaan
// status terpisah dari perubahannya, keduanya membaca status "pending", keduanya
// menyimpulkan boleh lanjut, dan keduanya menghapus lalu menulis ulang daftar
// foto — yang kedua menimpa hasil yang pertama. Dengan syarat status berada di
// dalam UPDATE, hanya satu yang boleh menang.
func TestSubmitSelectionConcurrentSubmitsOnlyOneWins(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 3)

	const attempts = 8
	var (
		start   sync.WaitGroup
		done    sync.WaitGroup
		mu      sync.Mutex
		results []error
	)
	start.Add(1)

	for i := 0; i < attempts; i++ {
		done.Add(1)
		go func(n int) {
			defer done.Done()
			start.Wait() // tembakkan sedekat mungkin

			err := submitSelection(db, project.ID, []Photo{
				{ProjectID: project.ID, FileName: "pilihan.jpg", IsSelected: true},
			})
			mu.Lock()
			results = append(results, err)
			mu.Unlock()
		}(i)
	}

	start.Done()
	done.Wait()

	succeeded, locked := 0, 0
	for _, err := range results {
		switch {
		case err == nil:
			succeeded++
		case errors.Is(err, errGalleryLocked):
			locked++
		default:
			t.Fatalf("error tak terduga: %v", err)
		}
	}

	if succeeded != 1 || locked != attempts-1 {
		t.Fatalf("berhasil=%d terkunci=%d, seharusnya berhasil=1 terkunci=%d",
			succeeded, locked, attempts-1)
	}

	if got := countPhotos(t, db, project.ID); got != 1 {
		t.Fatalf("foto tersisa %d, seharusnya 1: submit kedua ikut menulis", got)
	}
}
