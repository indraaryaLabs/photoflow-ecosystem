package middleware

import (
	"testing"
)

// Daftar origin menentukan hidup-matinya seluruh frontend: origin yang tidak
// cocok berarti setiap panggilan API ditolak peramban, dan yang terlihat bukan
// pesan error melainkan galeri kosong. Karena itu yang diuji di sini adalah
// bentuk-bentuk isian yang paling mungkin salah ketik saat orang menyetelnya.

func TestAllowedOriginsMemakaiBawaanSaatKosong(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "")

	perm := AllowedOrigins()
	for _, o := range defaultOrigins {
		if !perm[o] {
			t.Fatalf("%q hilang dari daftar bawaan", o)
		}
	}
}

func TestAllowedOriginsMenggantikanBawaanSepenuhnya(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "https://photoflow.vercel.app")

	perm := AllowedOrigins()
	if !perm["https://photoflow.vercel.app"] {
		t.Fatal("alamat baru tidak diizinkan")
	}
	// Menggantikan, bukan menambah. Alamat lama yang sudah tidak dipakai tidak
	// boleh diam-diam tetap diizinkan hanya karena pernah jadi bawaan.
	if perm["http://localhost:5173"] {
		t.Fatal("alamat bawaan masih diizinkan padahal sudah diganti")
	}
}

func TestAllowedOriginsAcceptsMultipleAddresses(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS",
		"https://photoflow.vercel.app,https://photoflow-ecosystem.vercel.app,http://localhost:5173")

	perm := AllowedOrigins()
	if len(perm) != 3 {
		t.Fatalf("dapat %d alamat, seharusnya 3: %v", len(perm), perm)
	}
}

func TestAllowedOriginsMemaafkanSpasiDanGarisMiring(t *testing.T) {
	// Dua salah ketik yang paling sering terjadi saat menempel daftar ke kotak
	// isian environment di Vercel. Header Origin dari peramban tidak pernah
	// berakhiran garis miring, jadi satu karakter itu membuat pencocokannya
	// meleset tanpa satu pun petunjuk.
	t.Setenv("ALLOWED_ORIGINS", " https://photoflow.vercel.app/ , http://localhost:5173 ")

	perm := AllowedOrigins()
	if !perm["https://photoflow.vercel.app"] {
		t.Fatalf("garis miring atau spasi tidak dibersihkan: %v", perm)
	}
	if !perm["http://localhost:5173"] {
		t.Fatalf("spasi tidak dibersihkan: %v", perm)
	}
}

func TestAllowedOriginsMengabaikanEntriKosong(t *testing.T) {
	// Koma berlebih di ujung daftar tidak boleh menghasilkan entri kosong;
	// entri kosong akan mencocoki permintaan yang sama sekali tanpa header
	// Origin.
	t.Setenv("ALLOWED_ORIGINS", "https://photoflow.vercel.app,,")

	perm := AllowedOrigins()
	if perm[""] {
		t.Fatal("entri kosong ikut diizinkan")
	}
	if len(perm) != 1 {
		t.Fatalf("dapat %v, seharusnya satu alamat saja", perm)
	}
}
