// Package storage menyediakan akses ke penyimpanan foto milik fotografer.
package storage

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// PhotoRef adalah satu berkas foto di penyimpanan, dalam bentuk yang seragam
// apa pun sumbernya. Bentuk ini juga yang dikirim ke frontend, sehingga galeri
// tidak perlu tahu apakah datanya baru saja ditarik dari Drive atau diambil
// dari salinan yang tersimpan di database.
type PhotoRef struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	MimeType      string `json:"mimeType"`
	ThumbnailLink string `json:"thumbnailLink"`

	// Ukuran asli berkasnya, kalau Drive mengetahuinya. Nol berarti tidak
	// diketahui, dan galeri mengukurnya sendiri setelah gambarnya termuat.
	//
	// Dikirim supaya galeri dapat menyusun barisnya dengan rasio yang benar
	// pada gambar pertama. Tanpa ini seluruh foto dianggap bujur sangkar dulu,
	// lalu tata letaknya melompat begitu ukuran sebenarnya diketahui satu per
	// satu -- persis jenis pergeseran tata letak yang paling mengganggu ketika
	// orang sedang mengetuk-ngetuk memilih foto.
	Width  int `json:"width,omitempty"`
	Height int `json:"height,omitempty"`
}

// PhotoStore membaca daftar foto sebuah sumber, misalnya satu folder Drive.
//
// Interface ini ada supaya handler bisa diuji tanpa memanggil jaringan, dan
// supaya penyimpanan lain bisa dipasang tanpa mengubah handler.
type PhotoStore interface {
	// ListPhotos mengembalikan foto pada sourceRef, misalnya ID folder Drive.
	ListPhotos(ctx context.Context, sourceRef string) ([]PhotoRef, error)
	// ThumbnailURL mengembalikan URL thumbnail yang bisa dipakai frontend.
	ThumbnailURL(ref PhotoRef) string
}

// Kesalahan yang perlu dibedakan pemanggil, karena penanganannya berbeda:
// yang pertama berarti user belum pernah menghubungkan Drive, yang kedua
// berarti izinnya pernah ada tapi sudah tidak berlaku lagi. Keduanya menuntut
// user menghubungkan ulang, tapi hanya yang kedua yang menandakan sesuatu
// berubah di sisi Google.
var (
	ErrDriveNotConnected      = errors.New("user belum menghubungkan Google Drive")
	ErrDriveReconnectRequired = errors.New("koneksi Google Drive perlu diperbarui")

	// ErrAPIKeyNotConfigured berarti GOOGLE_API_KEY belum diisi, sehingga jalur
	// folder publik tidak tersedia. Bukan kesalahan yang perlu dilihat user:
	// pemanggil tinggal memakai kredensial OAuth fotografer seperti sebelumnya.
	ErrAPIKeyNotConfigured = errors.New("GOOGLE_API_KEY belum dikonfigurasi")
)

// imageExtensions adalah ekstensi yang dianggap foto walaupun MIME type-nya
// bukan image/*, yaitu format RAW milik kamera profesional.
var imageExtensions = map[string]bool{
	"jpg": true, "jpeg": true, "png": true, "webp": true, // web standard
	"cr2": true, "nef": true, "arw": true, "dng": true, "raw": true, "orf": true, "rw2": true, // RAW format professional
}

// isImage melaporkan apakah berkas dianggap foto yang bisa ditampilkan.
func isImage(name, mimeType string) bool {
	if strings.HasPrefix(mimeType, "image/") {
		return true
	}
	parts := strings.Split(strings.ToLower(name), ".")
	if len(parts) < 2 {
		return false
	}
	return imageExtensions[parts[len(parts)-1]]
}

// FakeStore adalah PhotoStore untuk keperluan tes: tidak memanggil jaringan
// sama sekali, dan bisa dipaksa mengembalikan kesalahan tertentu.
type FakeStore struct {
	// Photos dipetakan per sourceRef, sehingga satu FakeStore bisa melayani
	// beberapa folder sekaligus.
	Photos map[string][]PhotoRef
	// Err, kalau diisi, dikembalikan ListPhotos alih-alih data.
	Err error
	// Calls mencatat sourceRef yang diminta, untuk diperiksa tes.
	Calls []string
}

// NewFakeStore membuat FakeStore yang melayani satu sourceRef.
func NewFakeStore(sourceRef string, photos []PhotoRef) *FakeStore {
	return &FakeStore{Photos: map[string][]PhotoRef{sourceRef: photos}}
}

func (f *FakeStore) ListPhotos(_ context.Context, sourceRef string) ([]PhotoRef, error) {
	f.Calls = append(f.Calls, sourceRef)
	if f.Err != nil {
		return nil, f.Err
	}
	photos, ok := f.Photos[sourceRef]
	if !ok {
		return nil, fmt.Errorf("folder %q tidak ditemukan", sourceRef)
	}
	return photos, nil
}

func (f *FakeStore) ThumbnailURL(ref PhotoRef) string {
	return ref.ThumbnailLink
}
