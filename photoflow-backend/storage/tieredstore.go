package storage

import (
	"context"
	"errors"
	"log"

	"gorm.io/gorm"
)

// TieredStore membaca folder lewat API key dulu, dan baru memakai
// kredensial OAuth fotografer kalau cara itu tidak berhasil.
//
// Urutannya disengaja. Hampir semua folder di PhotoFlow dibagikan publik —
// memang begitu cara fotografer mengirimkannya ke klien — dan untuk folder
// seperti itu API key sudah cukup. Menempatkannya di depan berarti kasus yang
// paling umum tidak menyentuh OAuth sama sekali: tidak ada baris profiles yang
// dibaca, tidak ada penukaran refresh token ke Google, dan tidak ada yang
// rusak ketika refresh token kedaluwarsa setiap tujuh hari selama consent
// screen masih berstatus Testing.
//
// OAuth tetap ada dan tidak diubah. Ia melayani yang tidak dapat dilayani API
// key — folder privat — dan sekaligus menjadi jaring pengaman selama jalur
// baru ini belum terbukti di produksi.
type TieredStore struct {
	db     *gorm.DB
	userID string

	// publik dibangun sekali di depan; membangunnya tidak memanggil jaringan.
	public PhotoStore

	// oauth dibangun MALAS. Membangunnya membaca baris profiles, dan database
	// ada di benua lain — ongkos itu tidak boleh dibayar permintaan yang tidak
	// pernah membutuhkannya.
	oauth     PhotoStore
	oauthErr  error
	oauthAmbi bool
}

// NewTieredStore membangun store yang mencoba kedua jalur.
//
// Tidak pernah mengembalikan error: kalau API key belum dikonfigurasi, store
// ini tetap berguna karena jalur OAuth-nya utuh. Kegagalan yang sesungguhnya
// baru muncul di ListPhotos, ketika sudah diketahui folder mana yang diminta.
func NewTieredStore(ctx context.Context, db *gorm.DB, userID string) PhotoStore {
	s := &TieredStore{db: db, userID: userID}

	public, err := NewPublicGDriveStore(ctx)
	if err != nil {
		if !errors.Is(err, ErrAPIKeyNotConfigured) {
			log.Printf("[WARN] Klien Drive publik tidak dapat dibangun: %v", err)
		}
		return s
	}
	s.public = public
	return s
}

// storeOAuth membangun store OAuth pada pemakaian pertama, lalu menyimpannya.
func (s *TieredStore) storeOAuth(ctx context.Context) (PhotoStore, error) {
	if !s.oauthAmbi {
		s.oauthAmbi = true
		store, err := NewGDriveStoreForUser(ctx, s.db, s.userID)
		if err != nil {
			s.oauthErr = err
		} else {
			s.oauth = store
		}
	}
	return s.oauth, s.oauthErr
}

// ListPhotos mencoba jalur publik lebih dulu, lalu jalur OAuth.
func (s *TieredStore) ListPhotos(ctx context.Context, sourceRef string) ([]PhotoRef, error) {
	if s.public != nil {
		photos, err := s.public.ListPhotos(ctx, sourceRef)
		switch {
		case err != nil:
			// Tidak dinaikkan ke pemanggil. Folder privat memang GAGAL di sini,
			// dan itu keadaan normal yang punya jalan keluarnya sendiri di
			// bawah. Yang menentukan nasib permintaan ini adalah hasil jalur
			// OAuth, bukan hasil percobaan ini.
			log.Printf("[INFO] Folder %s tidak terbaca lewat API key, beralih ke OAuth: %v", sourceRef, err)

		case len(photos) == 0:
			// Daftar kosong TIDAK dipercaya. Folder privat yang dibaca dengan
			// API key bisa membalas 200 berisi nol berkas, tidak terbedakan
			// dari folder publik yang memang kosong. Memilih kepercayaan yang
			// salah di sini berarti folder privat tampil sebagai galeri kosong
			// tanpa pesan apa pun, padahal fotonya ada dan OAuth bisa
			// membacanya.
			//
			// Harganya satu percobaan OAuth yang mubazir untuk folder publik
			// yang sungguh-sungguh kosong. Galeri kosong bukan keadaan yang
			// sering ditemui, dan itu jauh lebih murah daripada salah diam.
			log.Printf("[INFO] Folder %s kosong lewat API key, memastikan lewat OAuth", sourceRef)

		default:
			return photos, nil
		}
	}

	store, err := s.storeOAuth(ctx)
	if err != nil {
		return nil, err
	}
	return store.ListPhotos(ctx, sourceRef)
}

// ThumbnailURL mengembalikan alamat thumbnail sebuah berkas.
//
// Kedua jalur sudah menaruh alamat yang benar di ThumbnailLink saat melisting —
// bentuk susunan sendiri untuk folder publik, bentuk dari Google untuk yang
// lewat OAuth — jadi di sini tidak ada lagi yang perlu dibedakan.
func (s *TieredStore) ThumbnailURL(ref PhotoRef) string {
	return ref.ThumbnailLink
}
