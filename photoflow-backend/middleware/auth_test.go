package middleware_test

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"

	"photoflow-backend/middleware"
)

// Berkas ini menguji satu-satunya hal yang memutuskan siapa boleh menyentuh
// data siapa. Tidak ada yang di-mock: JWKS disajikan server HTTPS sungguhan,
// token ditandatangani kunci sungguhan, dan verifikasinya berjalan penuh.
//
// Yang dijaga di sini bukan "middleware mengembalikan 401", melainkan bahwa
// setiap jalan pintas yang bisa dipakai menembusnya benar-benar tertutup.

const (
	testAudience = "authenticated"
	testSubject  = "11111111-1111-1111-1111-111111111111"
)

// jwksServer adalah server JWKS palsu yang menyajikan kunci publik ES256.
type jwksServer struct {
	*httptest.Server
	key *ecdsa.PrivateKey
	kid string
}

// newJWKSServer menyalakan server JWKS. Kalau empty true, JWKS-nya sah tapi
// tidak memuat satu kunci pun — meniru keadaan saat Supabase tidak dapat
// dihubungi dan tidak ada kunci yang berhasil dimuat.
func newJWKSServer(t *testing.T, empty bool) *jwksServer {
	return newJWKSServerOpts(t, empty, false)
}

// newJWKSServerOpts sama seperti newJWKSServer, dengan opsi menghilangkan
// parameter `alg` dari JWK. Itu dipakai untuk menembus pemeriksaan silang alg
// milik pustaka keyfunc dan menguji lapisan pertahanan di bawahnya.
func newJWKSServerOpts(t *testing.T, empty, omitAlg bool) *jwksServer {
	t.Helper()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("gagal membuat kunci: %v", err)
	}
	js := &jwksServer{key: key, kid: "kunci-uji"}

	mux := http.NewServeMux()
	mux.HandleFunc("/auth/v1/.well-known/jwks.json", func(w http.ResponseWriter, _ *http.Request) {
		keys := []map[string]any{}
		if !empty {
			jwk := map[string]any{
				"kty": "EC", "crv": "P-256", "use": "sig", "kid": js.kid,
				"x": base64.RawURLEncoding.EncodeToString(key.PublicKey.X.Bytes()),
				"y": base64.RawURLEncoding.EncodeToString(key.PublicKey.Y.Bytes()),
			}
			if !omitAlg {
				jwk["alg"] = "ES256"
			}
			keys = append(keys, jwk)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": keys})
	})

	js.Server = httptest.NewTLSServer(mux)
	t.Cleanup(js.Close)
	return js
}

func (j *jwksServer) issuer() string { return j.URL + "/auth/v1" }

// verifier membangun Verifier yang menunjuk server ini. Klien HTTP-nya diganti
// agar mempercayai sertifikat server uji; tidak ada aturan verifikasi token
// yang dilonggarkan.
func (j *jwksServer) verifier(t *testing.T) *middleware.Verifier {
	t.Helper()
	v, err := middleware.NewVerifier(j.URL, middleware.WithHTTPClient(j.Client()))
	if err != nil {
		t.Fatalf("gagal membuat verifier: %v", err)
	}
	return v
}

// claims membangun klaim yang sah, untuk dirusak satu per satu di tiap kasus.
func (j *jwksServer) claims() jwt.MapClaims {
	return jwt.MapClaims{
		"sub": testSubject,
		"iss": j.issuer(),
		"aud": testAudience,
		"exp": time.Now().Add(time.Hour).Unix(),
	}
}

// signES256 menandatangani token dengan kunci privat server dan kid tertentu.
func (j *jwksServer) signES256(t *testing.T, claims jwt.MapClaims, kid string) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
	token.Header["kid"] = kid
	signed, err := token.SignedString(j.key)
	if err != nil {
		t.Fatalf("gagal menandatangani token: %v", err)
	}
	return signed
}

