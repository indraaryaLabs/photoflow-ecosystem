package app

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"golang.org/x/oauth2"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"photoflow-backend/middleware"
)

// --- MODEL DATABASE ---
type Project struct {
	ID              string    `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	UserID          string    `gorm:"type:uuid" json:"user_id"`
	ProjectName     string    `gorm:"type:text;not null" json:"project_name"`
	ClientName      string    `gorm:"type:text;not null" json:"client_name"`
	MaxSelections   int       `gorm:"default:50" json:"max_selections"`
	DriveFolderURL  string    `gorm:"type:text;not null" json:"drive_folder_url"`
	DriveFolderID   string    `gorm:"type:text;not null" json:"drive_folder_id"`
	MagicLinkToken  string    `gorm:"type:text;unique;not null" json:"magic_link_token"`
	AdminWhatsApp   string    `gorm:"type:text" json:"admin_whatsapp"`
	ClientWhatsApp  string    `gorm:"type:text" json:"client_whatsapp"`
	Status          string    `gorm:"type:text;default:'pending'" json:"status"`
	CreatedAt       time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt       time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

type Photo struct {
	ID           string    `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	ProjectID    string    `gorm:"type:uuid;not null" json:"project_id"`
	FileName     string    `gorm:"type:text;not null" json:"file_name"`
	ThumbnailURL string    `gorm:"type:text;not null" json:"thumbnail_url"`
	IsSelected   bool      `gorm:"default:false" json:"is_selected"`
	CreatedAt    time.Time `gorm:"autoCreateTime" json:"created_at"`
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

type DriveAPIResponse struct {
	Files []struct {
		ID            string `json:"id"`
		Name          string `json:"name"`
		ThumbnailLink string `json:"thumbnailLink"`
	} `json:"files"`
}

// --- MODEL PROFILES (TABEL public.profiles) ---
type Profile struct {
	ID                 string `gorm:"type:uuid;primaryKey" json:"id"`
	GdriveRefreshToken string `gorm:"column:gdrive_refresh_token;type:text" json:"gdrive_refresh_token"`
}

func (Profile) TableName() string {
	return "profiles"
}

func extractDriveFolderID(url string) string {
	re := regexp.MustCompile(`[-\w]{25,}`)
	matches := re.FindString(url)
	return matches
}

// magicLinkBytes menentukan entropi token galeri. Nilai lama 4 byte hanya
// memberi 2^32 kemungkinan — cukup kecil untuk dienumerasi, dan cukup kecil pula
// untuk bertabrakan pada kolom unique. 16 byte menaikkannya ke 2^128.
//
// Token yang sudah terlanjur dibuat tetap berlaku: pencarian memakai
// perbandingan nilai pada kolom text, tanpa asumsi panjang di mana pun.
const magicLinkBytes = 16

// generateMagicLink membangkitkan token galeri yang tidak dapat ditebak.
//
// Catatan: sejak Go 1.24 crypto/rand.Read tidak pernah mengembalikan error — ia
// menjatuhkan proses kalau sumber acak sistem gagal. Error tetap diteruskan di
// sini supaya kegagalan itu eksplisit dan tidak bergantung pada janji versi Go
// tertentu, bukan karena ada jalur kegagalan yang diam-diam menghasilkan token
// lemah.
func generateMagicLink() (string, error) {
	buf := make([]byte, magicLinkBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("gagal membangkitkan magic link: %w", err)
	}
	return hex.EncodeToString(buf), nil
}

func CORSMiddleware() gin.HandlerFunc {
	// Daftar origin yang diizinkan (Production + Local Dev)
	allowedOrigins := map[string]bool{
		"https://photoflow-ecosystem.vercel.app": true,
		"http://localhost:5173":                  true, // Vite dev server
	}

	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")

		if allowedOrigins[origin] {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
		}

		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With, ngrok-skip-browser-warning")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE, PATCH")
		c.Writer.Header().Set("Vary", "Origin")

		// Tangani Preflight Request
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}

