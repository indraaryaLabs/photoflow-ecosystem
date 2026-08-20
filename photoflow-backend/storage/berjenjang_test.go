package storage

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// foto membuat satu PhotoRef seadanya untuk keperluan tes.
func foto(nama string) PhotoRef {
	return PhotoRef{ID: "id-" + nama, Name: nama, ThumbnailLink: "https://contoh/" + nama}
}

// berjenjang membangun StoreBerjenjang dengan kedua jalurnya sudah terisi
// palsu. oauthAmbi disetel supaya storeOAuth tidak mencoba membangunnya sendiri
// lewat database.
func berjenjang(publik, oauth PhotoStore) *StoreBerjenjang {
	return &StoreBerjenjang{publik: publik, oauth: oauth, oauthAmbi: true}
}

func TestJalurPublikBerhasilTidakMenyentuhOAuth(t *testing.T) {
	publik := NewFakeStore("folder-1", []PhotoRef{foto("a.jpg"), foto("b.jpg")})
	oauth := NewFakeStore("folder-1", []PhotoRef{foto("lain.jpg")})

	hasil, err := berjenjang(publik, oauth).ListPhotos(context.Background(), "folder-1")
	if err != nil {
		t.Fatalf("tidak mengharapkan error: %v", err)
	}
	if len(hasil) != 2 {
		t.Errorf("jumlah foto = %d, mau 2", len(hasil))
	}
	// Inti dari mendahulukan API key: folder publik tidak boleh membayar ongkos
	// OAuth sama sekali — tidak ada baris profiles yang dibaca, tidak ada
	// penukaran refresh token ke Google.
	if len(oauth.Calls) != 0 {
		t.Errorf("OAuth dipanggil %d kali, mau 0", len(oauth.Calls))
	}
}

func TestJalurPublikGagalBeralihKeOAuth(t *testing.T) {
	publik := &FakeStore{Err: errors.New("404 file not found")}
	oauth := NewFakeStore("folder-privat", []PhotoRef{foto("a.jpg")})

	hasil, err := berjenjang(publik, oauth).ListPhotos(context.Background(), "folder-privat")
	if err != nil {
		t.Fatalf("kegagalan jalur publik tidak boleh dinaikkan ke pemanggil: %v", err)
	}
	if len(hasil) != 1 {
		t.Errorf("jumlah foto = %d, mau 1", len(hasil))
	}
}

// Cabang yang paling mudah salah, dan paling mahal kalau salah.
func TestDaftarKosongDariAPIKeyTidakDipercaya(t *testing.T) {
	// Folder privat yang dibaca dengan API key bisa membalas 200 berisi nol
	// berkas — tidak terbedakan dari folder publik yang memang kosong. Kalau
	// jawaban itu dipercaya, galeri tampil kosong tanpa pesan apa pun padahal
	// fotonya ada dan OAuth bisa membacanya.
	publik := NewFakeStore("folder-privat", []PhotoRef{})
	oauth := NewFakeStore("folder-privat", []PhotoRef{foto("a.jpg"), foto("b.jpg")})

	hasil, err := berjenjang(publik, oauth).ListPhotos(context.Background(), "folder-privat")
	if err != nil {
		t.Fatalf("tidak mengharapkan error: %v", err)
	}
	if len(hasil) != 2 {
		t.Fatalf("jumlah foto = %d, mau 2 — daftar kosong dari API key dipercaya mentah-mentah", len(hasil))
	}
	if len(oauth.Calls) != 1 {
		t.Errorf("OAuth dipanggil %d kali, mau 1", len(oauth.Calls))
	}
}

func TestFolderPublikYangSungguhKosongTetapKosong(t *testing.T) {
	// Harga dari tes di atas: satu percobaan OAuth yang mubazir. Yang penting
	// hasilnya tetap benar, bukan error.
	publik := NewFakeStore("folder-kosong", []PhotoRef{})
	oauth := NewFakeStore("folder-kosong", []PhotoRef{})

	hasil, err := berjenjang(publik, oauth).ListPhotos(context.Background(), "folder-kosong")
	if err != nil {
		t.Fatalf("tidak mengharapkan error: %v", err)
	}
	if len(hasil) != 0 {
		t.Errorf("jumlah foto = %d, mau 0", len(hasil))
	}
}

