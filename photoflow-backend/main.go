package main

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
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// --- MODEL DATABASE ---
type Project struct {
	ID             string    `gorm:"type:uuid;default:gen_random_uuid();primaryKey" json:"id"`
	ClientName     string    `gorm:"type:text;not null" json:"client_name"`
	MaxSelections  int       `gorm:"default:50" json:"max_selections"`
	DriveFolderURL string    `gorm:"type:text;not null" json:"drive_folder_url"`
	DriveFolderID  string    `gorm:"type:text;not null" json:"drive_folder_id"`
	MagicLinkToken string    `gorm:"type:text;unique;not null" json:"magic_link_token"`
	Status         string    `gorm:"type:text;default:'pending'" json:"status"`
	CreatedAt      time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt      time.Time `gorm:"autoUpdateTime" json:"updated_at"`
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
	ClientName     string `json:"client_name" binding:"required"`
	MaxSelections  int    `json:"max_selections"`
	DriveFolderURL string `json:"drive_folder_url" binding:"required"`
}

type DriveAPIResponse struct {
	Files []struct {
		ID            string `json:"id"`
		Name          string `json:"name"`
		ThumbnailLink string `json:"thumbnailLink"`
	} `json:"files"`
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

func main() {
	godotenv.Load()

	dsn := os.Getenv("DATABASE_URL")
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatal("Gagal terhubung ke database:", err)
	}
	fmt.Println("🚀 Database Terkoneksi!")

	db.AutoMigrate(&Project{}, &Photo{})

	r := gin.Default()

	// --- MIDDLEWARE CORS ---
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "*, ngrok-skip-browser-warning")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(200)
			return
		}
		
		c.Next()
	})

	// --- 1. RUTE CREATE PROJECT ---
	r.POST("/api/projects", func(c *gin.Context) {
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
			ClientName:     input.ClientName,
			MaxSelections:  input.MaxSelections,
			DriveFolderURL: input.DriveFolderURL,
			DriveFolderID:  folderID,
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
			SelectedPhotoIDs []string `json:"selected_photo_ids" binding:"required"`
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

		// Reset lalu set yang baru
		db.Model(&Photo{}).Where("project_id = ?", project.ID).Update("is_selected", false)

		if len(input.SelectedPhotoIDs) > 0 {
			db.Model(&Photo{}).Where("id IN ?", input.SelectedPhotoIDs).Update("is_selected", true)
		}

		db.Model(&project).Update("status", "submitted")

		c.JSON(http.StatusOK, gin.H{"message": "Pilihan berhasil disimpan!"})
	})

	// --- 4. RUTE GET ALL PROJECTS (UNTUK ADMIN DASHBOARD) ---
	r.GET("/api/projects", func(c *gin.Context) {
		var projects []Project
		// Ambil semua project dari database, urutkan dari yang paling baru dibuat
		if err := db.Order("created_at desc").Find(&projects).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal mengambil data project"})
			return
		}
		c.JSON(http.StatusOK, projects)
	})

	// --- 5. RUTE INTEGRASI GDRIVE & FORMAT RAW ---
	r.GET("/api/gdrive/:folderId", func(c *gin.Context) {
		folderID := c.Param("folderId")
		files, err := GetImagesFromFolder(folderID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Gagal membaca folder Google Drive", "details": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"files": files})
	})

	// --- PENGATURAN PORT & START SERVER ---
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	fmt.Println("🔥 Server berjalan di http://localhost:" + port)
	r.Run(":" + port)
}
