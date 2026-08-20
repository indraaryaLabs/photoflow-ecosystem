package handlers

import (
	"context"
	"errors"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"photoflow-backend/notify"
)

// Pemberitahuan email menempel pada jalur yang paling tidak boleh rusak: submit
// pilihan klien. Karena itu yang diuji bukan bahwa emailnya terkirim, melainkan
// bahwa kegagalan mengirimnya TIDAK PERNAH merembet ke pekerjaan klien.

type mailerPalsu struct {
	dipanggil int
	to        string
	subjek    string
	badan     string
	err       error
}

func (m *mailerPalsu) Send(_ context.Context, to, subject, htmlBody string) error {
	m.dipanggil++
	m.to, m.subjek, m.badan = to, subject, htmlBody
	return m.err
}

// siapkanAuthUsers membuat tiruan tabel auth.users milik Supabase.
//
// Alamat email fotografer tinggal di sana, bukan di tabel aplikasi ini, jadi
// tanpa tiruannya pencarian email selalu gagal dan pemberitahuan tidak pernah
// sampai dicoba -- tesnya akan hijau tanpa menguji apa pun.
func siapkanAuthUsers(t *testing.T, db *gorm.DB, userID, email string) {
	t.Helper()

	db.Exec("CREATE SCHEMA IF NOT EXISTS auth")
	db.Exec("CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text)")
	if err := db.Exec(
		"INSERT INTO auth.users (id, email) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email",
		userID, email).Error; err != nil {
		t.Fatalf("gagal menyiapkan auth.users: %v", err)
	}
}

// callSubmit menjalankan handler HTTP-nya, bukan submitSelection langsung:
// pemberitahuan hidup di handler, jadi memanggil lapisan bawahnya akan
// melewatinya.
func callSubmit(t *testing.T, h *Handler, magicLink string, names []string) (int, string) {
	t.Helper()

	bagian := make([]string, 0, len(names))
	for _, n := range names {
		bagian = append(bagian, fmt.Sprintf(`{"drive_id":%q,"file_name":%q}`, n, n))
	}
	badan := fmt.Sprintf(`{"selected_photos":[%s]}`, strings.Join(bagian, ","))

	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest("POST", "/api/p/"+magicLink+"/submit", strings.NewReader(badan))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Params = gin.Params{{Key: "magic_link", Value: magicLink}}

	h.SubmitSelection(c)
	return rec.Code, rec.Body.String()
}

func TestSubmitStillSucceedsWhenEmailFails(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 2)
	m := &mailerPalsu{err: errors.New("penyedia email sedang mati")}
	h := &Handler{DB: db, Mailer: m}
	siapkanAuthUsers(t, db, project.UserID, "fotografer@contoh.test")

	code, _ := callSubmit(t, h, project.MagicLinkToken, []string{"asli.jpg"})

	// Pilihan klien sudah tersimpan sebelum email dicoba. Membalas error di
	// sini akan membuatnya mengira pekerjaannya hilang, lalu mencoba lagi ke
	// galeri yang sudah terkunci.
	if code != 200 {
		t.Fatalf("kode %d, seharusnya 200 meski email gagal", code)
	}
	if m.dipanggil != 1 {
		t.Fatalf("mailer dipanggil %d kali, seharusnya 1", m.dipanggil)
	}
	if got := projectStatus(t, db, project.ID); got != "submitted" {
		t.Fatalf("status %q, seharusnya submitted", got)
	}
}

func TestSubmitTidakPanicSaatMailerBelumDisetel(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 1)
	// Mailer nil meniru Handler yang dibangun langsung di tes lain, tanpa New().
	h := &Handler{DB: db}

	if code, _ := callSubmit(t, h, project.MagicLinkToken, []string{"asli.jpg"}); code != 200 {
		t.Fatalf("kode %d, seharusnya 200", code)
	}
}

func TestSubmitSendsNoEmailWhenGalleryIsLocked(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 2)
	m := &mailerPalsu{}
	h := &Handler{DB: db, Mailer: m}
	siapkanAuthUsers(t, db, project.UserID, "fotografer@contoh.test")

	if code, _ := callSubmit(t, h, project.MagicLinkToken, []string{"asli.jpg"}); code != 200 {
		t.Fatal("persiapan gagal")
	}
	awal := m.dipanggil

	// Submit kedua ditolak. Mengirim pemberitahuan untuknya akan memberi tahu
	// fotografer soal kiriman yang tidak pernah tersimpan.
	if code, _ := callSubmit(t, h, project.MagicLinkToken, []string{"asli.jpg"}); code != 409 {
		t.Fatalf("kode %d, seharusnya 409", code)
	}
	if m.dipanggil != awal {
		t.Fatalf("email terkirim untuk submit yang ditolak")
	}
}

// ── Isi pemberitahuannya ────────────────────────────────────────────

func TestNotificationNamesClientAndCount(t *testing.T) {
	subjek, badan := notify.SelectionSubmitted("The Hartleys", "Engagement", 12, "https://x/dashboard")

	if !strings.Contains(subjek, "The Hartleys") || !strings.Contains(subjek, "12") {
		t.Fatalf("subjek = %q", subjek)
	}
	// Subjek harus terbaca utuh di daftar kotak masuk ponsel, yang memotong
	// sekitar 40 karakter.
	if len(subjek) > 60 {
		t.Fatalf("subjek terlalu panjang (%d): %q", len(subjek), subjek)
	}
	if !strings.Contains(badan, "Engagement") || !strings.Contains(badan, "https://x/dashboard") {
		t.Fatalf("badan tidak memuat nama project atau tautannya")
	}
}

func TestNotificationUsesSingularForOnePhoto(t *testing.T) {
	subjek, _ := notify.SelectionSubmitted("Dita", "Prewedding", 1, "https://x")
	if strings.Contains(subjek, "1 photos") {
		t.Fatalf("subjek = %q, seharusnya bentuk tunggal", subjek)
	}
}

func TestNotificationEscapesHTMLInNames(t *testing.T) {
	// Nama klien dan nama project datang dari isian orang dan masuk ke dokumen
	// HTML. Tanpa di-escape, satu nama berisi tag ikut dijalankan di kotak
	// masuk pembacanya.
	_, badan := notify.SelectionSubmitted(
		`<img src=x onerror=alert(1)>`, "Proyek", 3, "https://x")

	if strings.Contains(badan, "<img src=x") {
		t.Fatalf("nama klien masuk sebagai HTML mentah:\n%s", badan)
	}
	if !strings.Contains(badan, "&lt;img") {
		t.Fatalf("nama klien tidak ter-escape:\n%s", badan)
	}
}

func TestMailerNonaktifTidakMelakukanApaPun(t *testing.T) {
	// Keadaan "belum dikonfigurasi" harus wajar, bukan error: aplikasi berjalan
	// penuh tanpanya.
	if err := (notify.Disabled{}).Send(context.Background(), "a@b.c", "s", "b"); err != nil {
		t.Fatalf("mailer nonaktif mengembalikan error: %v", err)
	}
}
