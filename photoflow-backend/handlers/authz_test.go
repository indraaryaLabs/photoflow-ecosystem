package handlers

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"photoflow-backend/middleware"
	"photoflow-backend/models"
	"photoflow-backend/storage"
)

// Tes di berkas ini menjawab pertanyaan yang paling penting dari seluruh repo:
// bisakah satu fotografer menyentuh project milik fotografer lain?
//
// Jalurnya dijalankan penuh — router gin, middleware auth dengan JWKS sungguhan,
// handler, dan PostgreSQL — karena isolasi antar pengguna adalah hasil kerja
// sama middleware dan klausa WHERE di handler. Menguji salah satunya saja tidak
// membuktikan apa pun tentang gabungannya.

// authFixture menyediakan penerbit token dan router yang memakainya.
type authFixture struct {
	engine *gin.Engine
	key    *ecdsa.PrivateKey
	issuer string
	kid    string
}

func newAuthFixture(t *testing.T, db *gorm.DB) *authFixture {
	t.Helper()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("gagal membuat kunci: %v", err)
	}
	fix := &authFixture{key: key, kid: "kunci-uji"}

	mux := http.NewServeMux()
	mux.HandleFunc("/auth/v1/.well-known/jwks.json", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]any{{
			"kty": "EC", "crv": "P-256", "alg": "ES256", "use": "sig", "kid": fix.kid,
			"x": base64.RawURLEncoding.EncodeToString(key.PublicKey.X.Bytes()),
			"y": base64.RawURLEncoding.EncodeToString(key.PublicKey.Y.Bytes()),
		}}})
	})
	srv := httptest.NewTLSServer(mux)
	t.Cleanup(srv.Close)
	fix.issuer = srv.URL + "/auth/v1"

	verifier, err := middleware.NewVerifier(srv.URL, middleware.WithHTTPClient(srv.Client()))
	if err != nil {
		t.Fatalf("gagal membuat verifier: %v", err)
	}

	// Drive sengaja dinyatakan tidak terhubung: yang diuji di sini kepemilikan
	// data, bukan penyegaran foto. Tanpa ini, PUT yang mengganti folder akan
	// mencoba memanggil Drive.
	h := &Handler{
		DB: db,
		StoreForUser: func(_ context.Context, _ string) (storage.PhotoStore, error) {
			return nil, storage.ErrDriveNotConnected
		},
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	requireAuth := verifier.RequireAuth()
	r.GET("/api/projects", requireAuth, h.ListProjects)
	r.PUT("/api/projects/:id", requireAuth, h.UpdateProject)
	r.DELETE("/api/projects/:id", requireAuth, h.DeleteProject)
	fix.engine = r

	return fix
}

// tokenFor menerbitkan JWT sah untuk satu user.
func (f *authFixture) tokenFor(t *testing.T, userID string) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{
		"sub": userID,
		"iss": f.issuer,
		"aud": "authenticated",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	token.Header["kid"] = f.kid
	signed, err := token.SignedString(f.key)
	if err != nil {
		t.Fatalf("gagal menandatangani token: %v", err)
	}
	return signed
}

// do menjalankan satu request terautentikasi lewat router.
func (f *authFixture) do(t *testing.T, method, path, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	rec := httptest.NewRecorder()
	f.engine.ServeHTTP(rec, req)
	return rec
}

// seedProjectFor membuat project milik user tertentu.
func seedProjectFor(t *testing.T, db *gorm.DB, userID, name string) models.Project {
	t.Helper()
	project := models.Project{
		UserID:         userID,
		ProjectName:    name,
		ClientName:     "Klien",
		DriveFolderURL: "https://drive.google.com/drive/folders/abc",
		DriveFolderID:  "abc",
		MagicLinkToken: "token-" + name,
		Status:         "pending",
	}
	if err := db.Create(&project).Error; err != nil {
		t.Fatalf("gagal menyiapkan project: %v", err)
	}
	return project
}

// validEditBody adalah body sah untuk PUT, supaya penolakan yang terjadi
// benar-benar karena kepemilikan dan bukan karena input tidak valid.
const validEditBody = `{"project_name":"Diubah","client_name":"Klien",` +
	`"drive_folder_url":"https://drive.google.com/drive/folders/abcdefghijklmnopqrstuvwxyz12345"}`

