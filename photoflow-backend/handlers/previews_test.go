package handlers

import (
	"testing"

	"photoflow-backend/models"
)

// Pratinjau kartu project mengambil empat thumbnail per project. Yang diuji di
// sini bukan tampilannya, melainkan berapa BANYAK yang melintas dari database:
// versi sebelumnya menarik seluruh baris foto lalu membuang kelebihannya di Go,
// sehingga satu galeri 2.000 foto membebani setiap pembukaan dashboard.

func seedFoto(t *testing.T, h *Handler, projectID string, n int) {
	t.Helper()
	foto := make([]models.Photo, 0, n)
	for i := 0; i < n; i++ {
		foto = append(foto, models.Photo{
			ProjectID: projectID,
			// Nama diberi nol di depan supaya urutan leksikografisnya sama
			// dengan urutan angkanya; tanpa itu "foto-10" mendahului "foto-2".
			FileName:     "foto-" + pad(i),
			ThumbnailURL: "https://contoh/" + pad(i) + ".jpg",
		})
	}
	if err := sisipkanFoto(h.DB, foto); err != nil {
		t.Fatalf("gagal menyiapkan %d foto: %v", n, err)
	}
}

func pad(i int) string {
	s := []byte("00000")
	for k := len(s) - 1; k >= 0 && i > 0; k-- {
		s[k] = byte('0' + i%10)
		i /= 10
	}
	return string(s)
}

func TestPratinjauDibatasiEmpatPerProject(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 0)
	h := &Handler{DB: db}

	seedFoto(t, h, project.ID, 2000)

	peta := h.previewThumbnails([]string{project.ID})
	if got := len(peta[project.ID]); got != 4 {
		t.Fatalf("%d pratinjau, seharusnya 4", got)
	}
}

func TestPratinjauMengambilYangPertamaMenurutNama(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 0)
	h := &Handler{DB: db}

	seedFoto(t, h, project.ID, 50)

	// Urutannya harus tetap menurut nama berkas, bukan urutan penyisipan atau
	// urutan yang kebetulan dikembalikan Postgres. Kartu project yang
	// pratinjaunya berganti-ganti tiap muat ulang terlihat seperti kerusakan.
	peta := h.previewThumbnails([]string{project.ID})
	diharapkan := []string{
		"https://contoh/00000.jpg",
		"https://contoh/00001.jpg",
		"https://contoh/00002.jpg",
		"https://contoh/00003.jpg",
	}
	for i, w := range diharapkan {
		if peta[project.ID][i] != w {
			t.Fatalf("pratinjau[%d] = %q, seharusnya %q", i, peta[project.ID][i], w)
		}
	}
}

func TestPratinjauMemisahkanTiapProject(t *testing.T) {
	db := newSubmitTestDB(t)
	a := seedProject(t, db, 0)
	h := &Handler{DB: db}

	b := a
	b.ID = ""
	b.MagicLinkToken = a.MagicLinkToken + "-b"
	if err := db.Create(&b).Error; err != nil {
		t.Fatalf("gagal menyiapkan project kedua: %v", err)
	}

	seedFoto(t, h, a.ID, 10)
	seedFoto(t, h, b.ID, 10)

	// PARTITION BY yang salah akan memberi empat pratinjau untuk seluruh
	// kumpulan, bukan empat untuk masing-masing.
	peta := h.previewThumbnails([]string{a.ID, b.ID})
	if len(peta[a.ID]) != 4 || len(peta[b.ID]) != 4 {
		t.Fatalf("a=%d b=%d, keduanya seharusnya 4", len(peta[a.ID]), len(peta[b.ID]))
	}
}

func TestPratinjauMelewatiFotoTanpaThumbnail(t *testing.T) {
	db := newSubmitTestDB(t)
	project := seedProject(t, db, 0)
	h := &Handler{DB: db}

	// Baris yang lahir dari submit klien tidak punya thumbnail. Ikut terhitung,
	// kartunya akan memesan tempat untuk gambar yang tidak pernah ada.
	kosong := []models.Photo{
		{ProjectID: project.ID, FileName: "a.jpg", ThumbnailURL: ""},
		{ProjectID: project.ID, FileName: "b.jpg", ThumbnailURL: ""},
	}
	if err := sisipkanFoto(h.DB, kosong); err != nil {
		t.Fatalf("gagal menyiapkan: %v", err)
	}
	seedFoto(t, h, project.ID, 2)

	peta := h.previewThumbnails([]string{project.ID})
	if got := len(peta[project.ID]); got != 2 {
		t.Fatalf("%d pratinjau, seharusnya 2 — yang tanpa thumbnail ikut terhitung", got)
	}
}
