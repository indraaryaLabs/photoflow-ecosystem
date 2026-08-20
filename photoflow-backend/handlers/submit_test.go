package handlers

import (
	"errors"
	"os"
	"sync"
	"testing"

	"github.com/google/uuid"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"photoflow-backend/models"
)

// Tes di berkas ini butuh PostgreSQL sungguhan. Yang diuji adalah perilaku
// transaksi dan penguncian baris di bawah akses bersamaan, dan itu tidak dapat
// ditiru tanpa database yang benar-benar menjalankannya.
//
// DSN dibaca dari TEST_DATABASE_URL, BUKAN dari DATABASE_URL: setiap tes di sini
// menghapus dan membangun ulang tabel projects dan photos. Tanpa variabel itu,
// berkas ini dilewati sehingga `go test ./...` tetap hijau di mesin tanpa
// Postgres.
//
// PENTING: karena membangun ulang skema, paket ini tidak boleh berjalan
// bersamaan dengan cmd/migrate maupun middleware — keduanya juga mengubah
// skema pada database yang sama. `go test` menjalankan paket secara paralel
// secara bawaan, jadi CI memakai `-p 1`. Menjalankannya dengan tangan tanpa
// bendera itu dapat merah secara acak, dan pesannya tidak akan menunjuk ke
// sebabnya: `relation "projects" does not exist` pada tes yang jelas baru
// membuatnya.
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
	if err := db.AutoMigrate(&models.Project{}, &models.Photo{}); err != nil {
		t.Fatalf("gagal menyiapkan skema tes: %v", err)
	}
	return db
}

