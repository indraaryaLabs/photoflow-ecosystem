// Command migrate menerapkan skema database.
//
// Sebelumnya AutoMigrate dan ALTER TABLE berjalan di dalam SetupRouter, yang di
// Vercel berarti keduanya dijalankan pada setiap cold start: perubahan skema
// jadi efek samping dari lalu lintas biasa, tanpa satu pun tempat untuk
// memeriksa hasilnya. Di sini keduanya jadi tindakan yang disengaja.
//
// Jalankan dengan DATABASE_URL terisi:
//
//	go run ./cmd/migrate           menerapkan skema
//	go run ./cmd/migrate -check    hanya memeriksa, tidak mengubah apa pun
//
// Mode -check ada karena deploy berjalan otomatis sementara migrasi tidak.
// Sekali skema tertinggal dari kode yang sudah terlanjur live, gejalanya bukan
// pesan yang jelas melainkan satu tombol yang berhenti bekerja: backend membaca
// dengan SELECT * sehingga tetap jalan, tapi menulis dengan menyebut kolomnya
// satu per satu sehingga INSERT ditolak. Persis itu yang terjadi pada
// projects.submitted_at. Dijalankan pada setiap pull request, -check
// memunculkannya sebelum digabung, bukan sesudah pemakainya menemukannya.
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"sort"
	"strings"

	"github.com/joho/godotenv"
	"gorm.io/gorm"

	"photoflow-backend/db"
	"photoflow-backend/models"
)

// managedTables adalah tabel yang skemanya dikelola perintah ini. Setiap
// penambahan model baru harus ikut didaftarkan di sini, dan kalau terlupa,
// verifyRLS di bawah yang akan menangkapnya.
var managedTables = []string{"projects", "photos", "profiles", "rate_limits", "oauth_states"}

// dikelola adalah model yang skemanya diurus perintah ini. Satu daftar dipakai
// AutoMigrate maupun pemeriksaan, supaya keduanya tidak bisa berbeda isi.
func dikelola() []any {
	return []any{&models.Project{}, &models.Photo{}, &models.RateLimit{}, &models.OAuthState{}}
}

func main() {
	hanyaPeriksa := flag.Bool("check", false,
		"periksa apakah skema database tertinggal dari model, tanpa mengubah apa pun")
	flag.Parse()

	if *hanyaPeriksa {
		if err := periksa(); err != nil {
			log.Fatalf("🔴 %v", err)
		}
		fmt.Println("✅ Skema database sudah sesuai dengan model.")
		return
	}

	if err := run(); err != nil {
		log.Fatalf("🔴 Migrasi gagal: %v", err)
	}
	fmt.Println("✅ Migrasi selesai.")
}

// periksa melaporkan kolom atau tabel yang ada di model tapi belum ada di
// database. Tidak menulis apa pun.
func periksa() error {
	godotenv.Load()

	conn, err := db.Open(os.Getenv("DATABASE_URL"))
	if err != nil {
		return err
	}

	kurang, err := kolomYangHilang(conn)
	if err != nil {
		return err
	}
	if len(kurang) == 0 {
		return nil
	}

	return fmt.Errorf(
		"skema database tertinggal dari model:\n  %s\n\n"+
			"Jalankan `go run ./cmd/migrate` dengan DATABASE_URL yang benar sebelum\n"+
			"perubahan ini digabung. Kalau tidak, backend yang sudah live akan menulis\n"+
			"kolom yang belum ada, dan yang terlihat pemakainya hanya tombol yang gagal",
		strings.Join(kurang, "\n  "))
}

// kolomYangHilang membandingkan tiap model dengan tabelnya di database.
//
// Yang dicari hanya yang KURANG. Kolom yang ada di database tapi tidak di model
// dibiarkan: tabel-tabel ini dibuat Supabase dan sebagian kolomnya memang tidak
// pernah dipetakan ke Go, jadi melaporkannya hanya menghasilkan derau.
func kolomYangHilang(conn *gorm.DB) ([]string, error) {
	m := conn.Migrator()
	var kurang []string

	for _, model := range dikelola() {
		stmt := &gorm.Statement{DB: conn}
		if err := stmt.Parse(model); err != nil {
			return nil, fmt.Errorf("membaca model %T: %w", model, err)
		}
		tabel := stmt.Schema.Table

		if !m.HasTable(model) {
			kurang = append(kurang, fmt.Sprintf("tabel %s belum ada", tabel))
			continue
		}

		for _, field := range stmt.Schema.Fields {
			// Field tanpa kolom sendiri: relasi, dan field bertanda "-".
			if field.DBName == "" || field.IgnoreMigration {
				continue
			}
			if !m.HasColumn(model, field.DBName) {
				kurang = append(kurang, fmt.Sprintf("%s.%s belum ada", tabel, field.DBName))
			}
		}
	}

	sort.Strings(kurang)
	return kurang, nil
}

