// Package notify mengirim pemberitahuan ke fotografer.
//
// Sampai sekarang tidak ada pemberitahuan apa pun ketika klien mengirim
// pilihannya. Satu-satunya kabar bergantung pada klien menekan tombol WhatsApp
// sesudah submit, dan kalau ia lupa, fotografer tidak pernah tahu pekerjaannya
// sudah bisa dilanjutkan. Dashboard menandai kiriman baru dengan lencana, tapi
// itu hanya terlihat oleh orang yang kebetulan membukanya.
//
// Paket ini sengaja tidak bergantung pada satu penyedia. `Mailer` adalah
// antarmuka; `Resend` satu-satunya implementasi hari ini, dan `Disabled`
// dipakai ketika belum dikonfigurasi. Dengan begitu penyedia dapat diganti
// tanpa menyentuh handler, dan aplikasi tetap berjalan penuh tanpa penyedia
// mana pun.
package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// Mailer mengirim satu email.
type Mailer interface {
	Send(ctx context.Context, to, subject, htmlBody string) error
}

// Disabled adalah Mailer yang tidak mengirim apa pun.
//
// Bukan nil: handler memanggilnya tanpa memeriksa, dan Mailer nil akan panic.
// Keadaan "belum dikonfigurasi" itu wajar, bukan kesalahan — aplikasi berjalan
// penuh tanpanya, yang hilang hanya pemberitahuannya.
type Disabled struct{}

func (Disabled) Send(context.Context, string, string, string) error { return nil }

// Resend mengirim lewat API Resend.
//
// Dipanggil langsung dengan net/http alih-alih memakai SDK-nya: yang dibutuhkan
// satu POST dengan badan JSON, dan menambah satu dependensi untuk itu berarti
// menambah permukaan yang harus diperbarui tanpa menghemat kode yang berarti.
type Resend struct {
	APIKey string
	From   string
	Client *http.Client
}

// FromEnv membangun Mailer dari environment.
//
// Mengembalikan Disabled — bukan error — ketika belum dikonfigurasi. Backend
// harus tetap melayani galeri dan submit tanpa penyedia email; menolak start
// karena pemberitahuan belum disiapkan berarti menukar fitur tambahan dengan
// seluruh aplikasi.
func FromEnv() Mailer {
	key := strings.TrimSpace(os.Getenv("RESEND_API_KEY"))
	from := strings.TrimSpace(os.Getenv("NOTIFY_FROM_EMAIL"))

	if key == "" || from == "" {
		log.Printf("notify: pemberitahuan email nonaktif (RESEND_API_KEY atau NOTIFY_FROM_EMAIL kosong)")
		return Disabled{}
	}
	return &Resend{
		APIKey: key,
		From:   from,
		// Batas waktu wajib. Handler ini berjalan sebagai fungsi serverless dan
		// klien sedang menunggu balasan submit; penyedia yang menggantung tidak
		// boleh ikut menggantungkan orang yang baru saja menekan tombol kirim.
		Client: &http.Client{Timeout: 5 * time.Second},
	}
}

func (r *Resend) Send(ctx context.Context, to, subject, htmlBody string) error {
	badan, err := json.Marshal(map[string]any{
		"from":    r.From,
		"to":      []string{to},
		"subject": subject,
		"html":    htmlBody,
	})
	if err != nil {
		return fmt.Errorf("menyusun badan email: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.resend.com/emails", bytes.NewReader(badan))
	if err != nil {
		return fmt.Errorf("menyusun permintaan: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+r.APIKey)
	req.Header.Set("Content-Type", "application/json")

	res, err := r.Client.Do(req)
	if err != nil {
		return fmt.Errorf("mengirim email: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode >= 300 {
		// Badan responsnya dibaca dan disertakan: tanpa itu, kegagalan paling
		// umum -- domain pengirim belum diverifikasi -- hanya tampak sebagai
		// "403" tanpa petunjuk apa pun ke arah sebabnya.
		var pesan bytes.Buffer
		_, _ = pesan.ReadFrom(res.Body)
		return fmt.Errorf("resend menolak (%d): %s", res.StatusCode,
			strings.TrimSpace(pesan.String()))
	}
	return nil
}

// SelectionSubmitted menyusun isi pemberitahuan bahwa klien sudah memilih.
//
// Mengembalikan subjek dan badan HTML, bukan mengirim, supaya isinya dapat
// diuji tanpa jaringan maupun penyedia.
func SelectionSubmitted(clientName, projectName string, count int, dashboardURL string) (string, string) {
	// Nama klien dan nama project datang dari isian orang, dan keduanya masuk
	// ke dokumen HTML. Tanpa di-escape, satu nama berisi tag akan ikut
	// dijalankan di kotak masuk pembacanya.
	klien := html.EscapeString(clientName)
	proyek := html.EscapeString(projectName)
	if proyek == "" {
		proyek = klien
	}

	subjek := fmt.Sprintf("%s picked %d photo%s", klien, count, jamak(count))

	badan := fmt.Sprintf(`<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#212529">
  <p><strong>%s</strong> finished choosing photos for <strong>%s</strong>.</p>
  <p>%d photo%s selected.</p>
  <p><a href="%s" style="display:inline-block;background:#212529;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:10px">Review the picks</a></p>
  <p style="color:#6c757d;font-size:13px">You are receiving this because you created this project in PhotoFlow.</p>
</div>`, klien, proyek, count, jamak(count), html.EscapeString(dashboardURL))

	return subjek, badan
}

func jamak(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}
