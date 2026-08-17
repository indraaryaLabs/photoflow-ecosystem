// Package models berisi struct yang dipetakan ke tabel database dan struct
// input yang diikat dari body request. Paket ini sengaja tidak memuat logika:
// isinya hanya bentuk data, sehingga bisa dipakai handler, middleware, maupun
// perintah migrasi tanpa menyeret ketergantungan lain.
package models

import "time"

type Project struct {
	ID             string `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	UserID         string `gorm:"type:uuid" json:"user_id"`
	ProjectName    string `gorm:"type:text;not null" json:"project_name"`
	ClientName     string `gorm:"type:text;not null" json:"client_name"`
	MaxSelections  int    `gorm:"default:50" json:"max_selections"`
	DriveFolderURL string `gorm:"type:text;not null" json:"drive_folder_url"`
	DriveFolderID  string `gorm:"type:text;not null" json:"drive_folder_id"`
	MagicLinkToken string `gorm:"type:text;unique;not null" json:"magic_link_token"`
	AdminWhatsApp  string `gorm:"type:text" json:"admin_whatsapp"`
	ClientWhatsApp string `gorm:"type:text" json:"client_whatsapp"`
	Status         string `gorm:"type:text;default:'pending'" json:"status"`
	// Kapan klien mengirim pilihannya. nil selama masih terbuka.
	//
	// Tanpa ini dashboard tidak bisa membedakan kiriman satu jam lalu dari
	// kiriman bulan lalu, dan fotografer tidak punya cara tahu mana yang baru
	// selain mengingat sendiri isi daftarnya.
	SubmittedAt *time.Time `gorm:"column:submitted_at" json:"submitted_at"`
	// Kapan galerinya PERTAMA KALI dibuka. nil berarti belum pernah.
	//
	// Sebelum ini sebuah project yang menganggur hanya punya satu penjelasan
	// di layar: "menunggu klien". Padahal ada dua, dan tindakannya berlawanan.
	// Kalau tautannya belum pernah dibuka, yang salah pengirimannya — nomornya
	// keliru, pesannya tenggelam, tautannya tidak pernah sampai. Kalau sudah
	// dibuka dan tetap sepi, yang perlu ditagih orangnya. Tanpa kolom ini
	// fotografer menebak, dan tebakan yang salah berarti mengirim ulang
	// tautan kepada orang yang sudah memegangnya.
	//
	// Hanya waktu pertama yang disimpan, bukan yang terakhir: yang hendak
	// dijawab "sudah sampai atau belum", bukan seberapa sering dilihat.
	FirstViewedAt *time.Time `gorm:"column:first_viewed_at" json:"first_viewed_at"`
	CreatedAt     time.Time  `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt     time.Time  `gorm:"autoUpdateTime" json:"updated_at"`
}

