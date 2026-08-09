// Command migrate menerapkan skema database.
//
// Sebelumnya AutoMigrate dan ALTER TABLE berjalan di dalam SetupRouter, yang di
// Vercel berarti keduanya dijalankan pada setiap cold start: perubahan skema
// jadi efek samping dari lalu lintas biasa, tanpa satu pun tempat untuk
// memeriksa hasilnya. Di sini keduanya jadi tindakan yang disengaja.
//
// Jalankan dengan DATABASE_URL terisi:
//
//	go run ./cmd/migrate
package main

import (
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/joho/godotenv"
	"gorm.io/gorm"

	"photoflow-backend/db"
	"photoflow-backend/models"
)

// managedTables adalah tabel yang skemanya dikelola perintah ini. Setiap
// penambahan model baru harus ikut didaftarkan di sini, dan kalau terlupa,
// verifyRLS di bawah yang akan menangkapnya.
var managedTables = []string{"projects", "photos", "profiles", "rate_limits"}

func main() {
	if err := run(); err != nil {
		log.Fatalf("🔴 Migrasi gagal: %v", err)
	}
	fmt.Println("✅ Migrasi selesai.")
}

func run() error {
	godotenv.Load()

	conn, err := db.Open(os.Getenv("DATABASE_URL"))
	if err != nil {
		return err
	}

	if err := conn.AutoMigrate(&models.Project{}, &models.Photo{}, &models.RateLimit{}); err != nil {
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
