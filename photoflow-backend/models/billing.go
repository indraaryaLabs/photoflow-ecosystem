package models

import "time"

// Nama paket. Disimpan sebagai teks, bukan angka: nilai yang terbaca apa adanya
// di dalam database jauh lebih murah dipakai saat mengurus keluhan pelanggan
// daripada enum yang harus diterjemahkan lebih dulu.
const (
	PlanFree      = "free"
	PlanFreelance = "freelance"
	PlanStudio    = "studio"
)

// KuotaTakTerbatas menandai paket tanpa batas galeri.
const KuotaTakTerbatas = -1

// kuotaBulanan memetakan paket ke jumlah galeri yang boleh dibuat per bulan.
//
// Angka gratisnya sengaja 3, bukan sekali seumur akun. Kuota seumur akun justru
// MENDORONG orang membuat akun baru setiap kali habis — tiga galeri, akun baru,
// tiga galeri lagi. Kuota bulanan membuat jalan curang itu tidak menyelesaikan
// apa pun bagi yang butuh 8-12 galeri sebulan: menunggu bulan depan tidak
// menambah kapasitas hari ini.
//
// 20 untuk Freelance berasal dari pemakaian yang dilaporkan fotografer: 2-3
// klien per minggu, jadi 8-12 sebulan. Batasnya dua kali lipat kebutuhan wajar,
// supaya tidak pernah terasa mengganggu bagi yang memakainya jujur.
var kuotaBulanan = map[string]int{
	PlanFree:      3,
	PlanFreelance: 20,
	PlanStudio:    KuotaTakTerbatas,
}