func TestTanpaAPIKeyLangsungKeOAuth(t *testing.T) {
	// GOOGLE_API_KEY belum diisi: publik bernilai nil, dan store harus tetap
	// berfungsi penuh lewat jalur lama.
	oauth := NewFakeStore("folder-1", []PhotoRef{foto("a.jpg")})

	hasil, err := berjenjang(nil, oauth).ListPhotos(context.Background(), "folder-1")
	if err != nil {
		t.Fatalf("tidak mengharapkan error: %v", err)
	}
	if len(hasil) != 1 {
		t.Errorf("jumlah foto = %d, mau 1", len(hasil))
	}
}

func TestErrorOAuthYangDapatDitindaklanjutiTetapSampai(t *testing.T) {
	// Handler memetakan kedua sentinel ini ke kode yang membuat frontend
	// menampilkan tombol "hubungkan ulang Drive". Kalau jalur berjenjang
	// menelannya, user cuma melihat kegagalan umum tanpa tahu harus berbuat apa.
	for _, sentinel := range []error{ErrDriveNotConnected, ErrDriveReconnectRequired} {
		t.Run(sentinel.Error(), func(t *testing.T) {
			publik := &FakeStore{Err: errors.New("404 file not found")}
			oauth := &FakeStore{Err: sentinel}

			_, err := berjenjang(publik, oauth).ListPhotos(context.Background(), "folder-1")
			if !errors.Is(err, sentinel) {
				t.Errorf("error = %v, mau %v", err, sentinel)
			}
		})
	}
}

func TestAlamatThumbnail(t *testing.T) {
	kasus := []struct {
		nama    string
		publik  bool
		fileID  string
		masukan string
		mau     string
	}{
		{
			nama:    "kosong tetap kosong",
			publik:  true,
			fileID:  "abc",
			masukan: "",
			mau:     "",
		},
		{
			// Bentuk stabil: diturunkan dari file ID, tanpa masa berlaku.
			nama:    "folder publik disusun dari file ID",
			publik:  true,
			fileID:  "abc123",
			masukan: "https://lh3.googleusercontent.com/xyz=s220",
			mau:     "https://drive.google.com/thumbnail?id=abc123&sz=w400",
		},
		{
			nama:    "jalur oauth memakai alamat dari google",
			publik:  false,
			fileID:  "abc123",
			masukan: "https://lh3.googleusercontent.com/xyz=s220",
			mau:     "https://lh3.googleusercontent.com/xyz=s400",
		},
		{
			// s1000 warisan lama dibiarkan; frontend yang mengecilkannya.
			nama:    "ukuran tak dikenal dibiarkan apa adanya",
			publik:  false,
			fileID:  "abc123",
			masukan: "https://lh3.googleusercontent.com/xyz=s1000",
			mau:     "https://lh3.googleusercontent.com/xyz=s1000",
		},
	}

	for _, k := range kasus {
		t.Run(k.nama, func(t *testing.T) {
			dapat := alamatThumbnail(k.publik, k.fileID, k.masukan)
			if dapat != k.mau {
				t.Errorf("dapat %q, mau %q", dapat, k.mau)
			}
		})
	}
}

func TestNewPublicGDriveStoreTanpaKunci(t *testing.T) {
	t.Setenv("GOOGLE_API_KEY", "")

	_, err := NewPublicGDriveStore(context.Background())
	if !errors.Is(err, ErrAPIKeyNotConfigured) {
		t.Errorf("error = %v, mau ErrAPIKeyNotConfigured", err)
	}
}

func TestNewStoreBerjenjangTanpaKunciTetapBerguna(t *testing.T) {
	t.Setenv("GOOGLE_API_KEY", "")

	store := NewStoreBerjenjang(context.Background(), nil, "user-1")
	if store == nil {
		t.Fatal("store nil; jalur OAuth harus tetap tersedia tanpa API key")
	}
	if s, ok := store.(*StoreBerjenjang); !ok || s.publik != nil {
		t.Error("jalur publik seharusnya tidak terbentuk tanpa API key")
	}
}

func TestThumbnailURLMeneruskanAlamatYangSudahDipilih(t *testing.T) {
	// Kedua jalur sudah menaruh alamat final di ThumbnailLink saat melisting,
	// jadi ThumbnailURL tidak boleh menambah keputusan kedua di sini.
	ref := PhotoRef{ThumbnailLink: "https://drive.google.com/thumbnail?id=x&sz=w400"}

	dapat := berjenjang(nil, nil).ThumbnailURL(ref)
	if !strings.Contains(dapat, "id=x") {
		t.Errorf("dapat %q, mau alamat yang sudah dipilih saat melisting", dapat)
	}
}