// runAuth menjalankan middleware terhadap satu Authorization header.
func runAuth(t *testing.T, v *middleware.Verifier, authHeader string) (int, map[string]any, string) {
	t.Helper()

	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest("GET", "/api/projects", nil)
	if authHeader != "" {
		c.Request.Header.Set("Authorization", authHeader)
	}

	var reachedHandler string
	handlers := []gin.HandlerFunc{
		v.RequireAuth(),
		func(c *gin.Context) {
			reachedHandler = c.GetString(middleware.ContextUserIDKey)
			c.JSON(http.StatusOK, gin.H{"ok": true})
		},
	}
	for _, h := range handlers {
		h(c)
		if c.IsAborted() {
			break
		}
	}

	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	return rec.Code, body, reachedHandler
}

func TestValidTokenPassesAndSetsUserID(t *testing.T) {
	js := newJWKSServer(t, false)
	v := js.verifier(t)

	code, _, userID := runAuth(t, v, "Bearer "+js.signES256(t, js.claims(), js.kid))

	if code != http.StatusOK {
		t.Fatalf("status %d, seharusnya 200", code)
	}
	if userID != testSubject {
		t.Fatalf("user_id %q, seharusnya %q: klaim sub tidak sampai ke handler", userID, testSubject)
	}
}

// TestUnknownKidRejected menjaga agar token yang menyebut kunci di luar JWKS
// tidak diterima. Tanpa ini, penyerang cukup menandatangani token dengan kunci
// buatannya sendiri lalu menyebut kid apa pun.
func TestUnknownKidRejected(t *testing.T) {
	js := newJWKSServer(t, false)
	v := js.verifier(t)

	code, body, userID := runAuth(t, v, "Bearer "+js.signES256(t, js.claims(), "kid-yang-tidak-ada"))

	if code != http.StatusUnauthorized {
		t.Fatalf("status %d, seharusnya 401", code)
	}
	if userID != "" {
		t.Fatal("handler tetap dijalankan padahal token ditolak")
	}
	if body["error"] != "unauthorized" {
		t.Fatalf("body %v, seharusnya error unauthorized", body)
	}
}

// TestHS256Rejected adalah kasus algorithm confusion.
//
// Penyerang mengambil kunci PUBLIK dari JWKS — yang memang publik — lalu
// memakainya sebagai secret HMAC. Kalau verifier menerima HS256, signature-nya
// cocok dan token palsu itu lolos.
//
// Yang perlu dicatat jujur: percobaan mencabut jwt.WithValidMethods dari kode
// TIDAK membuat tes ini gagal. Penolakan HS256 di sini ditegakkan berlapis, dan
// dua lapis lainnya bekerja lebih dulu — pustaka keyfunc menolak ketika `alg`
// pada JWK tidak cocok dengan `alg` pada token, dan golang-jwt menolak karena
// metode HMAC menuntut kunci bertipe []byte sedangkan yang diberikan adalah
// *ecdsa.PublicKey. Pembatasan algoritma di kode ini adalah lapis ketiga yang
// eksplisit, bukan satu-satunya yang menahan.
//
// Kedua sub-kasus di bawah menyusuri lapisan itu: yang pertama dengan `alg` di
// JWK, yang kedua tanpa — sehingga pemeriksaan silang keyfunc dilewati dan yang
// tersisa adalah pertahanan di bawahnya.
func TestHS256Rejected(t *testing.T) {
	cases := []struct {
		name    string
		omitAlg bool
	}{
		{"JWK menyatakan alg ES256", false},
		{"JWK tanpa alg", true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			js := newJWKSServerOpts(t, false, tc.omitAlg)
			v := js.verifier(t)

			// Kunci publik ES256, dipakai sebagai secret HMAC persis seperti serangannya.
			publicKeyBytes := append(js.key.PublicKey.X.Bytes(), js.key.PublicKey.Y.Bytes()...)
			token := jwt.NewWithClaims(jwt.SigningMethodHS256, js.claims())
			token.Header["kid"] = js.kid
			signed, err := token.SignedString(publicKeyBytes)
			if err != nil {
				t.Fatalf("gagal menandatangani token HS256: %v", err)
			}

			code, _, userID := runAuth(t, v, "Bearer "+signed)

			if code != http.StatusUnauthorized {
				t.Fatalf("status %d, seharusnya 401: token HS256 lolos", code)
			}
			if userID != "" {
				t.Fatal("handler dijalankan dengan token HS256")
			}
		})
	}
}

