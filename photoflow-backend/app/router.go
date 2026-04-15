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
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
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

type CreateProjectInput struct {
	ProjectName    string `json:"project_name" binding:"required"`
	ClientName     string `json:"client_name" binding:"required"`
	MaxSelections  int    `json:"max_selections"`
	DriveFolderURL string `json:"drive_folder_url" binding:"required"`
	AdminWhatsApp  string `json:"admin_whatsapp"`
	ClientWhatsApp string `json:"client_whatsapp"`
}

type DriveAPIResponse struct {
	Files []struct {
		ID            string `json:"id"`
		Name          string `json:"name"`
		ThumbnailLink string `json:"thumbnailLink"`
	} `json:"files"`
}

// --- MODEL AUTH SUPABASE ---
type SupabaseUser struct {
	ID                string `gorm:"type:uuid;primaryKey"`
	Email             string `gorm:"type:text"`
	EncryptedPassword string `gorm:"column:encrypted_password;type:text"`
}

func (SupabaseUser) TableName() string {
	return "auth.users"
}

type LoginDesktopInput struct {
	Email    string `json:"email" binding:"required"`
	Password string `json:"password" binding:"required"`
}

func generateSessionToken() string {
	bytes := make([]byte, 32)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

func extractDriveFolderID(url string) string {
	re := regexp.MustCompile(`[-\w]{25,}`)
	matches := re.FindString(url)
	return matches
}

func generateMagicLink() string {
	bytes := make([]byte, 4)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
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
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With, ngrok-skip-browser-warning, X-User-ID")
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

	db.AutoMigrate(&Project{}, &Photo{})

	r := gin.Default()
	r.GET("/", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"message": "PhotoFlow API is running perfectly! 🚀"})
	})
	// --- MIDDLEWARE CORS ---
	r.Use(CORSMiddleware())

	// --- 0. RUTE LOGIN DESKTOP ---
	r.POST("/api/login-desktop", func(c *gin.Context) {
		var input LoginDesktopInput
		if err := c.ShouldBindJSON(&input); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Email dan password wajib diisi"})
			return
		}

		var user SupabaseUser
		if err := db.Where("email = ?", input.Email).First(&user).Error; err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Email atau password salah"})
			return
		}

		// Verifikasi password dengan bcrypt (Supabase menyimpan hash bcrypt)
		if err := bcrypt.CompareHashAndPassword([]byte(user.EncryptedPassword), []byte(input.Password)); err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Email atau password salah"})
			return
		}

		// Login berhasil — generate session token
		token := generateSessionToken()

		c.JSON(http.StatusOK, gin.H{
			"status":  "success",
			"token":   token,
			"user_id": user.ID,
		})
	})

	// --- 1. RUTE CREATE PROJECT ---
	r.POST("/api/projects", func(c *gin.Context) {
		userID := c.GetHeader("X-User-ID")
		if userID == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			return
		}

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

		newProject := Project{
			ProjectName:    input.ProjectName,
			ClientName:     input.ClientName,
			MaxSelections:  input.MaxSelections,
			DriveFolderURL: input.DriveFolderURL,
			DriveFolderID:  folderID,
			UserID:         userID,
			AdminWhatsApp:  input.AdminWhatsApp,
			ClientWhatsApp: input.ClientWhatsApp,
			MagicLinkToken: generateMagicLink(),
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

		var input struct {
			SelectedPhotos []struct {
				DriveID  string `json:"drive_id"`
				FileName string `json:"file_name"`
			} `json:"selected_photos" binding:"required"`
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
	r.GET("/api/projects", func(c *gin.Context) {
		userID := c.GetHeader("X-User-ID")
		if userID == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			return
		}

		var projects []Project
		// Ambil semua project dari database, urutkan dari yang paling baru dibuat
		if err := db.Where("user_id = ?", userID).Order("created_at desc").Find(&projects).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal mengambil data project"})
			return
		}
		c.JSON(http.StatusOK, projects)
	})

	// --- 5. RUTE INTEGRASI GDRIVE & FORMAT RAW + ACCESS TOKEN ---
	r.GET("/api/gdrive/:folderId", func(c *gin.Context) {
		folderID := c.Param("folderId")

		// --- 5b. SUB-RUTE: GDRIVE ACCESS TOKEN (UNTUK DESKTOP APP) ---
		if folderID == "token" {
			// Cek Authorization header
			authHeader := c.GetHeader("Authorization")
			if authHeader == "" || len(authHeader) < 8 || authHeader[:7] != "Bearer " {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Token otorisasi tidak valid"})
				return
			}

			bearerToken := authHeader[7:]
			if bearerToken == "" {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Token otorisasi tidak valid"})
				return
			}

			// Generate GDrive Access Token dari Service Account
			tokenResponse, err := GetAccessToken()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal menghasilkan access token", "details": err.Error()})
				return
			}

			c.JSON(http.StatusOK, gin.H{
				"access_token": tokenResponse.AccessToken,
				"expiry":       tokenResponse.Expiry,
			})
			return
		}

		// --- 5a. DEFAULT: Baca file dari folder Google Drive ---
		files, err := GetImagesFromFolder(folderID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal membaca folder Google Drive", "details": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"files": files})
	})

	// --- 6. RUTE EDIT PROJECT ---
	r.PUT("/api/projects/:id", func(c *gin.Context) {
		userID := c.GetHeader("X-User-ID")
		if userID == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			return
		}

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
	r.DELETE("/api/projects/:id", func(c *gin.Context) {
		userID := c.GetHeader("X-User-ID")
		if userID == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			return
		}

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