// seedProject membuat satu project beserta foto awalnya, meniru galeri yang
// sudah ditarik dari Drive tapi belum disubmit klien.
func seedProject(t *testing.T, db *gorm.DB, photoCount int) models.Project {
	t.Helper()

	project := models.Project{
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
		photo := models.Photo{
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
	db.Model(&models.Photo{}).Where("project_id = ?", projectID).Count(&n)
	return n
}

// renamePhotos memberi nama berbeda pada tiap foto. seedProject memberi semua
// foto nama yang sama, dan sejak submit menandai berdasarkan nama berkas,
// nama yang seragam membuat hasilnya tidak bisa dibedakan.
func renamePhotos(t *testing.T, db *gorm.DB, projectID string, names ...string) {
	t.Helper()
	var ids []string
	if err := db.Model(&models.Photo{}).
		Where("project_id = ?", projectID).
		Order("id").Pluck("id", &ids).Error; err != nil {
		t.Fatalf("gagal membaca foto: %v", err)
	}
	if len(ids) != len(names) {
		t.Fatalf("ada %d foto, tapi %d nama diberikan", len(ids), len(names))
	}
	for i, id := range ids {
		if err := db.Model(&models.Photo{}).Where("id = ?", id).
			Update("file_name", names[i]).Error; err != nil {
			t.Fatalf("gagal mengganti nama foto: %v", err)
		}
	}
}

// selectedNames mengembalikan nama foto yang tertandai, terurut.
func selectedNames(t *testing.T, db *gorm.DB, projectID string) []string {
	t.Helper()
	var names []string
	if err := db.Model(&models.Photo{}).
		Where("project_id = ? AND is_selected", projectID).
		Order("file_name").Pluck("file_name", &names).Error; err != nil {
		t.Fatalf("gagal membaca pilihan: %v", err)
	}
	return names
}

func projectStatus(t *testing.T, db *gorm.DB, projectID string) string {
	t.Helper()
	var status string
	db.Model(&models.Project{}).Where("id = ?", projectID).Select("status").Scan(&status)
	return status
}

// Submit MENANDAI pilihan, tidak mengganti daftar fotonya.
//
// Tes ini dulu berbunyi sebaliknya: ia memastikan seluruh baris foto terhapus
// dan disisipkan ulang hanya yang dipilih. Perilaku itu membuang salinan daftar
// isi folder Drive, sehingga galeri yang jatuh ke salinan database menyusut
// jadi sebanyak yang dipilih saja — empat foto dipilih satu menyisakan satu.
func TestSubmitSelectionMarksSelectionAndLocks(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 3)

	// seedProject memberi setiap foto nama yang sama; supaya bisa dibedakan,
	// namanya disetel ulang di sini.
	renamePhotos(t, db, project.ID, "satu.jpg", "dua.jpg", "tiga.jpg")

	err := submitSelection(db, project.ID, []models.Photo{
		{ProjectID: project.ID, FileName: "dua.jpg", IsSelected: true},
	})
	if err != nil {
		t.Fatalf("submit pertama seharusnya berhasil: %v", err)
	}

	if got := countPhotos(t, db, project.ID); got != 3 {
		t.Fatalf("foto tersisa %d, seharusnya tetap 3", got)
	}
	if got := selectedNames(t, db, project.ID); len(got) != 1 || got[0] != "dua.jpg" {
		t.Fatalf("yang tertandai %v, seharusnya hanya [dua.jpg]", got)
	}
	if got := projectStatus(t, db, project.ID); got != models.StatusSubmitted {
		t.Fatalf("status %q, seharusnya %q", got, models.StatusSubmitted)
	}
}

// Nama yang belum punya baris tetap harus tercatat, kalau tidak aplikasi
// desktop tidak akan pernah tahu foto itu dipilih. Ini terjadi ketika isi
// folder berubah setelah project dibuat.
func TestSubmitSelectionInsertsUnsavedNames(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 2)
	renamePhotos(t, db, project.ID, "lama-satu.jpg", "lama-dua.jpg")

	err := submitSelection(db, project.ID, []models.Photo{
		{ProjectID: project.ID, FileName: "lama-dua.jpg", IsSelected: true},
		{ProjectID: project.ID, FileName: "baru.jpg", IsSelected: true},
	})
	if err != nil {
		t.Fatalf("submit seharusnya berhasil: %v", err)
	}

	if got := countPhotos(t, db, project.ID); got != 3 {
		t.Fatalf("foto tersimpan %d, seharusnya 3 (dua lama + satu baru)", got)
	}
	got := selectedNames(t, db, project.ID)
	if len(got) != 2 || got[0] != "baru.jpg" || got[1] != "lama-dua.jpg" {
		t.Fatalf("yang tertandai %v, seharusnya [baru.jpg lama-dua.jpg]", got)
	}
}

// Transaksi tetap diperlukan meski tidak ada lagi penghapusan: penguncian
// status dan penandaan pilihan harus jadi atau batal bersama-sama. Kalau
// penandaan gagal setelah status terlanjur "submitted", galerinya terkunci
// tanpa satu pun pilihan tercatat — dan klien tidak bisa mengulang.
//
// Kegagalan dipicu lewat project_id yang bukan UUID pada baris sisipan.
func TestSubmitSelectionRollsBackOnInsertFailure(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 3)
	renamePhotos(t, db, project.ID, "satu.jpg", "dua.jpg", "tiga.jpg")

	// Pemicu kegagalan yang lama -- project_id cacat pada baris kiriman -- tidak
	// berlaku lagi: markSelection membangun sendiri baris sisipannya dan
	// mengabaikan project_id apa pun yang datang dari klien. Itu justru lebih
	// benar, tapi berarti kegagalan harus dipicu dari sisi database.
	denyPhotoInsert(t, db)
	defer allowPhotoInsert(t, db)

	err := submitSelection(db, project.ID, []models.Photo{
		{ProjectID: project.ID, FileName: "satu.jpg", IsSelected: true},
		{ProjectID: project.ID, FileName: "belum-tersimpan.jpg", IsSelected: true},
	})
	if err == nil {
		t.Fatal("insert yang cacat seharusnya menghasilkan error")
	}
	if errors.Is(err, errGalleryLocked) {
		t.Fatalf("error seharusnya kegagalan insert, bukan galeri terkunci: %v", err)
	}

	if got := countPhotos(t, db, project.ID); got != 3 {
		t.Fatalf("foto tersisa %d, seharusnya 3", got)
	}
	if got := len(selectedNames(t, db, project.ID)); got != 0 {
		t.Fatalf("%d foto tertandai, seharusnya 0: penandaan tidak ter-rollback", got)
	}
	if got := projectStatus(t, db, project.ID); got != models.StatusPending {
		t.Fatalf("status %q, seharusnya tetap pending: penguncian tidak ter-rollback", got)
	}
}