func TestUserCannotSeeAnotherUsersProjects(t *testing.T) {
	db := newSubmitTestDB(t)
	fix := newAuthFixture(t, db)

	userA, userB := uuid.NewString(), uuid.NewString()
	projectA := seedProjectFor(t, db, userA, "milik-a")
	seedProjectFor(t, db, userB, "milik-b")

	rec := fix.do(t, "GET", "/api/projects", fix.tokenFor(t, userB), "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, seharusnya 200", rec.Code)
	}

	var projects []models.Project
	if err := json.Unmarshal(rec.Body.Bytes(), &projects); err != nil {
		t.Fatalf("respons bukan daftar project: %v", err)
	}
	for _, p := range projects {
		if p.ID == projectA.ID {
			t.Fatal("project milik user A ikut terdaftar untuk user B")
		}
		if p.UserID != userB {
			t.Fatalf("daftar memuat project milik %s", p.UserID)
		}
	}
	if len(projects) != 1 {
		t.Fatalf("%d project terdaftar, seharusnya 1", len(projects))
	}
}

// TestUserCannotEditAnotherUsersProject memastikan penolakannya bukan sekadar
// kode status: baris milik user A harus benar-benar tidak berubah.
func TestUserCannotEditAnotherUsersProject(t *testing.T) {
	db := newSubmitTestDB(t)
	fix := newAuthFixture(t, db)

	userA, userB := uuid.NewString(), uuid.NewString()
	projectA := seedProjectFor(t, db, userA, "milik-a")

	rec := fix.do(t, "PUT", "/api/projects/"+projectA.ID, fix.tokenFor(t, userB), validEditBody)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d, seharusnya 404", rec.Code)
	}

	var after models.Project
	db.Where("id = ?", projectA.ID).First(&after)
	if after.ProjectName != "milik-a" {
		t.Fatalf("nama project berubah jadi %q: user B berhasil mengedit", after.ProjectName)
	}
}

func TestUserCannotDeleteAnotherUsersProject(t *testing.T) {
	db := newSubmitTestDB(t)
	fix := newAuthFixture(t, db)

	userA, userB := uuid.NewString(), uuid.NewString()
	projectA := seedProjectFor(t, db, userA, "milik-a")

	rec := fix.do(t, "DELETE", "/api/projects/"+projectA.ID, fix.tokenFor(t, userB), "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d, seharusnya 404", rec.Code)
	}

	var count int64
	db.Model(&models.Project{}).Where("id = ?", projectA.ID).Count(&count)
	if count != 1 {
		t.Fatal("project milik user A terhapus oleh user B")
	}
}

// TestOwnerCanEditAndDeleteOwnProject adalah pasangan wajib dari ketiga tes di
// atas. Tanpa ini, handler yang menolak SEMUA orang akan lolos seluruh tes
// isolasi sambil membuat aplikasinya tidak berguna.
func TestOwnerCanEditAndDeleteOwnProject(t *testing.T) {
	db := newSubmitTestDB(t)
	fix := newAuthFixture(t, db)

	userA := uuid.NewString()
	project := seedProjectFor(t, db, userA, "milik-a")
	token := fix.tokenFor(t, userA)

	if rec := fix.do(t, "PUT", "/api/projects/"+project.ID, token, validEditBody); rec.Code != http.StatusOK {
		t.Fatalf("pemilik gagal mengedit projectnya sendiri: status %d, body %s", rec.Code, rec.Body.String())
	}

	if rec := fix.do(t, "DELETE", "/api/projects/"+project.ID, token, ""); rec.Code != http.StatusOK {
		t.Fatalf("pemilik gagal menghapus projectnya sendiri: status %d", rec.Code)
	}

	var count int64
	db.Model(&models.Project{}).Where("id = ?", project.ID).Count(&count)
	if count != 0 {
		t.Fatal("project tidak terhapus")
	}
}

// TestRequestWithoutTokenIsRejected menutup jalur yang dulunya terbuka lebar:
// sebelum Fase 3.1, identitas diambil dari header X-User-ID yang bisa diketik
// siapa saja. Header itu kini tidak berarti apa-apa.
func TestRequestWithoutTokenIsRejected(t *testing.T) {
	db := newSubmitTestDB(t)
	fix := newAuthFixture(t, db)

	userA := uuid.NewString()
	projectA := seedProjectFor(t, db, userA, "milik-a")

	req := httptest.NewRequest("GET", "/api/projects", nil)
	req.Header.Set("X-User-ID", userA) // persis serangan yang dulu berhasil
	rec := httptest.NewRecorder()
	fix.engine.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, seharusnya 401: X-User-ID masih dipercaya", rec.Code)
	}
	if strings.Contains(rec.Body.String(), projectA.ID) {
		t.Fatal("data project bocor tanpa token")
	}
}
