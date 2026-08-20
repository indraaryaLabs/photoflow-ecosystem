// Package middleware berisi middleware HTTP lintas-rute untuk PhotoFlow API.
package middleware

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// ContextUserIDKey adalah key gin.Context tempat user ID hasil verifikasi disimpan.
// Handler membacanya lewat c.GetString(middleware.ContextUserIDKey).
const ContextUserIDKey = "user_id"

// expectedAudience adalah nilai klaim `aud` yang diberikan Supabase pada token
// user yang sudah login. Token anon memakai audience lain dan ditolak.
const expectedAudience = "authenticated"

// allowedAlgorithms membatasi algoritma signature yang diterima. Daftar ini
// sengaja hanya memuat algoritma asimetris: token HS256 akan ditolak walaupun
// signature-nya cocok, sehingga algorithm confusion tidak mungkin terjadi.
var allowedAlgorithms = []string{"ES256", "RS256"}

// jwksRefreshInterval adalah jarak antar penarikan ulang JWKS oleh goroutine
// latar milik keyfunc. Nilai bawaan library adalah 1 jam; itu juga yang
// menentukan berapa lama backend tetap tanpa kunci setelah Supabase sempat
// tidak bisa dihubungi. 30 detik menjaga jendela pemulihan itu tetap pendek
// dengan biaya satu permintaan HTTP per 30 detik per instance yang hidup.
//
// Batas penarikan ulang untuk `kid` tak dikenal SENGAJA dibiarkan pada bawaan
// library (satu kali per 5 menit): itu yang mencegah token dengan kid acak
// dipakai memancing banjir permintaan ke Supabase.
const jwksRefreshInterval = 30 * time.Second

// Verifier memverifikasi JWT terbitan Supabase Auth memakai kunci publik dari
// endpoint JWKS project. Backend tidak pernah memegang kunci privat, jadi
// backend hanya bisa memeriksa token — tidak bisa menerbitkannya.
type Verifier struct {
	issuer  string
	jwksURL string

	// httpClient dipakai saat mengambil JWKS. Nil berarti klien bawaan.
	// Disediakan supaya tes bisa mengarahkan verifier ke server JWKS lokal
	// tanpa mengendurkan satu pun aturan yang berlaku di produksi.
	httpClient *http.Client

	mu sync.Mutex
	kf keyfunc.Keyfunc
}

// VerifierOption menyesuaikan Verifier saat dibuat.
type VerifierOption func(*Verifier)

// WithHTTPClient mengganti klien HTTP yang dipakai mengambil JWKS.
func WithHTTPClient(client *http.Client) VerifierOption {
	return func(v *Verifier) { v.httpClient = client }
}

// NewVerifier membangun Verifier dari base URL project Supabase, misalnya
// "https://xxxx.supabase.co". Fungsi ini hanya memvalidasi konfigurasi dan
// tidak menyentuh jaringan; JWKS diambil saat request terautentikasi pertama.
func NewVerifier(supabaseURL string, opts ...VerifierOption) (*Verifier, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(supabaseURL), "/")
	if trimmed == "" {
		return nil, errors.New("SUPABASE_URL kosong")
	}
	if !strings.HasPrefix(trimmed, "https://") {
		return nil, fmt.Errorf("SUPABASE_URL harus memakai https, dapat: %q", trimmed)
	}

	issuer := trimmed + "/auth/v1"
	v := &Verifier{
		issuer:  issuer,
		jwksURL: issuer + "/.well-known/jwks.json",
	}
	for _, opt := range opts {
		opt(v)
	}
	return v, nil
}

// keyfunc mengambil jwt.Keyfunc dari JWKS, menginisialisasinya sekali lalu
// memakainya ulang.
//
// Inisialisasi ditunda (lazy) supaya penarikan JWKS tidak berada di jalur cold
// start: rute publik seperti galeri klien tidak perlu ikut membayar latensinya.
// Perlu dicatat bahwa ini BUKAN pengaman terhadap Supabase yang sedang tidak
// bisa dihubungi — keyfunc.NewDefault* memakai NoErrorReturnFirstHTTPReq, jadi
// ia tetap sukses walau penarikan pertama gagal, dan yang tersisa adalah
// storage kosong. Keadaan itu ditangani di RequireAuth.
func (v *Verifier) keyfunc() (jwt.Keyfunc, error) {
	v.mu.Lock()
	defer v.mu.Unlock()

	if v.kf == nil {
		kf, err := keyfunc.NewDefaultOverrideCtx(context.Background(), []string{v.jwksURL},
			keyfunc.Override{RefreshInterval: jwksRefreshInterval, Client: v.httpClient})
		if err != nil {
			return nil, fmt.Errorf("gagal memuat JWKS: %w", err)
		}
		v.kf = kf
	}
	return v.kf.Keyfunc, nil
}

