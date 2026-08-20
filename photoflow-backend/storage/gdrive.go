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
		log.Printf("[ERROR] Gagal mengosongkan refresh token user %s: %v", userID, err)
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
			log.Printf("[WARN] Gagal menyimpan refresh token baru user %s: %v", p.userID, err)
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

// baseThumbnailSize adalah sisi terpanjang yang disimpan di database.
//
// Yang tersimpan adalah ukuran DASAR; frontend menyesuaikannya sendiri lewat
// ubahUkuran() — s400/s800 untuk petak grid, s1600 untuk layar pratinjau.
const baseThumbnailSize = 400

// GDriveStore membaca foto dari sebuah folder Google Drive.
//
// Sebelumnya pembacaan folder memakai service account bersama, sehingga backend
// memegang satu kredensial yang bisa membaca folder milik siapa pun yang pernah
// membagikannya. Kredensialnya kini selalu terikat pada satu permintaan: entah
// izin milik fotografer sendiri, atau — untuk folder yang memang publik — API
// key yang tidak memberi akses ke apa pun yang tidak publik.
type GDriveStore struct {
	service *drive.Service

	// publik menandai bahwa folder dibaca lewat API key, yang hanya berhasil
	// kalau folder itu memang dibagikan ke publik. Yang bergantung padanya cuma
	// bentuk alamat thumbnail; lihat alasannya di ListPhotos.
	public bool
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

// NewPublicGDriveStore membangun store yang membaca folder publik memakai API
// key, tanpa OAuth sama sekali.
//
// API key tidak membuka apa pun yang tidak sudah publik, jadi ia tidak bisa
// menggantikan izin fotografer untuk folder privat. Yang dihapusnya adalah
// seluruh ongkos OAuth untuk kasus yang justru paling umum di PhotoFlow:
// fotografer menempel tautan folder yang memang sudah dibagikan ke kliennya.
//
// Tanpa OAuth berarti tanpa consent screen, tanpa refresh token yang
// kedaluwarsa tiap tujuh hari selama consent screen berstatus Testing, dan
// tanpa keharusan lolos penilaian keamanan CASA yang dituntut scope
// drive.readonly untuk naik ke Production.
func NewPublicGDriveStore(ctx context.Context) (*GDriveStore, error) {
	apiKey := os.Getenv("GOOGLE_API_KEY")
	if apiKey == "" {
		return nil, ErrAPIKeyNotConfigured
	}

	service, err := drive.NewService(ctx, option.WithAPIKey(apiKey))
	if err != nil {
		return nil, fmt.Errorf("gagal inisialisasi klien Drive publik: %w", err)
	}
	return &GDriveStore{service: service, public: true}, nil
}

// resolveThumbnailURL memilih bentuk alamat thumbnail yang disimpan.
//
// Kosong tetap kosong. Alamat susunan sendiri di bawah bisa dibuat untuk
// berkas apa pun, tapi membuatnya untuk berkas yang Drive sendiri tidak punya
// thumbnail-nya berarti menukar tanda "tidak ada thumbnail" yang sudah
// dipahami frontend dengan gambar rusak.
func resolveThumbnailURL(public bool, fileID, thumbnailLink string) string {
	if thumbnailLink == "" {
		return ""
	}

	if public {
		// Untuk folder publik alamatnya DISUSUN dari file ID, bukan diambil
		// dari thumbnailLink. Google mendokumentasikan thumbnailLink sebagai
		// alamat berumur pendek — hitungan jam — sedangkan galeri dilayani dari
		// salinan database yang bisa berumur berminggu-minggu. Bentuk ini
		// diturunkan dari ID berkas dan tidak punya masa berlaku, jadi galeri
		// lama tidak berubah jadi deretan gambar rusak.
		//
		// Hanya dapat dimuat peramban kalau berkasnya publik, dan di cabang ini
		// hal itu justru selalu benar.
		return fmt.Sprintf(
			"https://drive.google.com/thumbnail?id=%s&sz=w%d",
			fileID, baseThumbnailSize,
		)
	}

	// Jalur OAuth melayani folder yang mungkin privat, dan alamat susunan
	// sendiri tidak dapat dimuat untuk berkas privat. thumbnailLink dari Google
	// membawa izinnya sendiri, jadi di sini ia satu-satunya pilihan.
	//
	// Drive membatasi thumbnail-nya di "=s220", terlalu kecil untuk petak
	// galeri pada layar ber-DPR tinggi. Sebelumnya nilainya "=s1000", dipilih
	// supaya pratinjaunya cukup tajam, lalu alamat yang sama dipakai juga untuk
	// petak selebar 250-370px. Galeri 2.000 foto karena itu memindahkan sekitar
	// 140 MB — lebih besar daripada yang sanggup ditahan cache peramban,
	// sehingga menggulir jauh lalu kembali ke atas berarti mengunduh ulang
	// semuanya.
	return strings.Replace(
		thumbnailLink, "=s220", fmt.Sprintf("=s%d", baseThumbnailSize), -1,
	)
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
			// Tanpa dua parameter ini, Drive hanya melihat "My Drive" dan
			// mengabaikan seluruh isi Drive Bersama — bukan dengan error,
			// melainkan dengan daftar kosong. Fotografer yang menaruh
			// foldernya di Drive Bersama (lazim pada studio ber-Workspace)
			// karena itu melihat galeri nol foto tanpa satu pun petunjuk
			// mengapa, padahal foldernya jelas terbuka di peramban.
			//
			// supportsAllDrives memberi tahu Drive bahwa klien ini paham
			// Drive Bersama; includeItemsFromAllDrives yang benar-benar
			// memasukkan isinya ke hasil. Keduanya harus ada — yang pertama
			// saja tidak mengubah apa pun pada Files.List.
			SupportsAllDrives(true).
			IncludeItemsFromAllDrives(true).
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
			// webContentLink pernah ada di sini dan tidak pernah dibaca siapa
			// pun — tidak oleh galeri, tidak oleh dashboard, tidak oleh desktop
			// app — sementara ia ikut terkirim untuk SETIAP foto. Pada folder
			// 2.000 berkas itu 2.000 alamat mubazir di respons terbesar yang
			// dipunyai aplikasi ini.
			Fields("nextPageToken, files(id, name, mimeType, thumbnailLink, imageMediaMetadata(width, height))")
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
			thumbnail := resolveThumbnailURL(g.public, file.Id, file.ThumbnailLink)

			ref := PhotoRef{
				ID:            file.Id,
				Name:          file.Name,
				MimeType:      file.MimeType,
				ThumbnailLink: thumbnail,
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