// denyPhotoInsert memasang trigger yang menggagalkan setiap INSERT ke photos.
// Kegagalannya datang dari database, tempat kegagalan sungguhan akan muncul,
// bukan dari cabang khusus tes di dalam kode produksi.
func denyPhotoInsert(t *testing.T, db *gorm.DB) {
	t.Helper()
	stmts := []string{
		`CREATE OR REPLACE FUNCTION tolak_insert_foto() RETURNS trigger AS $$
		 BEGIN RAISE EXCEPTION 'insert foto ditolak oleh tes'; END; $$ LANGUAGE plpgsql`,
		`CREATE TRIGGER tolak_insert_foto BEFORE INSERT ON photos
		 FOR EACH ROW EXECUTE FUNCTION tolak_insert_foto()`,
	}
	for _, q := range stmts {
		if err := db.Exec(q).Error; err != nil {
			t.Fatalf("gagal memasang trigger penolak: %v", err)
		}
	}
}

func allowPhotoInsert(t *testing.T, db *gorm.DB) {
	t.Helper()
	db.Exec(`DROP TRIGGER IF EXISTS tolak_insert_foto ON photos`)
}

// TestSubmitSelectionRejectsSecondSubmit adalah kasus berurutan: submit kedua
// harus ditolak dan tidak boleh menyentuh foto hasil submit pertama.
func TestSubmitSelectionRejectsSecondSubmit(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 3)
	renamePhotos(t, db, project.ID, "pertama.jpg", "kedua.jpg", "ketiga.jpg")

	if err := submitSelection(db, project.ID, []models.Photo{
		{ProjectID: project.ID, FileName: "pertama.jpg", IsSelected: true},
	}); err != nil {
		t.Fatalf("submit pertama seharusnya berhasil: %v", err)
	}

	err := submitSelection(db, project.ID, []models.Photo{
		{ProjectID: project.ID, FileName: "kedua.jpg", IsSelected: true},
		{ProjectID: project.ID, FileName: "ketiga.jpg", IsSelected: true},
	})
	if !errors.Is(err, errGalleryLocked) {
		t.Fatalf("submit kedua seharusnya errGalleryLocked, dapat: %v", err)
	}

	if got := countPhotos(t, db, project.ID); got != 3 {
		t.Fatalf("foto tersisa %d, seharusnya tetap 3", got)
	}
	// Yang penting: pilihan submit pertama tidak boleh tergeser oleh yang kedua.
	if got := selectedNames(t, db, project.ID); len(got) != 1 || got[0] != "pertama.jpg" {
		t.Fatalf("yang tertandai %v, seharusnya tetap [pertama.jpg] dari submit pertama", got)
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

			err := submitSelection(db, project.ID, []models.Photo{
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

	// Yang diukur sekarang jumlah foto yang TERTANDAI, bukan jumlah baris.
	// Sejak submit menandai alih-alih mengganti, ketiga foto bawaan memang tetap
	// ada; kalau lebih dari satu submit berhasil menembus, yang bertambah adalah
	// tandanya.
	if got := selectedNames(t, db, project.ID); len(got) != 1 || got[0] != "pilihan.jpg" {
		t.Fatalf("yang tertandai %v, seharusnya hanya [pilihan.jpg]", got)
	}
}