// jwksEmpty melaporkan apakah belum ada satu pun kunci publik yang berhasil
// dimuat, yaitu ketika penarikan JWKS belum pernah sukses.
//
// Ini dipakai untuk membedakan "backend tidak bisa memverifikasi apa pun" dari
// "token ini memang tidak sah", dan pembedaan itu tidak bisa dibalik dari luar:
// isi storage hanya ditentukan oleh hasil penarikan JWKS, tidak oleh apa pun di
// dalam request. Penarikan yang gagal keluar lebih dulu tanpa menyentuh
// storage, sehingga kumpulan kunci yang sudah terisi tidak bisa dikosongkan
// oleh trafik dari luar.
func (v *Verifier) jwksEmpty(ctx context.Context) bool {
	v.mu.Lock()
	kf := v.kf
	v.mu.Unlock()

	if kf == nil {
		return true
	}
	keys, err := kf.Storage().KeyReadAll(ctx)
	return err != nil || len(keys) == 0
}

// RequireAuth menolak request yang tidak membawa JWT Supabase yang sah.
// Kalau token valid, user ID dari klaim `sub` disimpan ke context dan request
// diteruskan ke handler.
//
// Middleware ini hanya menetapkan IDENTITAS. Kepemilikan resource tetap harus
// diperiksa di handler, misalnya lewat filter WHERE user_id = ?.
func (v *Verifier) RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		raw, ok := bearerToken(c.GetHeader("Authorization"))
		if !ok {
			abortUnauthorized(c, "")
			return
		}

		keyfn, err := v.keyfunc()
		if err != nil {
			// Kegagalan mengambil JWKS bukan salah klien: jangan balas 401,
			// karena token-nya mungkin sah dan klien tidak bisa memperbaiki apa pun.
			log.Printf("[ERROR] Auth: %v", err)
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"error": "auth_unavailable",
			})
			return
		}

		token, err := jwt.Parse(raw, keyfn,
			jwt.WithValidMethods(allowedAlgorithms),
			jwt.WithIssuer(v.issuer),
			jwt.WithAudience(expectedAudience),
			jwt.WithExpirationRequired(),
		)
		if err != nil {
			// Token kedaluwarsa dibedakan supaya frontend bisa me-refresh sesi
			// alih-alih memaksa user login ulang. Sebab kegagalan lain sengaja
			// tidak dibocorkan ke klien dan hanya masuk log.
			if errors.Is(err, jwt.ErrTokenExpired) {
				abortUnauthorized(c, "token_expired")
				return
			}

			// Tanpa satu pun kunci publik, token sah dan token palsu sama-sama
			// tidak bisa diverifikasi. Membalas 401 di sini berarti memberi tahu
			// user yang tokennya baik-baik saja bahwa identitasnya ditolak, dan
			// frontend akan mengeluarkannya dari sesi. Selama gangguan itu semua
			// admin ikut ter-logout, padahal tidak ada yang salah pada mereka.
			if v.jwksEmpty(c.Request.Context()) {
				log.Printf("[ERROR] Auth: JWKS kosong, verifikasi tidak bisa dilakukan: %v", err)
				c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
					"error": "auth_unavailable",
				})
				return
			}

			log.Printf("[WARN] Auth: token ditolak: %v", err)
			abortUnauthorized(c, "")
			return
		}

		userID, err := token.Claims.GetSubject()
		if err != nil || userID == "" {
			log.Printf("[WARN] Auth: klaim sub tidak terbaca: %v", err)
			abortUnauthorized(c, "")
			return
		}

		// Kolom user_id di database bertipe uuid. Menolak sub yang bukan UUID
		// di sini membuat token aneh berhenti sebagai 401, bukan jadi error 500
		// dari Postgres di dalam handler.
		if _, err := uuid.Parse(userID); err != nil {
			log.Printf("[WARN] Auth: klaim sub bukan UUID")
			abortUnauthorized(c, "")
			return
		}

		c.Set(ContextUserIDKey, userID)
		c.Next()
	}
}

// bearerToken mengambil kredensial dari header Authorization berskema Bearer.
// Nama skema tidak case-sensitive sesuai RFC 7235.
func bearerToken(header string) (string, bool) {
	scheme, credentials, found := strings.Cut(strings.TrimSpace(header), " ")
	if !found || !strings.EqualFold(scheme, "Bearer") {
		return "", false
	}

	credentials = strings.TrimSpace(credentials)
	if credentials == "" {
		return "", false
	}
	return credentials, true
}

// abortUnauthorized membalas 401 dan menghentikan chain sebelum handler jalan.
// Pesannya sengaja seragam: klien tidak perlu tahu apakah yang salah signature,
// issuer, atau audience. code diisi hanya ketika klien bisa menindaklanjutinya.
func abortUnauthorized(c *gin.Context, code string) {
	body := gin.H{"error": "unauthorized"}
	if code != "" {
		body["code"] = code
	}
	c.AbortWithStatusJSON(http.StatusUnauthorized, body)
}
