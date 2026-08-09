// Package db membuka koneksi database. Migrasi skema TIDAK ada di sini dan
// tidak dijalankan saat startup: lihat cmd/migrate.
package db

import (
	"errors"
	"fmt"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Open menyambungkan ke PostgreSQL memakai connection string yang diberikan.
//
// Kegagalan dikembalikan sebagai error, bukan diakhiri dengan log.Fatal.
// Backend ini berjalan sebagai fungsi serverless: mematikan proses di jalur
// setup mengubah kesalahan konfigurasi jadi crash tanpa konteks pada setiap
// cold start, dan pemanggilnya kehilangan kesempatan melaporkan apa yang salah.
func Open(dsn string) (*gorm.DB, error) {
	if dsn == "" {
		return nil, errors.New("DATABASE_URL kosong")
	}

	conn, err := gorm.Open(postgres.New(postgres.Config{
		DSN:                  dsn,
		PreferSimpleProtocol: true,
	}), &gorm.Config{})
	if err != nil {
		return nil, fmt.Errorf("gagal terhubung ke database: %w", err)
	}
	return conn, nil
}
