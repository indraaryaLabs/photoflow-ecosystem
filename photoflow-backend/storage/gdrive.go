package storage

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
	"gorm.io/gorm"

	"photoflow-backend/models"
)

// GetOAuthConfig mengembalikan konfigurasi OAuth2 Google untuk alur koneksi
// Google Drive user.
//
// Scope-nya drive.readonly, bukan drive penuh. Aplikasi ini hanya melisting
// folder dan membaca berkas; tidak pernah menulis, mengubah, atau menghapus.
// Scope penuh berarti satu refresh token yang bocor memberi penyerang
// kemampuan menghapus seluruh arsip foto milik fotografer, bukan sekadar
// membacanya.
//
// Perlu dicatat: refresh token yang SUDAH terbit tetap membawa scope lama.
// Mempersempit di sini hanya berlaku untuk otorisasi baru; izin yang sudah
// diberikan baru menyempit setelah user menyetujui ulang.
func GetOAuthConfig() *oauth2.Config {
	return &oauth2.Config{
		ClientID:     os.Getenv("GOOGLE_OAUTH_CLIENT_ID"),
		ClientSecret: os.Getenv("GOOGLE_OAUTH_CLIENT_SECRET"),
		RedirectURL:  os.Getenv("GOOGLE_OAUTH_REDIRECT_URL"),
		Scopes:       []string{drive.DriveReadonlyScope},
		Endpoint:     google.Endpoint,
	}
}

// isInvalidGrant melaporkan apakah Google menolak refresh token yang dipakai.
//
// invalid_grant berarti izinnya pernah ada tapi sudah tidak berlaku: user
// mencabutnya, password akun berubah, atau — kalau consent screen masih dalam
// status Testing — refresh token kedaluwarsa setelah tujuh hari. Membedakannya
// dari kegagalan jaringan biasa penting, karena hanya kasus ini yang menuntut
// user menghubungkan ulang.
func isInvalidGrant(err error) bool {
	var retrieveErr *oauth2.RetrieveError
	if errors.As(err, &retrieveErr) {
		if retrieveErr.ErrorCode == "invalid_grant" {
			return true
		}
		// Sebagian respons Google tidak mengisi ErrorCode; periksa body mentahnya.
		return strings.Contains(string(retrieveErr.Body), "invalid_grant")
	}
	return false
}

// clearRefreshToken menandai user sebagai perlu menghubungkan ulang Drive
// dengan mengosongkan refresh token yang sudah tidak berlaku.
//
// Token yang ditolak tidak akan berlaku lagi, jadi menyimpannya hanya membuat
// setiap permintaan berikutnya menempuh perjalanan bolak-balik ke Google untuk
// mendapatkan penolakan yang sama. Kolom yang kosong adalah penanda "belum
// terhubung" yang sudah dipahami seluruh kode ini.
func clearRefreshToken(db *gorm.DB, userID string) {
	if err := db.Model(&models.Profile{}).
		Where("id = ?", userID).
		Update("gdrive_refresh_token", "").Error; err != nil {
		log.Printf("🔴 Gagal mengosongkan refresh token user %s: %v", userID, err)
	}
}

// persistingTokenSource menyimpan refresh token baru setiap kali Google
// mengirimkannya.
//
// Google kadang menerbitkan refresh token pengganti saat access token
// disegarkan. Tanpa menyimpannya, koneksi akan mati diam-diam di kemudian hari
// ketika token lama akhirnya ditolak.
type persistingTokenSource struct {
	base    oauth2.TokenSource
	db      *gorm.DB
	userID  string
	current string
}

func (p *persistingTokenSource) Token() (*oauth2.Token, error) {
	token, err := p.base.Token()
	if err != nil {
		if isInvalidGrant(err) {
			clearRefreshToken(p.db, p.userID)
			return nil, ErrDriveReconnectRequired
		}
		return nil, fmt.Errorf("gagal menyegarkan access token: %w", err)
	}

	if token.RefreshToken != "" && token.RefreshToken != p.current {
		if err := p.db.Model(&models.Profile{}).
			Where("id = ?", p.userID).
			Update("gdrive_refresh_token", token.RefreshToken).Error; err != nil {
			// Bukan alasan menggagalkan permintaan: access token yang baru
			// didapat tetap sah dan bisa dipakai sekarang.
			log.Printf("⚠️ Gagal menyimpan refresh token baru user %s: %v", p.userID, err)
		} else {
			p.current = token.RefreshToken
		}
	}
	return token, nil
}

// TokenSourceForUser membangun sumber access token dari refresh token milik
// user. Mengembalikan ErrDriveNotConnected kalau user belum pernah
// menghubungkan Drive.
func TokenSourceForUser(ctx context.Context, db *gorm.DB, userID string) (oauth2.TokenSource, error) {
	var profile models.Profile
	if err := db.Where("id = ?", userID).First(&profile).Error; err != nil {
		return nil, fmt.Errorf("gagal mengambil profil user: %w", err)
	}
	if profile.GdriveRefreshToken == "" {
		return nil, ErrDriveNotConnected
	}

	base := GetOAuthConfig().TokenSource(ctx, &oauth2.Token{
		RefreshToken: profile.GdriveRefreshToken,
	})
	return &persistingTokenSource{
		base:    base,
		db:      db,
		userID:  userID,
		current: profile.GdriveRefreshToken,
	}, nil
}

