package models

import (
	"testing"
	"time"
)

func waktu(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}

func ptr(t time.Time) *time.Time { return &t }

func TestSubscriptionAktif(t *testing.T) {
	sekarang := waktu("2026-08-20T10:00:00Z")

	kasus := []struct {
		nama string
		sub  Subscription
		want bool
	}{
		{"paket gratis tidak pernah aktif", Subscription{Plan: PlanFree, ExpiresAt: ptr(waktu("2027-01-01T00:00:00Z"))}, false},
		{"paket kosong tidak aktif", Subscription{}, false},
		{"berbayar tanpa tanggal berakhir tidak aktif", Subscription{Plan: PlanFreelance}, false},
		{"berbayar yang sudah lewat tidak aktif", Subscription{Plan: PlanFreelance, ExpiresAt: ptr(waktu("2026-08-19T23:59:59Z"))}, false},
		{"berbayar yang masih berlaku aktif", Subscription{Plan: PlanFreelance, ExpiresAt: ptr(waktu("2026-08-20T10:00:01Z"))}, true},
		{"studio yang masih berlaku aktif", Subscription{Plan: PlanStudio, ExpiresAt: ptr(waktu("2026-12-01T00:00:00Z"))}, true},
	}

	for _, k := range kasus {
		t.Run(k.nama, func(t *testing.T) {
			if got := k.sub.Aktif(sekarang); got != k.want {
				t.Errorf("Aktif = %v, mau %v", got, k.want)
			}
		})
	}
}

// Langganan yang lewat tanggal TIDAK diturunkan di database. Penurunannya
// dihitung saat dibaca, dan tes ini yang menjaga agar perhitungan itu tidak
// hilang — kalau hilang, pelanggan yang berhenti membayar tetap menikmati
// kuota penuh selamanya.
func TestPlanEfektifMenurunkanYangSudahLewat(t *testing.T) {
	sekarang := waktu("2026-08-20T10:00:00Z")
	lewat := Subscription{Plan: PlanStudio, ExpiresAt: ptr(waktu("2026-08-01T00:00:00Z"))}

	if got := lewat.PlanEfektif(sekarang); got != PlanFree {
		t.Errorf("PlanEfektif = %q, mau %q", got, PlanFree)
	}
	if got := lewat.KuotaBulanan(sekarang); got != 3 {
		t.Errorf("KuotaBulanan = %d, mau 3 (kuota gratis)", got)
	}
	if lewat.BolehTanpaMerek(sekarang) {
		t.Error("langganan yang sudah lewat masih boleh tanpa merek")
	}
}

func TestKuotaBulanan(t *testing.T) {
	sekarang := waktu("2026-08-20T10:00:00Z")
	nanti := ptr(waktu("2027-01-01T00:00:00Z"))

	kasus := map[string]struct {
		sub  Subscription
		want int
	}{
		"gratis":        {Subscription{Plan: PlanFree}, 3},
		"freelance":     {Subscription{Plan: PlanFreelance, ExpiresAt: nanti}, 20},
		"studio":        {Subscription{Plan: PlanStudio, ExpiresAt: nanti}, KuotaTakTerbatas},
		"tidak dikenal": {Subscription{Plan: "premium-plus", ExpiresAt: nanti}, 3},
	}

	for nama, k := range kasus {
		t.Run(nama, func(t *testing.T) {
			if got := k.sub.KuotaBulanan(sekarang); got != k.want {
				t.Errorf("KuotaBulanan = %d, mau %d", got, k.want)
			}
		})
	}
}

// Paket yang tidak dikenal harus jatuh ke kuota gratis, bukan ke tanpa batas.
// Data yang rusak atau salah ketik di halaman admin tidak boleh berubah jadi
// akses tanpa batas.
func TestPaketTidakDikenalTidakMemberiAksesTanpaBatas(t *testing.T) {
	sekarang := waktu("2026-08-20T10:00:00Z")
	rusak := Subscription{Plan: "sutdio", ExpiresAt: ptr(waktu("2027-01-01T00:00:00Z"))}

	if got := rusak.KuotaBulanan(sekarang); got == KuotaTakTerbatas {
		t.Fatal("paket salah ketik memberi kuota tanpa batas")
	}
}

// Penghitung kuota memakai waktu Indonesia, bukan UTC. Kalau UTC yang dipakai,
// bulan berganti pukul 07:00 WIB — di tengah hari kerja fotografer — dan galeri
// yang dibuat 30 Agustus malam terhitung sebagai September.
func TestPeriodeSekarangMemakaiWaktuIndonesia(t *testing.T) {
	kasus := []struct {
		nama string
		saat time.Time
		want string
	}{
		{
			// 31 Agustus 23:00 WIB = 31 Agustus 16:00 UTC. Masih Agustus.
			nama: "malam terakhir bulan menurut WIB",
			saat: waktu("2026-08-31T16:00:00Z"),
			want: "2026-08",
		},
		{
			// 31 Agustus 18:00 UTC = 1 September 01:00 WIB. Sudah September.
			nama: "lewat tengah malam WIB walau UTC masih Agustus",
			saat: waktu("2026-08-31T18:00:00Z"),
			want: "2026-09",
		},
		{
			// 1 September 06:00 UTC = 1 September 13:00 WIB.
			nama: "siang hari biasa",
			saat: waktu("2026-09-01T06:00:00Z"),
			want: "2026-09",
		},
	}

	for _, k := range kasus {
		t.Run(k.nama, func(t *testing.T) {
			if got := PeriodeSekarang(k.saat); got != k.want {
				t.Errorf("PeriodeSekarang = %q, mau %q", got, k.want)
			}
		})
	}
}

func TestRedeemCodeTerpakai(t *testing.T) {
	belum := RedeemCode{Code: "PF-AAAA-BBBB"}
	if belum.Terpakai() {
		t.Error("kode baru dianggap sudah terpakai")
	}

	sudah := RedeemCode{Code: "PF-AAAA-BBBB", UsedAt: ptr(waktu("2026-08-20T10:00:00Z"))}
	if !sudah.Terpakai() {
		t.Error("kode yang sudah ditebus dianggap masih tersedia")
	}
}