func run() error {
	godotenv.Load()

	conn, err := db.Open(os.Getenv("DATABASE_URL"))
	if err != nil {
		return err
	}

	if err := conn.AutoMigrate(&models.Project{}, &models.Photo{}, &models.RateLimit{}, &models.OAuthState{}); err != nil {
		return fmt.Errorf("automigrate: %w", err)
	}

	// Kolom ini ditambahkan ke tabel yang dibuat Supabase, bukan oleh AutoMigrate.
	if err := conn.Exec("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS gdrive_refresh_token TEXT").Error; err != nil {
		return fmt.Errorf("menambah kolom gdrive_refresh_token: %w", err)
	}

	if err := enableRLS(conn); err != nil {
		return err
	}
	return verifyRLS(conn)
}

// enableRLS menyalakan Row Level Security pada setiap tabel yang dikelola.
//
// GORM membuat tabel dengan CREATE TABLE biasa, dan Postgres membuat tabel baru
// TANPA RLS. Di project Supabase itu berbahaya: anon key ada di bundle
// JavaScript frontend, jadi tabel tanpa RLS bisa dibaca dan ditulis siapa pun
// lewat REST API Supabase, menembus backend ini sepenuhnya. Persis itu yang
// terjadi pada rate_limits (F-14): penghitung rate limit bisa dihapus sendiri
// oleh penyerang sehingga limiternya kehilangan seluruh gunanya.
//
// Tidak ada policy yang dibuat, dan itu disengaja. RLS aktif tanpa policy
// menolak seluruh akses lewat anon key, dan tidak ada kode frontend yang
// menyentuh tabel-tabel ini. Backend terhubung sebagai pemilik tabel, dan
// pemilik tabel tidak tunduk pada RLS kecuali tabelnya disetel FORCE ROW LEVEL
// SECURITY, sehingga backend tidak terpengaruh.
func enableRLS(conn *gorm.DB) error {
	for _, table := range managedTables {
		stmt := fmt.Sprintf("ALTER TABLE public.%s ENABLE ROW LEVEL SECURITY", table)
		if err := conn.Exec(stmt).Error; err != nil {
			return fmt.Errorf("menyalakan RLS pada %s: %w", table, err)
		}
	}
	return nil
}

// verifyRLS memastikan tidak ada satu pun tabel di skema public yang RLS-nya
// mati, lalu menggagalkan migrasi kalau ada.
//
// Menyalakan RLS pada daftar tabel yang diketahui saja tidak cukup: tabel
// berikutnya yang ditambahkan seseorang akan lolos dengan cara yang sama persis
// seperti rate_limits dulu. Pemeriksaan ini menyapu SELURUH skema public, bukan
// hanya managedTables, sehingga tabel yang lupa didaftarkan tetap tertangkap.
func verifyRLS(conn *gorm.DB) error {
	var unprotected []string
	err := conn.Raw(`
SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND NOT c.relrowsecurity
ORDER BY c.relname`).Scan(&unprotected).Error
	if err != nil {
		return fmt.Errorf("memeriksa status RLS: %w", err)
	}

	if len(unprotected) > 0 {
		return fmt.Errorf(
			"tabel berikut ada di skema public tanpa RLS: %s.\n"+
				"Tabel tanpa RLS dapat dibaca dan ditulis lewat REST API Supabase memakai anon key\n"+
				"yang ada di bundle frontend, menembus backend sepenuhnya. Daftarkan tabelnya di\n"+
				"managedTables, atau nyalakan RLS-nya secara manual",
			strings.Join(unprotected, ", "))
	}
	return nil
}
