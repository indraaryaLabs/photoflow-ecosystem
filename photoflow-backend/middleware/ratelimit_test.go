package middleware_test

import (
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"photoflow-backend/middleware"
)

// Tes di berkas ini butuh PostgreSQL sungguhan: yang diuji adalah perilaku satu
// statement upsert, dan itu tidak bisa dibuktikan tanpa database yang benar-benar
// menjalankannya.
//
// DSN dibaca dari TEST_DATABASE_URL, BUKAN dari DATABASE_URL. Pemisahan itu
// disengaja: setiap tes di sini menjalankan DROP TABLE rate_limits, jadi menunjuk
// variabel yang sama dengan produksi akan menghapus penghitung yang sedang
// dipakai. Tanpa TEST_DATABASE_URL, seluruh berkas ini dilewati sehingga
// `go test ./...` tetap hijau di mesin tanpa Postgres.
//
// Menjalankannya secara lokal:
//
//	TEST_DATABASE_URL="host=127.0.0.1 port=5433 user=postgres dbname=postgres sslmode=disable" \
//	  go test ./middleware/...
func newTestDB(t *testing.T) *gorm.DB {
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

	db.Exec("DROP TABLE IF EXISTS rate_limits")
	if err := db.AutoMigrate(&middleware.RateLimit{}); err != nil {
		t.Fatalf("gagal menyiapkan tabel rate_limits: %v", err)
	}
	return db
}

// requestFrom membangun gin.Context yang seolah datang dari ip. Nilai kosong
// berarti tidak ada header sumber IP tepercaya sama sekali.
func requestFrom(ip string) *gin.Context {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/api/p/token", nil)
	if ip != "" {
		c.Request.Header.Set("x-real-ip", ip)
	}
	return c
}

func TestLimiterBlocksAfterMax(t *testing.T) {
	limiter := middleware.NewLimiter(newTestDB(t), 10*time.Minute, 20)

	blockedAt := 0
	for attempt := 1; attempt <= 25; attempt++ {
		if limiter.TooManyFailures(requestFrom("203.0.113.7")) && blockedAt == 0 {
			blockedAt = attempt
		}
	}

	if blockedAt != 21 {
		t.Fatalf("seharusnya diblokir pada percobaan ke-21, bukan ke-%d", blockedAt)
	}
}

func TestLimiterIsolatesIPs(t *testing.T) {
	limiter := middleware.NewLimiter(newTestDB(t), 10*time.Minute, 20)

	for i := 0; i < 25; i++ {
		limiter.TooManyFailures(requestFrom("203.0.113.7"))
	}

	if limiter.TooManyFailures(requestFrom("203.0.113.8")) {
		t.Fatal("IP kedua ikut terblokir; bucket tidak terisolasi per IP")
	}
}

func TestWindowResets(t *testing.T) {
	limiter := middleware.NewLimiter(newTestDB(t), 2*time.Second, 3)

	for i := 0; i < 5; i++ {
		limiter.TooManyFailures(requestFrom("203.0.113.9"))
	}
	if !limiter.TooManyFailures(requestFrom("203.0.113.9")) {
		t.Fatal("seharusnya masih terblokir selama window berjalan")
	}

	time.Sleep(2100 * time.Millisecond)

	if limiter.TooManyFailures(requestFrom("203.0.113.9")) {
		t.Fatal("window tidak ter-reset setelah kedaluwarsa")
	}
}

// TestConcurrentInvocationsCountCorrectly menjaga alasan utama penghitung ini
// disimpan di Postgres dan bukan di memori proses. Backend berjalan sebagai
// fungsi serverless: beberapa invocation berjalan berdampingan tanpa berbagi
// memori, jadi penghitungan harus tetap tepat ketika banyak request tiba
// bersamaan.
func TestConcurrentInvocationsCountCorrectly(t *testing.T) {
	db := newTestDB(t)
	limiter := middleware.NewLimiter(db, 10*time.Minute, 1_000_000)

	const concurrent = 50
	var wg sync.WaitGroup
	for i := 0; i < concurrent; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			limiter.TooManyFailures(requestFrom("203.0.113.10"))
		}()
	}
	wg.Wait()

	var hits int
	db.Raw("SELECT hit_count FROM rate_limits WHERE bucket_key = ?",
		"magic_link_miss:203.0.113.10").Scan(&hits)

	if hits != concurrent {
		t.Fatalf("hitungan hilang di bawah konkurensi: %d dari %d", hits, concurrent)
	}
}

// TestNoTrustedHeaderFailsOpen menjaga keputusan bahwa IP yang tidak dapat
// ditentukan membuat limiter DILEWATI, bukan jatuh ke satu bucket bersama.
// Bucket bersama berarti sejumlah kecil percobaan dari siapa pun akan mengunci
// galeri untuk seluruh klien sekaligus.
func TestNoTrustedHeaderFailsOpen(t *testing.T) {
	limiter := middleware.NewLimiter(newTestDB(t), 10*time.Minute, 1)

	for i := 0; i < 10; i++ {
		if limiter.TooManyFailures(requestFrom("")) {
			t.Fatal("tanpa IP tepercaya seharusnya fail-open, bukan memblokir semua pemanggil")
		}
	}
}

// TestSpoofedXForwardedForIgnored menjaga sifat yang menentukan apakah limiter
// ini ada gunanya sama sekali: kalau header yang dikirim klien ikut dipercaya,
// satu header berbeda per request sudah cukup untuk mendapat bucket baru setiap
// kali.
func TestSpoofedXForwardedForIgnored(t *testing.T) {
	limiter := middleware.NewLimiter(newTestDB(t), 10*time.Minute, 20)

	for i := 0; i < 25; i++ {
		c := requestFrom("203.0.113.7")
		c.Request.Header.Set("x-forwarded-for", "10.0.0.1")
		limiter.TooManyFailures(c)
	}

	c := requestFrom("203.0.113.7")
	c.Request.Header.Set("x-forwarded-for", "10.9.9.9")
	if !limiter.TooManyFailures(c) {
		t.Fatal("x-forwarded-for dari klien berhasil membuat bucket baru; limiter bisa dilewati")
	}
}