type Photo struct {
	ID           string    `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	ProjectID    string    `gorm:"type:uuid;not null" json:"project_id"`
	FileName     string    `gorm:"type:text;not null" json:"file_name"`
	ThumbnailURL string    `gorm:"type:text;not null" json:"thumbnail_url"`
	IsSelected   bool      `gorm:"default:false" json:"is_selected"`
	CreatedAt    time.Time `gorm:"autoCreateTime" json:"created_at"`
}

// Profile memetakan tabel public.profiles. Barisnya dibuat oleh trigger
// handle_new_user() saat user mendaftar, bukan oleh backend ini.
type Profile struct {
	ID                 string `gorm:"type:uuid;primaryKey" json:"id"`
	GdriveRefreshToken string `gorm:"column:gdrive_refresh_token;type:text" json:"gdrive_refresh_token"`
}

func (Profile) TableName() string {
	return "profiles"
}

// RateLimit adalah satu penghitung fixed-window. Satu baris per bucket, bukan
// satu baris per request, sehingga tabel tumbuh sebesar jumlah IP unik dan
// bukan sebesar jumlah trafik.
//
// Penghitung sengaja disimpan di Postgres, bukan di memori proses. Backend ini
// berjalan sebagai fungsi serverless: memori tidak bertahan antar invocation
// dan beberapa instance berjalan berdampingan, jadi penghitung in-memory bukan
// hanya tidak persisten — ia memberi kesan terlindungi sambil praktis tidak
// menahan apa pun.
type RateLimit struct {
	BucketKey   string    `gorm:"column:bucket_key;type:text;primaryKey"`
	WindowStart time.Time `gorm:"column:window_start;not null;index"`
	HitCount    int       `gorm:"column:hit_count;not null"`
}

func (RateLimit) TableName() string {
	return "rate_limits"
}

// OAuthState adalah satu permintaan koneksi Google Drive yang sedang berjalan.
//
// Parameter `state` OAuth dulunya berisi user_id mentah dari query string,
// sehingga penyerang yang tahu user_id korban bisa membuka alur koneksi atas
// nama korban, menyetujuinya dengan akun Google miliknya sendiri, dan refresh
// token miliknya tersimpan di profil korban. Sekarang `state` adalah nilai acak
// yang tidak dapat ditebak, dan pemetaan state ke user disimpan di sini —
// bukan dititipkan ke pihak yang sedang diautentikasi.
//
// Disimpan di Postgres, bukan memori proses, karena backend berjalan sebagai
// fungsi serverless: permintaan yang memulai alur dan callback yang
// menyelesaikannya hampir pasti dilayani instance berbeda.
type OAuthState struct {
	State  string `gorm:"column:state;type:text;primaryKey"`
	UserID string `gorm:"column:user_id;type:uuid;not null"`
	// Ke mana user dikembalikan setelah menyetujui di Google. Kosong untuk
	// aplikasi desktop, yang tidak punya halaman untuk dituju.
	ReturnTo  string    `gorm:"column:return_to;type:text"`
	ExpiresAt time.Time `gorm:"column:expires_at;not null;index"`
	CreatedAt time.Time `gorm:"autoCreateTime"`
}

func (OAuthState) TableName() string {
	return "oauth_states"
}

// StatusSubmitted adalah status project setelah klien mengirim pilihannya.
// Setelah itu galeri terkunci dan tidak menerima submit lagi.
const StatusSubmitted = "submitted"

// StatusPending adalah keadaan awal sebuah project: galeri masih terbuka dan
// klien masih boleh mengubah pilihannya.
//
// Sampai sebelum ini nilainya hanya hidup sebagai `default:'pending'` di tag
// kolom, tanpa nama yang bisa dirujuk kode. Itu cukup selama satu-satunya
// perpindahan status adalah pending menuju submitted; sejak ada jalan pulang
// (ReopenSelection), kedua ujungnya perlu sama-sama punya nama.
const StatusPending = "pending"

// GalleryProject adalah bentuk project yang boleh dilihat klien.
//
// Sebelumnya GetGallery mengembalikan baris Project apa adanya. Rute itu
// publik — cukup memegang magic link — sehingga seluruh kolomnya ikut terbaca:
// `user_id`, `drive_folder_id`, `magic_link_token`, dan `client_whats_app`.
// Nomor WhatsApp klien adalah nomor orang lain yang tidak dibutuhkan halaman
// galeri sama sekali, dan `drive_folder_id` menunjuk folder Drive fotografer.
//
// Struct ini memuat persis lima nilai yang benar-benar dipakai halaman galeri.
// Kolom baru pada Project karena itu tidak lagi bocor dengan sendirinya:
// menampakkannya harus jadi keputusan yang ditulis di sini.
//
// AdminWhatsApp memang sengaja ada. Setelah mengirim pilihan, klien diberi
// tombol untuk mengabari fotografernya lewat WhatsApp, dan nomor itulah
// tujuannya. Yang memegang magic link adalah klien yang memang sudah
// berhubungan dengan fotografer tersebut.
type GalleryProject struct {
	ProjectName   string `json:"project_name"`
	ClientName    string `json:"client_name"`
	MaxSelections int    `json:"max_selections"`
	Status        string `json:"status"`
	AdminWhatsApp string `json:"admin_whatsapp"`
}

// NewGalleryProject menyalin hanya kolom yang boleh dilihat klien.
func NewGalleryProject(p Project) GalleryProject {
	return GalleryProject{
		ProjectName:   p.ProjectName,
		ClientName:    p.ClientName,
		MaxSelections: p.MaxSelections,
		Status:        p.Status,
		AdminWhatsApp: p.AdminWhatsApp,
	}
}

// GalleryPhoto adalah satu foto pada salinan yang tersimpan di database.
// Dipakai galeri klien saat Drive tidak terbaca.
type GalleryPhoto struct {
	ID           string `json:"id"`
	FileName     string `json:"file_name"`
	ThumbnailURL string `json:"thumbnail_url"`
}

// NewGalleryPhotos menyalin daftar foto ke bentuk yang aman ditampilkan.
// IsSelected sengaja tidak ikut: pada galeri yang belum disubmit nilainya
// selalu false, dan pada yang sudah disubmit ia membocorkan pilihan klien
// kepada siapa pun yang membuka tautannya.
func NewGalleryPhotos(photos []Photo) []GalleryPhoto {
	out := make([]GalleryPhoto, 0, len(photos))
	for _, p := range photos {
		out = append(out, GalleryPhoto{
			ID:           p.ID,
			FileName:     p.FileName,
			ThumbnailURL: p.ThumbnailURL,
		})
	}
	return out
}

// CreateProjectInput dibatasi panjangnya di tingkat binding supaya nilai yang
// tidak masuk akal ditolak sebelum menyentuh database. MaxSelections memakai
// omitempty karena nilai 0 berarti "pakai default", bukan nilai di luar batas.
type CreateProjectInput struct {
	ProjectName    string `json:"project_name" binding:"required,max=200"`
	ClientName     string `json:"client_name" binding:"required,max=200"`
	MaxSelections  int    `json:"max_selections" binding:"omitempty,min=1,max=1000"`
	DriveFolderURL string `json:"drive_folder_url" binding:"required,max=500"`
	AdminWhatsApp  string `json:"admin_whatsapp" binding:"omitempty,min=10,max=15,numeric"`
	ClientWhatsApp string `json:"client_whatsapp" binding:"omitempty,min=10,max=15,numeric"`
}

// SelectedPhotoInput adalah satu foto dalam kiriman pilihan klien.
type SelectedPhotoInput struct {
	DriveID  string `json:"drive_id" binding:"max=200"`
	FileName string `json:"file_name" binding:"max=500"`
}

// SubmitSelectionInput adalah body dari POST /api/p/:magic_link/submit.
//
// Sebelumnya struct ini dideklarasikan inline di dalam closure handler dan
// karenanya tidak bisa dirujuk dari berkas tes, sehingga tesnya terpaksa
// menguji salinan yang bisa menyimpang tanpa ketahuan. Diangkat jadi tipe
// bernama supaya tes mengikat struct yang benar-benar dipakai.
//
// Batas jumlah elemen adalah yang paling penting di sini: tanpa itu, satu
// request bisa memerintahkan insert sebanyak apa pun. Perlu dicatat bahwa
// `required` pada slice TIDAK menolak array kosong; penolakannya ada di handler.
type SubmitSelectionInput struct {
	SelectedPhotos []SelectedPhotoInput `json:"selected_photos" binding:"required,max=5000,dive"`
}

// DriveAPIResponse adalah bentuk respons Google Drive API yang dipakai backend.
type DriveAPIResponse struct {
	Files []struct {
		ID            string `json:"id"`
		Name          string `json:"name"`
		ThumbnailLink string `json:"thumbnailLink"`
	} `json:"files"`
}
