package handlers

import (
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"photoflow-backend/middleware"
	"photoflow-backend/models"
)

// first_viewed_at menjawab satu pertanyaan yang menentukan tindakan
// fotografer: tautannya sampai atau tidak. Nilai yang salah di sini lebih
// buruk daripada tidak ada nilainya sama sekali — fotografer akan mengirim
// ulang tautan kepada orang yang sudah memegangnya, atau menunggu orang yang
// tidak pernah menerimanya.

func openGallery(t *testing.T, h *Handler, magicLink, query string) int {
	t.Helper()

	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest("GET", "/api/p/"+magicLink+query, nil)
	c.Params = gin.Params{{Key: "magic_link", Value: magicLink}}

	h.GetGallery(c)
	return rec.Code
}

func firstViewedAt(t *testing.T, db *gorm.DB, projectID string) *time.Time {
	t.Helper()
	var p models.Project
	if err := db.Where("id = ?", projectID).First(&p).Error; err != nil {
		t.Fatalf("gagal membaca project: %v", err)
	}
	return p.FirstViewedAt
}

// galleryHandler membangun Handler beserta limiter-nya.
//
// GetGallery menyentuh limiter hanya pada jalur "tidak ditemukan", dan tes di
// berkas ini tidak pernah melewatinya — tapi Handler tanpa limiter akan panic
// kalau suatu saat ada yang melewatinya, dan panic itu akan terbaca sebagai
// kerusakan di tempat yang salah.
func galleryHandler(t *testing.T, db *gorm.DB) *Handler {
	t.Helper()
	return &Handler{DB: db, Limiter: middleware.NewLimiter(db, 0, 1_000_000)}
}

func TestNewGalleryHasNeverBeenOpened(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 2)

	// Tidak lewat handler sama sekali: keadaan awalnya harus kosong, kalau
	// tidak seluruh tes di bawah ini lulus tanpa membuktikan apa pun.
	if firstViewedAt(t, db, project.ID) != nil {
		t.Fatal("project baru sudah bertanda pernah dibuka")
	}
}

func TestOpeningGalleryStampsTheTime(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 2)
	h := galleryHandler(t, db)

	if code := openGallery(t, h, project.MagicLinkToken, ""); code != 200 {
		t.Fatalf("kode %d, seharusnya 200", code)
	}

	if firstViewedAt(t, db, project.ID) == nil {
		t.Fatal("galeri dibuka tapi waktunya tidak tercatat")
	}
}

func TestSecondVisitDoesNotMoveTheFirstTimestamp(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 2)
	h := galleryHandler(t, db)

	openGallery(t, h, project.MagicLinkToken, "")
	pertama := firstViewedAt(t, db, project.ID)
	if pertama == nil {
		t.Fatal("persiapan gagal: kunjungan pertama tidak tercatat")
	}

	// Yang direkam waktu PERTAMA. Kalau kunjungan berikutnya menimpanya,
	// "dikirim tiga hari lalu, dibuka tiga hari lalu, masih sepi" berubah jadi
	// "baru dibuka barusan" setiap kali klien menyegarkan halaman — dan
	// fotografer berhenti menagih orang yang sebenarnya sudah lama diam.
	time.Sleep(10 * time.Millisecond)
	openGallery(t, h, project.MagicLinkToken, "")

	kedua := firstViewedAt(t, db, project.ID)
	if !kedua.Equal(*pertama) {
		t.Fatalf("waktunya bergeser: %v menjadi %v", pertama, kedua)
	}
}

func TestPhotographerPreviewsAreNotCounted(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 2)
	h := galleryHandler(t, db)

	// Tombol "Open client gallery" di dashboard membuka tautan yang sama
	// persis dengan yang dipegang klien. Tanpa penanda ini, tandanya menyala
	// pada detik project dibuat, dan sinyal yang selalu menyala tidak lebih
	// berguna daripada sinyal yang tidak pernah menyala.
	if code := openGallery(t, h, project.MagicLinkToken, "?preview=1"); code != 200 {
		t.Fatalf("kode %d, seharusnya 200", code)
	}

	if at := firstViewedAt(t, db, project.ID); at != nil {
		t.Fatalf("pratinjau fotografer ikut tercatat: %v", at)
	}
}

func TestPreviewsDoNotClearExistingMarks(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 2)
	h := galleryHandler(t, db)

	openGallery(t, h, project.MagicLinkToken, "")
	before := firstViewedAt(t, db, project.ID)
	if before == nil {
		t.Fatal("persiapan gagal: kunjungan klien tidak tercatat")
	}

	openGallery(t, h, project.MagicLinkToken, "?preview=1")

	if firstViewedAt(t, db, project.ID) == nil {
		t.Fatal("pratinjau fotografer menghapus tanda kunjungan klien")
	}
}

func TestConcurrentVisitsDoNotOverwriteEachOther(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 2)

	// Klien yang menyegarkan halaman menjalankan permintaan yang dapat dilayani
	// dua instance serverless berbeda pada saat yang sama. Keduanya membaca
	// nil, sehingga penjaga di Go tidak menahan apa pun; yang menahan hanyalah
	// `WHERE first_viewed_at IS NULL` di dalam UPDATE-nya.
	//
	// Yang diuji di sini pernyataan SQL-nya, bukan handler-nya, dan itu
	// disengaja. Lewat handler, delapan kunjungan yang berlomba tetap berakhir
	// dengan satu nilai terisi baik penjaganya ada maupun tidak — selisih
	// waktunya beberapa mikrodetik dan tidak dapat dibedakan. Yang dapat
	// dibedakan: BERAPA BANYAK yang berhasil menulis. Dengan penjaganya, tepat
	// satu; tanpa penjaganya, kedelapannya.
	const n = 8
	var mulai, selesai sync.WaitGroup
	mulai.Add(1)
	selesai.Add(n)

	ok := make([]int64, n)
	for i := 0; i < n; i++ {
		go func(i int) {
			defer selesai.Done()
			mulai.Wait()
			res := db.Model(&models.Project{}).
				Where("id = ? AND first_viewed_at IS NULL", project.ID).
				Update("first_viewed_at", time.Now())
			ok[i] = res.RowsAffected
		}(i)
	}

	mulai.Done()
	selesai.Wait()

	var total int64
	for _, r := range ok {
		total += r
	}
	if total != 1 {
		t.Fatalf("%d dari %d penulisan mengenai baris; seharusnya tepat 1", total, n)
	}
	if firstViewedAt(t, db, project.ID) == nil {
		t.Fatal("tidak ada satu pun tanda yang tersimpan")
	}
}

func TestEightConcurrentVisitsProduceNoError(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 2)
	h := galleryHandler(t, db)

	const n = 8
	var mulai, selesai sync.WaitGroup
	mulai.Add(1)
	selesai.Add(n)

	kode := make([]int, n)
	for i := 0; i < n; i++ {
		go func(i int) {
			defer selesai.Done()
			mulai.Wait()
			kode[i] = openGallery(t, h, project.MagicLinkToken, "")
		}(i)
	}

	mulai.Done()
	selesai.Wait()

	for i, k := range kode {
		if k != 200 {
			t.Fatalf("kunjungan ke-%d dijawab %d, seharusnya 200", i, k)
		}
	}
	if firstViewedAt(t, db, project.ID) == nil {
		t.Fatal("delapan kunjungan bersamaan tidak menghasilkan satu pun tanda")
	}
}
