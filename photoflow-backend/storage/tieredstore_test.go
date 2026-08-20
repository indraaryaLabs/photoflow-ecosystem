package storage

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// foto membuat satu PhotoRef seadanya untuk keperluan tes.
func photo(name string) PhotoRef {
	return PhotoRef{ID: "id-" + name, Name: name, ThumbnailLink: "https://contoh/" + name}
}

// berjenjang membangun TieredStore dengan kedua jalurnya sudah terisi
// palsu. oauthAmbi disetel supaya storeOAuth tidak mencoba membangunnya sendiri
// lewat database.
func tiered(public, oauth PhotoStore) *TieredStore {
	return &TieredStore{public: public, oauth: oauth, oauthAmbi: true}
}

func TestSuccessfulPublicPathNeverTouchesOAuth(t *testing.T) {
	public := NewFakeStore("folder-1", []PhotoRef{photo("a.jpg"), photo("b.jpg")})
	oauth := NewFakeStore("folder-1", []PhotoRef{photo("lain.jpg")})

	rows, err := tiered(public, oauth).ListPhotos(context.Background(), "folder-1")
	if err != nil {
		t.Fatalf("tidak mengharapkan error: %v", err)
	}
	if len(rows) != 2 {
		t.Errorf("jumlah foto = %d, mau 2", len(rows))
	}
	// Inti dari mendahulukan API key: folder publik tidak boleh membayar ongkos
	// OAuth sama sekali — tidak ada baris profiles yang dibaca, tidak ada
	// penukaran refresh token ke Google.
	if len(oauth.Calls) != 0 {
		t.Errorf("OAuth dipanggil %d kali, mau 0", len(oauth.Calls))
	}
}

func TestFailedPublicPathFallsBackToOAuth(t *testing.T) {
	public := &FakeStore{Err: errors.New("404 file not found")}
	oauth := NewFakeStore("folder-privat", []PhotoRef{photo("a.jpg")})

	rows, err := tiered(public, oauth).ListPhotos(context.Background(), "folder-privat")
	if err != nil {
		t.Fatalf("kegagalan jalur publik tidak boleh dinaikkan ke pemanggil: %v", err)
	}
	if len(rows) != 1 {
		t.Errorf("jumlah foto = %d, mau 1", len(rows))
	}
}

