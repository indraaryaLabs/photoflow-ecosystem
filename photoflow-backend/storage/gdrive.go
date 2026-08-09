package storage

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
	"gorm.io/gorm"
)

// GetOAuthConfig mengembalikan konfigurasi OAuth2 Google untuk alur koneksi Google Drive user.
// Berbeda dengan Service Account, ini menggunakan OAuth2 Client Credentials (consent dari user).
func GetOAuthConfig() *oauth2.Config {
	return &oauth2.Config{
		ClientID:     os.Getenv("GOOGLE_OAUTH_CLIENT_ID"),
		ClientSecret: os.Getenv("GOOGLE_OAUTH_CLIENT_SECRET"),
		RedirectURL:  os.Getenv("GOOGLE_OAUTH_REDIRECT_URL"),
		Scopes:       []string{drive.DriveScope},
		Endpoint:     google.Endpoint,
	}
}

// GetUserAccessToken menghasilkan OAuth2 Access Token dari Refresh Token milik user.
// Refresh Token diambil dari tabel `profiles` berdasarkan userID.
func GetUserAccessToken(userID string, db *gorm.DB) (string, time.Time, error) {
	// Query refresh token dari tabel profiles
	var profile struct {
		GdriveRefreshToken string `gorm:"column:gdrive_refresh_token"`
	}
	if err := db.Table("profiles").Select("gdrive_refresh_token").Where("id = ?", userID).First(&profile).Error; err != nil {
		return "", time.Time{}, fmt.Errorf("gagal mengambil profil user: %v", err)
	}

	if profile.GdriveRefreshToken == "" {
		return "", time.Time{}, fmt.Errorf("user belum login Google Drive")
	}

	// Gunakan OAuth2 Config + Refresh Token untuk mendapatkan Access Token fresh
	oauthConfig := GetOAuthConfig()
	tokenSource := oauthConfig.TokenSource(context.Background(), &oauth2.Token{
		RefreshToken: profile.GdriveRefreshToken,
	})

	token, err := tokenSource.Token()
	if err != nil {
		return "", time.Time{}, fmt.Errorf("gagal me-refresh access token: %v", err)
	}

	return token.AccessToken, token.Expiry, nil
}

type DriveFile struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	MimeType       string `json:"mimeType"`
	ThumbnailLink  string `json:"thumbnailLink"`
	WebContentLink string `json:"webContentLink"`
}

// GetImagesFromFolder membaca resource folder dari Google Drive, termasuk file Standard Image dan Format RAW
func GetImagesFromFolder(folderID string) ([]DriveFile, error) {
	ctx := context.Background()

	credsJSON := os.Getenv("GDRIVE_CREDENTIALS_JSON")
	if credsJSON == "" {
		return nil, fmt.Errorf("GDRIVE_CREDENTIALS_JSON env var is missing")
	}

	srv, err := drive.NewService(ctx, option.WithCredentialsJSON([]byte(credsJSON)))
	if err != nil {
		return nil, fmt.Errorf("gagal inisialisasi GDrive client: %v", err)
	}

	query := fmt.Sprintf("'%s' in parents and trashed = false", folderID)

	var result []DriveFile

	validExtensions := map[string]bool{
		"jpg": true, "jpeg": true, "png": true, "webp": true, // web standard
		"cr2": true, "nef": true, "arw": true, "dng": true, "raw": true, "orf": true, "rw2": true, // RAW format professional
	}

	pageToken := ""
	for {
		req := srv.Files.List().
			Q(query).
			Fields("nextPageToken, files(id, name, mimeType, thumbnailLink, webContentLink)")

		if pageToken != "" {
			req = req.PageToken(pageToken)
		}

		r, err := req.Do()
		if err != nil {
			return nil, fmt.Errorf("gagal membaca files dari Google Drive: %v", err)
		}

		for _, f := range r.Files {
			parts := strings.Split(strings.ToLower(f.Name), ".")
			if len(parts) > 1 {
				ext := parts[len(parts)-1]
				isImageMime := strings.HasPrefix(f.MimeType, "image/")

				// Memastikan file adalah format gambar yg di-support (browser maupun RAW)
				if validExtensions[ext] || isImageMime {
					thumbnail := f.ThumbnailLink
					if thumbnail != "" {
						// Hack arsitektur web untuk membaca file RAW kualitas tinggi di frontend:
						// Hapus batasan "=s220" menjadi "=s1000" agar resolusi mencapai 1000px
						thumbnail = strings.Replace(thumbnail, "=s220", "=s1000", -1)
					}

					result = append(result, DriveFile{
						ID:             f.Id,
						Name:           f.Name,
						MimeType:       f.MimeType,
						ThumbnailLink:  thumbnail,
						WebContentLink: f.WebContentLink,
					})
				}
			}
		}

		pageToken = r.NextPageToken
		if pageToken == "" {
			break
		}
	}

	return result, nil
}