// GetUserAccessToken menghasilkan access token Drive milik user, untuk dipakai
// desktop app.
func GetUserAccessToken(ctx context.Context, db *gorm.DB, userID string) (*oauth2.Token, error) {
	source, err := TokenSourceForUser(ctx, db, userID)
	if err != nil {
		return nil, err
	}
	return source.Token()
}

// GDriveStore membaca foto dari Google Drive memakai kredensial OAuth milik
// satu user.
//
// Sebelumnya pembacaan folder memakai service account bersama, sehingga backend
// memegang satu kredensial yang bisa membaca folder milik siapa pun yang pernah
// membagikannya. Sekarang tiap fotografer memakai izinnya sendiri, dan token
// yang bocor tidak membuka Drive orang lain.
type GDriveStore struct {
	service *drive.Service
}

// NewGDriveStoreForUser membangun store yang memakai kredensial user tertentu.
func NewGDriveStoreForUser(ctx context.Context, db *gorm.DB, userID string) (*GDriveStore, error) {
	source, err := TokenSourceForUser(ctx, db, userID)
	if err != nil {
		return nil, err
	}

	service, err := drive.NewService(ctx, option.WithTokenSource(source))
	if err != nil {
		return nil, fmt.Errorf("gagal inisialisasi klien Drive: %w", err)
	}
	return &GDriveStore{service: service}, nil
}

// ListPhotos membaca isi folder Drive, termasuk format RAW.
func (g *GDriveStore) ListPhotos(ctx context.Context, sourceRef string) ([]PhotoRef, error) {
	query := fmt.Sprintf("'%s' in parents and trashed = false", sourceRef)

	var result []PhotoRef
	pageToken := ""
	for {
		req := g.service.Files.List().
			Context(ctx).
			Q(query).
			// Tanpa orderBy, Drive mengembalikan berkas dalam urutan yang tidak
			// dijanjikan apa pun. Akibatnya galeri klien tampil teracak, dan
			// fotografer tidak bisa merujuk "foto ke-12" karena nomor itu
			// berbeda di layarnya sendiri.
			//
			// name_natural, bukan name: pengurutan biasa menaruh IMG_10 sebelum
			// IMG_9 karena membandingkan huruf per huruf. Nama berkas kamera
			// selalu bernomor, jadi perbedaan itu terasa di setiap galeri.
			OrderBy("name_natural").
			// Bawaan Drive 100 berkas per halaman. Galeri pernikahan berisi
			// ribuan foto, dan seluruh penelusuran terjadi di dalam SATU
			// permintaan serverless yang punya batas waktu. 1000 adalah
			// maksimum yang diterima API, dan memangkas jumlah perjalanan
			// jaringan sepuluh kali lipat.
			PageSize(1000).
			Fields("nextPageToken, files(id, name, mimeType, thumbnailLink, webContentLink, imageMediaMetadata(width, height))")
		if pageToken != "" {
			req = req.PageToken(pageToken)
		}

		page, err := req.Do()
		if err != nil {
			// Penyegaran token terjadi di dalam panggilan ini, jadi kesalahan
			// yang menuntut koneksi ulang muncul di sini dan harus diteruskan
			// apa adanya supaya pemanggil bisa membedakannya.
			if errors.Is(err, ErrDriveReconnectRequired) {
				return nil, ErrDriveReconnectRequired
			}
			if isInvalidGrant(err) {
				return nil, ErrDriveReconnectRequired
			}
			return nil, fmt.Errorf("gagal membaca folder Google Drive: %w", err)
		}

		for _, file := range page.Files {
			if !isImage(file.Name, file.MimeType) {
				continue
			}
			thumbnail := file.ThumbnailLink
			if thumbnail != "" {
				// Hack arsitektur web untuk membaca file RAW kualitas tinggi di
				// frontend: hapus batasan "=s220" menjadi "=s1000" agar
				// resolusi mencapai 1000px.
				thumbnail = strings.Replace(thumbnail, "=s220", "=s1000", -1)
			}

			ref := PhotoRef{
				ID:             file.Id,
				Name:           file.Name,
				MimeType:       file.MimeType,
				ThumbnailLink:  thumbnail,
				WebContentLink: file.WebContentLink,
			}
			// Tidak semua berkas membawanya: Drive mengisi imageMediaMetadata
			// hanya untuk format yang dikenalinya, dan sebagian RAW tidak
			// termasuk.
			if m := file.ImageMediaMetadata; m != nil {
				ref.Width = int(m.Width)
				ref.Height = int(m.Height)
			}
			result = append(result, ref)
		}

		pageToken = page.NextPageToken
		if pageToken == "" {
			break
		}
	}
	return result, nil
}

// ThumbnailURL mengembalikan URL thumbnail berkas.
func (g *GDriveStore) ThumbnailURL(ref PhotoRef) string {
	return ref.ThumbnailLink
}