// Cabang yang paling mudah salah, dan paling mahal kalau salah.
func TestEmptyListFromAPIKeyIsNotTrusted(t *testing.T) {
	// Folder privat yang dibaca dengan API key bisa membalas 200 berisi nol
	// berkas — tidak terbedakan dari folder publik yang memang kosong. Kalau
	// jawaban itu dipercaya, galeri tampil kosong tanpa pesan apa pun padahal
	// fotonya ada dan OAuth bisa membacanya.
	public := NewFakeStore("folder-privat", []PhotoRef{})
	oauth := NewFakeStore("folder-privat", []PhotoRef{photo("a.jpg"), photo("b.jpg")})

	rows, err := tiered(public, oauth).ListPhotos(context.Background(), "folder-privat")
	if err != nil {
		t.Fatalf("tidak mengharapkan error: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("jumlah foto = %d, mau 2 — daftar kosong dari API key dipercaya mentah-mentah", len(rows))
	}
	if len(oauth.Calls) != 1 {
		t.Errorf("OAuth dipanggil %d kali, mau 1", len(oauth.Calls))
	}
}

func TestGenuinelyEmptyPublicFolderStaysEmpty(t *testing.T) {
	// Harga dari tes di atas: satu percobaan OAuth yang mubazir. Yang penting
	// hasilnya tetap benar, bukan error.
	public := NewFakeStore("folder-kosong", []PhotoRef{})
	oauth := NewFakeStore("folder-kosong", []PhotoRef{})

	rows, err := tiered(public, oauth).ListPhotos(context.Background(), "folder-kosong")
	if err != nil {
		t.Fatalf("tidak mengharapkan error: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("jumlah foto = %d, mau 0", len(rows))
	}
}

func TestWithoutAPIKeyGoesStraightToOAuth(t *testing.T) {
	// GOOGLE_API_KEY belum diisi: publik bernilai nil, dan store harus tetap
	// berfungsi penuh lewat jalur lama.
	oauth := NewFakeStore("folder-1", []PhotoRef{photo("a.jpg")})

	rows, err := tiered(nil, oauth).ListPhotos(context.Background(), "folder-1")
	if err != nil {
		t.Fatalf("tidak mengharapkan error: %v", err)
	}
	if len(rows) != 1 {
		t.Errorf("jumlah foto = %d, mau 1", len(rows))
	}
}

func TestActionableOAuthErrorsReachTheCaller(t *testing.T) {
	// Handler memetakan kedua sentinel ini ke kode yang membuat frontend
	// menampilkan tombol "hubungkan ulang Drive". Kalau jalur berjenjang
	// menelannya, user cuma melihat kegagalan umum tanpa tahu harus berbuat apa.
	for _, sentinel := range []error{ErrDriveNotConnected, ErrDriveReconnectRequired} {
		t.Run(sentinel.Error(), func(t *testing.T) {
			public := &FakeStore{Err: errors.New("404 file not found")}
			oauth := &FakeStore{Err: sentinel}

			_, err := tiered(public, oauth).ListPhotos(context.Background(), "folder-1")
			if !errors.Is(err, sentinel) {
				t.Errorf("error = %v, mau %v", err, sentinel)
			}
		})
	}
}

func TestResolveThumbnailURL(t *testing.T) {
	cases := []struct {
		name   string
		public bool
		fileID string
		input  string
		want   string
	}{
		{
			name:   "kosong tetap kosong",
			public: true,
			fileID: "abc",
			input:  "",
			want:   "",
		},
		{
			// Bentuk stabil: diturunkan dari file ID, tanpa masa berlaku.
			name:   "folder publik disusun dari file ID",
			public: true,
			fileID: "abc123",
			input:  "https://lh3.googleusercontent.com/xyz=s220",
			want:   "https://drive.google.com/thumbnail?id=abc123&sz=w400",
		},
		{
			name:   "jalur oauth memakai alamat dari google",
			public: false,
			fileID: "abc123",
			input:  "https://lh3.googleusercontent.com/xyz=s220",
			want:   "https://lh3.googleusercontent.com/xyz=s400",
		},
		{
			// s1000 warisan lama dibiarkan; frontend yang mengecilkannya.
			name:   "ukuran tak dikenal dibiarkan apa adanya",
			public: false,
			fileID: "abc123",
			input:  "https://lh3.googleusercontent.com/xyz=s1000",
			want:   "https://lh3.googleusercontent.com/xyz=s1000",
		},
	}

	for _, k := range cases {
		t.Run(k.name, func(t *testing.T) {
			got := resolveThumbnailURL(k.public, k.fileID, k.input)
			if got != k.want {
				t.Errorf("dapat %q, mau %q", got, k.want)
			}
		})
	}
}

func TestNewPublicGDriveStoreWithoutKey(t *testing.T) {
	t.Setenv("GOOGLE_API_KEY", "")

	_, err := NewPublicGDriveStore(context.Background())
	if !errors.Is(err, ErrAPIKeyNotConfigured) {
		t.Errorf("error = %v, mau ErrAPIKeyNotConfigured", err)
	}
}

func TestNewTieredStoreWithoutKeyStaysUsable(t *testing.T) {
	t.Setenv("GOOGLE_API_KEY", "")

	store := NewTieredStore(context.Background(), nil, "user-1")
	if store == nil {
		t.Fatal("store nil; jalur OAuth harus tetap tersedia tanpa API key")
	}
	if s, ok := store.(*TieredStore); !ok || s.public != nil {
		t.Error("jalur publik seharusnya tidak terbentuk tanpa API key")
	}
}

func TestThumbnailURLPassesThroughChosenAddress(t *testing.T) {
	// Kedua jalur sudah menaruh alamat final di ThumbnailLink saat melisting,
	// jadi ThumbnailURL tidak boleh menambah keputusan kedua di sini.
	ref := PhotoRef{ThumbnailLink: "https://drive.google.com/thumbnail?id=x&sz=w400"}

	got := tiered(nil, nil).ThumbnailURL(ref)
	if !strings.Contains(got, "id=x") {
		t.Errorf("dapat %q, mau alamat yang sudah dipilih saat melisting", got)
	}
}