func SetupRouter() *gin.Engine {
	godotenv.Load()

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("🔴 FATAL: DATABASE_URL KOSONG! Vercel gagal membaca Environment Variable.")
	}
	// ----------------------------------

	db, err := gorm.Open(postgres.New(postgres.Config{
		DSN:                  dsn,
		PreferSimpleProtocol: true,
	}), &gorm.Config{})

	if err != nil {
		log.Fatal("🔴 Gagal terhubung ke database:", err)
	}

	fmt.Println("🚀 Database Terkoneksi!")

	// Verifier JWT Supabase. Konfigurasi yang salah dihentikan di sini supaya
	// server tidak pernah menyala dengan rute admin yang tidak terlindungi.
	authVerifier, err := middleware.NewVerifier(os.Getenv("SUPABASE_URL"))
	if err != nil {
		log.Fatal("🔴 FATAL: Konfigurasi auth tidak valid: ", err)
	}
	requireAuth := authVerifier.RequireAuth()

	db.AutoMigrate(&Project{}, &Photo{}, &middleware.RateLimit{})

	// Batas percobaan gagal pada pencarian magic link. Ini lapis kedua: yang
	// benar-benar membuat token tidak dapat ditebak adalah entropinya, dan
	// pembatasan per IP tetap bisa dilewati penyerang yang punya banyak IP.
	magicLinkLimiter := middleware.NewLimiter(db, 10*time.Minute, 20)

	// Pastikan kolom gdrive_refresh_token ada di tabel profiles
	db.Exec("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS gdrive_refresh_token TEXT")

	// Inisialisasi OAuth2 Config
	oauthConfig := GetOAuthConfig()

	r := gin.Default()

	// Jangan percayai header proxy secara otomatis. Penentuan IP klien untuk
	// rate limiting dilakukan eksplisit di middleware.Limiter, dari header yang
	// diset platform saja.
	if err := r.SetTrustedProxies(nil); err != nil {
		log.Fatal("🔴 FATAL: Gagal menyetel trusted proxies: ", err)
	}

	r.GET("/", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"message": "PhotoFlow API is running perfectly! 🚀"})
	})
	// --- MIDDLEWARE CORS ---
	r.Use(CORSMiddleware())

	// Batas ukuran body. Dipasang global; rute tanpa body tidak terpengaruh.
	r.Use(middleware.MaxBodySize(1 << 20))

	// Diagnostik untuk membuktikan header sumber IP di lingkungan nyata.
	// Mengembalikan 404 kecuali DEBUG_CLIENT_IP=1.
	r.GET("/api/debug/client-ip", magicLinkLimiter.DebugClientIP)

	// --- AUTH: GOOGLE OAUTH2 LOGIN ---
	r.GET("/api/auth/google/login", func(c *gin.Context) {
		userID := c.Query("user_id")
		if userID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "user_id wajib disertakan sebagai query parameter"})
			return
		}

		// Encode user_id ke dalam state agar bisa diambil kembali di callback
		state := userID

		// Generate URL OAuth Google dengan prompt select_account + consent & access_type offline
		// select_account = paksa pilih akun (Fast Account Switching)
		// consent = paksa consent screen agar Google selalu memberikan Refresh Token
		url := oauthConfig.AuthCodeURL(state,
			oauth2.AccessTypeOffline,
			oauth2.SetAuthURLParam("prompt", "select_account consent"),
		)

		c.Redirect(http.StatusTemporaryRedirect, url)
	})

	// --- AUTH: GOOGLE OAUTH2 CALLBACK ---
	r.GET("/api/auth/google/callback", func(c *gin.Context) {
		// Ambil authorization code & state (user_id) dari Google
		code := c.Query("code")
		state := c.Query("state") // berisi user_id

		if code == "" {
			c.String(http.StatusBadRequest, "Authorization code tidak ditemukan.")
			return
		}

		if state == "" {
			c.String(http.StatusBadRequest, "State (user_id) tidak valid.")
			return
		}

		userID := state

		// Tukar authorization code menjadi Access Token + Refresh Token
		token, err := oauthConfig.Exchange(c.Request.Context(), code)
		if err != nil {
			log.Printf("🔴 OAuth Exchange Error: %v", err)
			c.String(http.StatusInternalServerError, "Gagal menukar authorization code: %v", err)
			return
		}

		refreshToken := token.RefreshToken

		// Safety: Jika Google tidak memberikan refresh_token (edge case),
		// biarkan token lama di database tetap utuh, jangan overwrite dengan string kosong.
		if refreshToken == "" {
			log.Printf("⚠️ Refresh Token kosong untuk user %s. Token lama dipertahankan.", userID)
		} else {
			// Simpan Refresh Token ke tabel profiles berdasarkan user_id
			result := db.Model(&Profile{}).Where("id = ?", userID).Update("gdrive_refresh_token", refreshToken)
			if result.Error != nil {
				log.Printf("🔴 DB Update Error: %v", result.Error)
				c.String(http.StatusInternalServerError, "Gagal menyimpan refresh token ke database.")
				return
			}

			if result.RowsAffected == 0 {
				c.String(http.StatusNotFound, "Profile dengan user_id tersebut tidak ditemukan.")
				return
			}

			log.Printf("✅ Refresh Token berhasil disimpan untuk user: %s", userID)
		}

		// Tampilkan halaman sukses sederhana
		c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(`
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PhotoFlow - Koneksi Berhasil</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #0f0f23 0%, #1a1a3e 50%, #0f0f23 100%);
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            color: #e0e0e0;
        }
        .card {
            background: rgba(255,255,255,0.05);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 24px;
            padding: 48px;
            text-align: center;
            max-width: 480px;
            box-shadow: 0 25px 60px rgba(0,0,0,0.5);
        }
        .icon { font-size: 64px; margin-bottom: 24px; }
        h1 {
            font-size: 24px;
            font-weight: 700;
            color: #ffffff;
            margin-bottom: 12px;
        }
        p {
            font-size: 16px;
            line-height: 1.6;
            color: #a0a0b8;
        }
        .highlight { color: #6ee7b7; font-weight: 600; }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">✅</div>
        <h1>Koneksi Google Drive Berhasil!</h1>
        <p>Akun Google Anda telah terhubung dengan <span class="highlight">PhotoFlow</span>.</p>
        <p style="margin-top: 16px;">Silakan kembali ke aplikasi PhotoFlow dan lanjutkan pekerjaan Anda.</p>
    </div>
</body>
</html>
		`))
	})

	// --- 1. RUTE CREATE PROJECT ---
	r.POST("/api/projects", requireAuth, func(c *gin.Context) {
		userID := c.GetString(middleware.ContextUserIDKey)

		var input CreateProjectInput
		if err := c.ShouldBindJSON(&input); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Input tidak valid"})
			return
		}

		folderID := extractDriveFolderID(input.DriveFolderURL)
		if folderID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Link Google Drive tidak valid"})
			return
		}

		magicLink, err := generateMagicLink()
		if err != nil {
			log.Printf("🔴 %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal membuat project"})
			return
		}

		newProject := Project{
			ProjectName:    input.ProjectName,
			ClientName:     input.ClientName,
			MaxSelections:  input.MaxSelections,
			DriveFolderURL: input.DriveFolderURL,
			DriveFolderID:  folderID,
			UserID:         userID,
			AdminWhatsApp:  input.AdminWhatsApp,
			ClientWhatsApp: input.ClientWhatsApp,
			MagicLinkToken: magicLink,
		}
		if newProject.MaxSelections == 0 {
			newProject.MaxSelections = 50
		}

		if err := db.Create(&newProject).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal menyimpan project"})
			return
		}

		apiKey := os.Getenv("GOOGLE_API_KEY")
		driveAPIUrl := fmt.Sprintf("https://www.googleapis.com/drive/v3/files?q='%s'+in+parents+and+mimeType+contains+'image/'&fields=files(id,name,thumbnailLink)&key=%s", folderID, apiKey)

		resp, err := http.Get(driveAPIUrl)
		if err != nil || resp.StatusCode != 200 {
			c.JSON(http.StatusCreated, gin.H{
				"message": "Project dibuat, tapi gagal menarik foto dari Drive.",
				"project": newProject,
			})
			return
		}
		defer resp.Body.Close()

		body, _ := io.ReadAll(resp.Body)
		var driveData DriveAPIResponse
		json.Unmarshal(body, &driveData)

		var photosToInsert []Photo
		for _, file := range driveData.Files {
			photosToInsert = append(photosToInsert, Photo{
				ProjectID:    newProject.ID,
				FileName:     file.Name,
				ThumbnailURL: fmt.Sprintf("https://drive.google.com/thumbnail?id=%s&sz=w800", file.ID),
			})
		}

		if len(photosToInsert) > 0 {
			db.Create(&photosToInsert)
		}

		c.JSON(http.StatusCreated, gin.H{
			"message":      "Project berhasil dibuat & tersinkronisasi!",
			"data":         newProject,
			"photos_found": len(photosToInsert),
		})
	})

	// --- 2. RUTE GET PROJECT (UNTUK KLIEN) ---
	r.GET("/api/p/:magic_link", func(c *gin.Context) {
		magicLink := c.Param("magic_link")

		var project Project
		if err := db.Where("magic_link_token = ?", magicLink).First(&project).Error; err != nil {
			// Hanya pencarian yang GAGAL yang dihitung, sehingga klien sah yang
			// membuka galerinya berulang kali tidak pernah tersentuh limiter.
			if magicLinkLimiter.TooManyFailures(c) {
				c.JSON(http.StatusTooManyRequests, gin.H{"error": "Terlalu banyak percobaan. Coba lagi nanti."})
				return
			}
			c.JSON(http.StatusNotFound, gin.H{"error": "Galeri tidak ditemukan atau link tidak valid"})
			return
		}

		var photos []Photo
		if err := db.Where("project_id = ?", project.ID).Find(&photos).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal memuat daftar foto"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"project": project,
			"photos":  photos,
		})
	})

	// --- 3. RUTE SUBMIT PILIHAN KLIEN ---
	r.POST("/api/p/:magic_link/submit", func(c *gin.Context) {
		magicLink := c.Param("magic_link")

		// Batas jumlah elemen adalah yang paling penting di sini: tanpa itu, satu
		// request bisa memerintahkan insert sebanyak apa pun.
		var input struct {
			SelectedPhotos []struct {
				DriveID  string `json:"drive_id" binding:"max=200"`
				FileName string `json:"file_name" binding:"max=500"`
			} `json:"selected_photos" binding:"required,max=5000,dive"`
		}

		if err := c.ShouldBindJSON(&input); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Data pilihan tidak valid"})
			return
		}

		var project Project
		if err := db.Where("magic_link_token = ?", magicLink).First(&project).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Project tidak valid"})
			return
		}

		// --- GALLERY LOCK: Cegah duplikasi submit ---
		if project.Status == "submitted" {
			c.JSON(http.StatusForbidden, gin.H{"error": "Galeri ini sudah dikunci karena pilihan telah disubmit sebelumnya."})
			return
		}

		// Hapus semua foto lama untuk project ini, lalu insert yang baru
		db.Where("project_id = ?", project.ID).Delete(&Photo{})

		if len(input.SelectedPhotos) > 0 {
			var photosToInsert []Photo
			for _, sp := range input.SelectedPhotos {
				photosToInsert = append(photosToInsert, Photo{
					ProjectID:    project.ID,
					FileName:     sp.FileName,
					ThumbnailURL: "", // tidak diperlukan untuk desktop harvester
					IsSelected:   true,
				})
			}
			db.Create(&photosToInsert)
		}

		db.Model(&project).Update("status", "submitted")

		c.JSON(http.StatusOK, gin.H{
			"message":      "Pilihan berhasil disimpan!",
			"photos_saved": len(input.SelectedPhotos),
		})
	})

	// --- 4. RUTE GET ALL PROJECTS (UNTUK ADMIN DASHBOARD) ---
	r.GET("/api/projects", requireAuth, func(c *gin.Context) {
		userID := c.GetString(middleware.ContextUserIDKey)

		var projects []Project
		// Ambil semua project dari database, urutkan dari yang paling baru dibuat
		if err := db.Where("user_id = ?", userID).Order("created_at desc").Find(&projects).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal mengambil data project"})
			return
		}
		c.JSON(http.StatusOK, projects)
	})

	// --- 5a. RUTE GDRIVE ACCESS TOKEN (UNTUK DESKTOP APP) ---
	// Rute terautentikasi, didaftarkan terpisah dari 5b. Sebelumnya keduanya
	// berbagi satu path dan dibedakan lewat `if folderId == "token"`, sehingga
	// auth tidak bisa dipasang tanpa ikut mengunci 5b yang memang publik.
	r.GET("/api/gdrive/token", requireAuth, func(c *gin.Context) {
		userID := c.GetString(middleware.ContextUserIDKey)

		// Generate GDrive Access Token dari Refresh Token milik user
		accessToken, expiry, err := GetUserAccessToken(userID, db)
		if err != nil {
			log.Printf("🔴 GDrive access token untuk user %s: %v", userID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal menghasilkan access token"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"access_token": accessToken,
			"expiry":       expiry,
		})
	})

	// --- 5b. RUTE INTEGRASI GDRIVE & FORMAT RAW ---
	// Sengaja tetap publik: dipanggil galeri klien yang diakses lewat magic link
	// tanpa login.
	r.GET("/api/gdrive/:folderId", func(c *gin.Context) {
		folderID := c.Param("folderId")

		files, err := GetImagesFromFolder(folderID)
		if err != nil {
			// Rute ini publik: pesan error mentah dari Google API tidak boleh
			// sampai ke pemanggil.
			log.Printf("🔴 Baca folder Drive %s: %v", folderID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal membaca folder Google Drive"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"files": files})
	})

	// --- 6. RUTE EDIT PROJECT ---
	r.PUT("/api/projects/:id", requireAuth, func(c *gin.Context) {
		userID := c.GetString(middleware.ContextUserIDKey)

		projectID := c.Param("id")
		var input CreateProjectInput
		if err := c.ShouldBindJSON(&input); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Input tidak valid"})
			return
		}

		var project Project
		if err := db.Where("id = ? AND user_id = ?", projectID, userID).First(&project).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Project tidak ditemukan atau akses ditolak"})
			return
		}

		newFolderID := extractDriveFolderID(input.DriveFolderURL)
		if newFolderID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Link Google Drive tidak valid"})
			return
		}

		driveChanged := false
		if project.DriveFolderID != newFolderID {
			driveChanged = true
		}

		project.ProjectName = input.ProjectName
		project.ClientName = input.ClientName
		project.MaxSelections = input.MaxSelections
		if project.MaxSelections == 0 {
			project.MaxSelections = 50
		}
		project.DriveFolderURL = input.DriveFolderURL
		project.DriveFolderID = newFolderID
		if input.AdminWhatsApp != "" {
			project.AdminWhatsApp = input.AdminWhatsApp
		}
		if input.ClientWhatsApp != "" {
			project.ClientWhatsApp = input.ClientWhatsApp
		}

		if err := db.Save(&project).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal mengupdate project"})
			return
		}

		if driveChanged {
			// Delete old photos
			db.Where("project_id = ?", project.ID).Delete(&Photo{})

			// Scrape new photos
			apiKey := os.Getenv("GOOGLE_API_KEY")
			driveAPIUrl := fmt.Sprintf("https://www.googleapis.com/drive/v3/files?q='%s'+in+parents+and+mimeType+contains+'image/'&fields=files(id,name,thumbnailLink)&key=%s", newFolderID, apiKey)

			resp, err := http.Get(driveAPIUrl)
			if err == nil && resp.StatusCode == 200 {
				defer resp.Body.Close()
				body, _ := io.ReadAll(resp.Body)
				var driveData DriveAPIResponse
				json.Unmarshal(body, &driveData)

				var photosToInsert []Photo
				for _, file := range driveData.Files {
					photosToInsert = append(photosToInsert, Photo{
						ProjectID:    project.ID,
						FileName:     file.Name,
						ThumbnailURL: fmt.Sprintf("https://drive.google.com/thumbnail?id=%s&sz=w800", file.ID),
					})
				}

				if len(photosToInsert) > 0 {
					db.Create(&photosToInsert)
				}
			}
		}

		c.JSON(http.StatusOK, gin.H{"message": "Project berhasil diupdate", "data": project})
	})

	// --- 7. RUTE DELETE PROJECT ---
	r.DELETE("/api/projects/:id", requireAuth, func(c *gin.Context) {
		userID := c.GetString(middleware.ContextUserIDKey)

		projectID := c.Param("id")

		var project Project
		if err := db.Where("id = ? AND user_id = ?", projectID, userID).First(&project).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Project tidak ditemukan atau akses ditolak"})
			return
		}

		// Delete photos associated with the project
		db.Where("project_id = ?", projectID).Delete(&Photo{})

		if err := db.Delete(&project).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal menghapus project"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"message": "Project berhasil dihapus"})
	})

	return r
}