// TestWrongIssuerRejected menjaga agar token dari project Supabase lain tidak
// diterima. Tanpa pemeriksaan issuer, siapa pun yang punya project Supabase
// sendiri bisa menerbitkan token yang lolos di sini.
func TestWrongIssuerRejected(t *testing.T) {
	js := newJWKSServer(t, false)
	v := js.verifier(t)

	claims := js.claims()
	claims["iss"] = "https://project-lain.supabase.co/auth/v1"

	code, _, _ := runAuth(t, v, "Bearer "+js.signES256(t, claims, js.kid))

	if code != http.StatusUnauthorized {
		t.Fatalf("status %d, seharusnya 401: issuer asing diterima", code)
	}
}

func TestWrongAudienceRejected(t *testing.T) {
	js := newJWKSServer(t, false)
	v := js.verifier(t)

	claims := js.claims()
	claims["aud"] = "anon"

	code, _, _ := runAuth(t, v, "Bearer "+js.signES256(t, claims, js.kid))

	if code != http.StatusUnauthorized {
		t.Fatalf("status %d, seharusnya 401: audience anon diterima", code)
	}
}

// TestExpiredTokenCarriesRefreshableCode menjaga pembedaan yang dipakai
// frontend: kedaluwarsa berarti "segarkan sesi", bukan "identitasmu tidak sah".
func TestExpiredTokenCarriesRefreshableCode(t *testing.T) {
	js := newJWKSServer(t, false)
	v := js.verifier(t)

	claims := js.claims()
	claims["exp"] = time.Now().Add(-time.Hour).Unix()

	code, body, _ := runAuth(t, v, "Bearer "+js.signES256(t, claims, js.kid))

	if code != http.StatusUnauthorized {
		t.Fatalf("status %d, seharusnya 401", code)
	}
	if body["code"] != "token_expired" {
		t.Fatalf("code %v, seharusnya token_expired", body["code"])
	}
}

// TestEmptyJWKSAnswers503 menjaga pembedaan antara "token ini tidak sah" dan
// "backend sedang tidak bisa memverifikasi apa pun".
//
// Tanpa kunci sama sekali, token sah dan token palsu sama-sama gagal. Membalas
// 401 berarti memberi tahu user yang tokennya baik-baik saja bahwa identitasnya
// ditolak — dan frontend akan mengeluarkannya dari sesi. Satu gangguan JWKS
// akan melogout semua admin sekaligus.
func TestEmptyJWKSAnswers503(t *testing.T) {
	js := newJWKSServer(t, true) // JWKS sah, tapi tanpa kunci
	v := js.verifier(t)

	code, body, _ := runAuth(t, v, "Bearer "+js.signES256(t, js.claims(), js.kid))

	if code != http.StatusServiceUnavailable {
		t.Fatalf("status %d, seharusnya 503", code)
	}
	if body["error"] != "auth_unavailable" {
		t.Fatalf("body %v, seharusnya auth_unavailable", body)
	}
}

func TestMissingOrMalformedHeaderRejected(t *testing.T) {
	js := newJWKSServer(t, false)
	v := js.verifier(t)

	cases := []struct {
		name   string
		header string
	}{
		{"tanpa header", ""},
		{"skema salah", "Basic abc123"},
		{"Bearer tanpa token", "Bearer "},
		{"token bukan JWT", "Bearer bukan-jwt"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, _, userID := runAuth(t, v, tc.header)
			if code != http.StatusUnauthorized {
				t.Fatalf("status %d, seharusnya 401", code)
			}
			if userID != "" {
				t.Fatal("handler dijalankan tanpa token sah")
			}
		})
	}
}
