package main

import (
	"os"
	"strings"
	"testing"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Pemeriksaan skema ini ada untuk menangkap satu kegagalan tertentu: kode yang
// sudah live menulis kolom yang belum ada di database. Karena itu yang diuji
// bukan bahwa ia berjalan, melainkan bahwa ia MELIHAT kolom yang hilang -- tes
// yang selalu bilang "aman" sama tidak bergunanya dengan tidak ada tes.

func dbUji(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL tidak disetel; melewati tes yang butuh Postgres")
	}
	conn, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("gagal terhubung ke database tes: %v", err)
	}
	return conn
}

// siapkanSkema membuat seluruh tabel yang dikelola, dari nol.
func siapkanSkema(t *testing.T, conn *gorm.DB) {
	t.Helper()

	for _, tabel := range []string{"photos", "projects", "rate_limits", "oauth_states"} {
		conn.Exec("DROP TABLE IF EXISTS " + tabel)
	}
	if err := conn.AutoMigrate(dikelola()...); err != nil {
		t.Fatalf("gagal menyiapkan skema: %v", err)
	}
}

func TestPeriksaDiamSaatSkemaSudahSesuai(t *testing.T) {
	conn := dbUji(t)
	siapkanSkema(t, conn)

	kurang, err := kolomYangHilang(conn)
	if err != nil {
		t.Fatalf("gagal memeriksa: %v", err)
	}
	if len(kurang) != 0 {
		t.Fatalf("melaporkan kekurangan padahal skemanya baru dibuat: %v", kurang)
	}
}

func TestPeriksaMenemukanKolomYangHilang(t *testing.T) {
	conn := dbUji(t)
	siapkanSkema(t, conn)

	// Meniru persis kejadian yang memicu pemeriksaan ini dibuat: kode sudah
	// memuat submitted_at, database belum.
	if err := conn.Exec("ALTER TABLE projects DROP COLUMN submitted_at").Error; err != nil {
		t.Fatalf("gagal menyiapkan keadaan uji: %v", err)
	}

	kurang, err := kolomYangHilang(conn)
	if err != nil {
		t.Fatalf("gagal memeriksa: %v", err)
	}

	if len(kurang) != 1 || !strings.Contains(kurang[0], "projects.submitted_at") {
		t.Fatalf("dapat %v, seharusnya menyebut projects.submitted_at", kurang)
	}
}

func TestPeriksaMenemukanTabelYangHilang(t *testing.T) {
	conn := dbUji(t)
	siapkanSkema(t, conn)

	if err := conn.Exec("DROP TABLE oauth_states").Error; err != nil {
		t.Fatalf("gagal menyiapkan keadaan uji: %v", err)
	}

	kurang, err := kolomYangHilang(conn)
	if err != nil {
		t.Fatalf("gagal memeriksa: %v", err)
	}
	if len(kurang) == 0 || !strings.Contains(strings.Join(kurang, " "), "oauth_states") {
		t.Fatalf("dapat %v, seharusnya menyebut oauth_states", kurang)
	}
}

func TestPeriksaMengabaikanKolomEkstraDiDatabase(t *testing.T) {
	conn := dbUji(t)
	siapkanSkema(t, conn)

	// Tabel-tabel ini dibuat Supabase, dan sebagian kolomnya memang tidak
	// pernah dipetakan ke Go. Melaporkannya hanya menghasilkan derau, dan
	// derau membuat pemeriksaan seperti ini diabaikan orang.
	if err := conn.Exec("ALTER TABLE projects ADD COLUMN catatan_internal text").Error; err != nil {
		t.Fatalf("gagal menyiapkan keadaan uji: %v", err)
	}
	t.Cleanup(func() { conn.Exec("ALTER TABLE projects DROP COLUMN IF EXISTS catatan_internal") })

	kurang, err := kolomYangHilang(conn)
	if err != nil {
		t.Fatalf("gagal memeriksa: %v", err)
	}
	if len(kurang) != 0 {
		t.Fatalf("kolom ekstra dilaporkan sebagai masalah: %v", kurang)
	}
}
