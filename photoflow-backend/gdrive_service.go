package main

import (
	"context"
	"fmt"
	"strings"

	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
)

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

	srv, err := drive.NewService(ctx, option.WithCredentialsFile("gdrive-key.json"))
	if err != nil {
		return nil, fmt.Errorf("gagal inisialisasi GDrive client: %v", err)
	}

	query := fmt.Sprintf("'%s' in parents and trashed = false", folderID)
	r, err := srv.Files.List().
		Q(query).
		Fields("files(id, name, mimeType, thumbnailLink, webContentLink)").
		Do()
	if err != nil {
		return nil, fmt.Errorf("gagal membaca files dari Google Drive: %v", err)
	}

	var result []DriveFile

	validExtensions := map[string]bool{
		"jpg": true, "jpeg": true, "png": true, "webp": true, // web standard
		"cr2": true, "nef": true, "arw": true, "dng": true, "raw": true, "orf": true, "rw2": true, // RAW format professional
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

	return result, nil
}