// Subscription adalah keadaan langganan satu fotografer.
//
// Satu baris per user, bukan riwayat pembayaran. Riwayatnya ada di redeem_codes
// dan di catatan transfer Anda sendiri; yang perlu dibaca setiap kali orang
// menekan tombol hanyalah "boleh atau tidak, dan sampai kapan".
type Subscription struct {
	UserID string `gorm:"type:uuid;primaryKey" json:"user_id"`
	Plan   string `gorm:"type:text;not null;default:'free'" json:"plan"`

	// Kapan langganan berakhir. nil berarti tidak pernah berakhir, dan itu
	// hanya berlaku untuk paket gratis.
	ExpiresAt *time.Time `gorm:"column:expires_at" json:"expires_at"`

	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

// Aktif melaporkan apakah langganan berbayar masih berlaku pada waktu tertentu.
//
// Waktunya diterima sebagai argumen, bukan diambil dari time.Now() di dalam:
// itu yang membuat perilaku di sekitar tanggal kedaluwarsa dapat diuji tanpa
// menunggu tanggalnya tiba.
func (s Subscription) Aktif(pada time.Time) bool {
	if s.Plan == "" || s.Plan == PlanFree {
		return false
	}
	if s.ExpiresAt == nil {
		return false
	}
	return s.ExpiresAt.After(pada)
}

// PlanEfektif mengembalikan paket yang benar-benar berlaku sekarang.
//
// Langganan yang lewat tanggal TIDAK diturunkan datanya di database — barisnya
// dibiarkan apa adanya supaya terlihat siapa yang pernah membayar dan kapan
// berhentinya. Penurunannya dihitung di sini, setiap kali dibaca.
func (s Subscription) PlanEfektif(pada time.Time) string {
	if s.Aktif(pada) {
		return s.Plan
	}
	return PlanFree
}

// KuotaBulanan mengembalikan batas galeri per bulan untuk paket yang berlaku.
// KuotaTakTerbatas berarti tanpa batas.
func (s Subscription) KuotaBulanan(pada time.Time) int {
	kuota, ada := kuotaBulanan[s.PlanEfektif(pada)]
	if !ada {
		// Paket tak dikenal diperlakukan sebagai gratis. Data yang rusak tidak
		// boleh berubah jadi akses tanpa batas.
		return kuotaBulanan[PlanFree]
	}
	return kuota
}

// BolehTanpaMerek melaporkan apakah galeri klien boleh tampil tanpa merek
// PhotoFlow, yaitu memakai nama studio fotografernya sendiri.
//
// Ini pembeda utama paket gratis, dan sengaja bukan sekadar pembatas jumlah.
// Batas jumlah dapat direset dengan membuat akun baru; merek tidak. Fotografer
// yang ingin kliennya melihat nama studionya sendiri harus membayar, berapa pun
// akun yang ia buat.
//
// Efek sampingnya diinginkan: setiap galeri gratis memperkenalkan PhotoFlow
// kepada klien fotografer itu.
func (s Subscription) BolehTanpaMerek(pada time.Time) bool {
	return s.Aktif(pada)
}

// UsageCounter menghitung galeri yang dibuat satu user dalam satu bulan.
//
// Penghitung ini HANYA NAIK. Menghapus project tidak mengembalikan kuota, dan
// itu bukan kekakuan melainkan satu-satunya yang membuat batasnya berarti:
// kalau menghapus mengembalikan jatah, siapa pun bisa memakai galeri tanpa
// batas dengan cara membuat, mengirim, lalu menghapus.
type UsageCounter struct {
	UserID string `gorm:"type:uuid;primaryKey" json:"user_id"`

	// Bulan dalam bentuk "2006-01", menurut waktu Indonesia Barat. Lihat
	// PeriodeSekarang untuk alasan zona waktunya.
	Period string `gorm:"type:text;primaryKey" json:"period"`

	Galleries int       `gorm:"not null;default:0" json:"galleries"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

// wib adalah zona waktu Indonesia Barat sebagai offset tetap.
//
// Ditulis sebagai offset, bukan lewat time.LoadLocation("Asia/Jakarta"), karena
// basis data zona waktu tidak dijamin ada di lingkungan serverless. Offset
// tetap tidak punya ketergantungan itu, dan WIB memang tidak mengenal waktu
// musim panas sehingga tidak ada yang hilang.
var wib = time.FixedZone("WIB", 7*60*60)

// PeriodeSekarang mengembalikan penanda bulan untuk penghitung kuota.
//
// Memakai waktu Indonesia, bukan UTC. Kalau UTC yang dipakai, kuota bulanan
// akan berganti pada pukul 07:00 pagi WIB — di tengah hari kerja fotografer —
// dan orang yang membuat galeri pada 30 Agustus malam akan melihatnya terhitung
// sebagai September.
func PeriodeSekarang(pada time.Time) string {
	return pada.In(wib).Format("2006-01")
}

// RedeemCode adalah kode yang menukar pembayaran jadi langganan aktif.
//
// Ada supaya aktivasi tidak menuntut Anda online. Pembeli mentransfer, menerima
// kode lewat WhatsApp, lalu menebusnya sendiri pukul dua pagi tanpa menunggu
// siapa pun. Kode juga dapat dititipkan ke reseller atau dibagikan sebagai
// promo tanpa memberi mereka akses ke halaman admin.
type RedeemCode struct {
	Code string `gorm:"type:text;primaryKey" json:"code"`
	Plan string `gorm:"type:text;not null" json:"plan"`

	// Berapa bulan langganan yang diberikan kode ini.
	//
	// Promo dinyatakan di sini, bukan sebagai potongan harga: paket perintis
	// "bayar 6 bulan, aktif 9 bulan" adalah kode dengan Months = 9. Harga
	// daftarnya tidak pernah ikut turun, jadi tidak ada kejutan saat
	// perpanjangan berikutnya.
	Months int `gorm:"not null" json:"months"`

	// Catatan bebas untuk Anda sendiri: nomor transfer, nama pembeli, atau
	// nama promo. Tidak pernah ditampilkan ke penebus.
	Note string `gorm:"type:text" json:"note"`

	UsedBy *string    `gorm:"type:uuid" json:"used_by"`
	UsedAt *time.Time `json:"used_at"`

	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
}

// Terpakai melaporkan apakah kode sudah pernah ditebus.
func (r RedeemCode) Terpakai() bool { return r.UsedAt != nil }
