package models_test

import (
	"encoding/json"
	"testing"

	"photoflow-backend/models"
)

// TestGalleryProjectHanyaMemuatKolomYangDipakaiKlien menjaga bentuk respons
// GET /api/p/:magic_link.
//
// Rute itu publik: siapa pun yang memegang magic link membacanya. Sebelumnya
// ia mengembalikan baris Project apa adanya, sehingga `user_id`,
// `drive_folder_id`, `magic_link_token`, dan `client_whats_app` ikut terkirim.
// Yang terakhir adalah nomor telepon orang lain, dan halaman galeri tidak
// pernah memakainya.
//
// Tes ini memeriksa daftar kunci JSON secara persis, bukan sekadar
// "tidak ada nomor telepon". Menambah kolom baru ke Project karena itu tidak
// bisa membocorkannya diam-diam: tesnya akan gagal lebih dulu kalau kolom itu
// ikut muncul di sini.
func TestGalleryProjectHanyaMemuatKolomYangDipakaiKlien(t *testing.T) {
	project := models.Project{
		ID:             "11111111-1111-1111-1111-111111111111",
		UserID:         "22222222-2222-2222-2222-222222222222",
		ProjectName:    "Prewedding Rina & Anton",
		ClientName:     "Rina & Anton",
		MaxSelections:  12,
		DriveFolderURL: "https://drive.google.com/drive/folders/RAHASIA",
		DriveFolderID:  "RAHASIA",
		MagicLinkToken: "fb0bd309058553e34dbe46f19f04a405",
		AdminWhatsApp:  "6281234567890",
		ClientWhatsApp: "6289876543210",
		Status:         "pending",
	}

	raw, err := json.Marshal(models.NewGalleryProject(project, "Studio Cahaya"))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var keluar map[string]any
	if err := json.Unmarshal(raw, &keluar); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	diharapkan := map[string]any{
		"project_name":   "Prewedding Rina & Anton",
		"client_name":    "Rina & Anton",
		"max_selections": float64(12),
		"status":         "pending",
		"admin_whatsapp": "6281234567890",
		"studio_name":    "Studio Cahaya",
	}

	for key, nilai := range diharapkan {
		got, ada := keluar[key]
		if !ada {
			t.Errorf("kunci %q hilang; halaman galeri membutuhkannya", key)
			continue
		}
		if got != nilai {
			t.Errorf("kunci %q = %v, ingin %v", key, got, nilai)
		}
	}

	for key := range keluar {
		if _, boleh := diharapkan[key]; !boleh {
			t.Errorf("kunci %q ikut terkirim ke klien padahal tidak diharapkan", key)
		}
	}
}

// TestGalleryPhotosDoNotLeakClientPicks menjaga bentuk salinan foto.
//
// `is_selected` sengaja tidak ikut. Pada galeri yang belum disubmit nilainya
// selalu false sehingga tidak berguna, dan pada galeri yang sudah disubmit ia
// memberi tahu siapa pun yang membuka tautannya foto mana yang dipilih klien.
func TestGalleryPhotosDoNotLeakClientPicks(t *testing.T) {
	photos := []models.Photo{
		{
			ID:           "33333333-3333-3333-3333-333333333333",
			ProjectID:    "11111111-1111-1111-1111-111111111111",
			FileName:     "DSC_0431.ARW",
			ThumbnailURL: "https://drive.google.com/thumbnail?id=abc&sz=w800",
			IsSelected:   true,
		},
	}

	raw, err := json.Marshal(models.NewGalleryPhotos(photos))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var keluar []map[string]any
	if err := json.Unmarshal(raw, &keluar); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(keluar) != 1 {
		t.Fatalf("jumlah foto = %d, ingin 1", len(keluar))
	}

	allowed := map[string]bool{"id": true, "file_name": true, "thumbnail_url": true}
	for key := range keluar[0] {
		if !allowed[key] {
			t.Errorf("kunci %q ikut terkirim ke klien padahal tidak diharapkan", key)
		}
	}
	for key := range allowed {
		if _, ada := keluar[0][key]; !ada {
			t.Errorf("kunci %q hilang; galeri klien membacanya", key)
		}
	}
}

// TestGalleryPhotosEmptyListStaysJSONArray memastikan galeri tanpa foto
// terkirim sebagai `[]`, bukan `null`.
//
// Frontend membaca `data.photos` dengan `.map()`; `null` di posisi itu
// membuat galeri gagal dirender alih-alih menampilkan keadaan kosong.
func TestGalleryPhotosEmptyListStaysJSONArray(t *testing.T) {
	raw, err := json.Marshal(models.NewGalleryPhotos(nil))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(raw) != "[]" {
		t.Errorf("daftar kosong = %s, ingin []", raw)
	}
}
