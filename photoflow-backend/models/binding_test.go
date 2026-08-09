package models_test

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"photoflow-backend/models"
)

// bindJSON menjalankan body melalui binding gin persis seperti handler, lalu
// melaporkan apakah input diterima.
func bindJSON(t *testing.T, target any, body any) bool {
	t.Helper()

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())

	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("gagal menyusun body tes: %v", err)
	}
	c.Request = httptest.NewRequest("POST", "/", bytes.NewReader(raw))
	c.Request.Header.Set("Content-Type", "application/json")

	return c.ShouldBindJSON(target) == nil
}

func photo(driveID, fileName string) map[string]string {
	return map[string]string{"drive_id": driveID, "file_name": fileName}
}

func photos(n int) []any {
	out := make([]any, n)
	for i := range out {
		out[i] = photo("id", "foto.jpg")
	}
	return out
}

// validProject adalah field minimum yang membuat CreateProjectInput sah, dipakai
// sebagai dasar lalu ditimpa per kasus uji.
func validProject(overrides map[string]any) map[string]any {
	body := map[string]any{
		"project_name":     "Pemotretan",
		"client_name":      "Klien",
		"drive_folder_url": "https://drive.google.com/drive/folders/abc",
	}
	for k, v := range overrides {
		body[k] = v
	}
	return body
}

func TestCreateProjectInputLimits(t *testing.T) {
	cases := []struct {
		name     string
		body     map[string]any
		accepted bool
	}{
		{"minimal sah", validProject(nil), true},

		// 0 berarti "pakai default 50" di handler, jadi omitempty harus
		// membiarkannya lolos meski min=1.
		{"max_selections 0 dipakai sebagai penanda default", validProject(map[string]any{"max_selections": 0}), true},
		{"max_selections 1000 tepat di batas", validProject(map[string]any{"max_selections": 1000}), true},
		{"max_selections 1001 lewat batas", validProject(map[string]any{"max_selections": 1001}), false},

		{"whatsapp kosong dibolehkan", validProject(map[string]any{"client_whatsapp": ""}), true},
		{"whatsapp normal", validProject(map[string]any{"client_whatsapp": "628123456789"}), true},
		{"whatsapp berisi huruf", validProject(map[string]any{"client_whatsapp": "62abcdefghij"}), false},
		{"whatsapp terlalu pendek", validProject(map[string]any{"client_whatsapp": "62812"}), false},

		{"project_name 200 char tepat di batas", validProject(map[string]any{"project_name": strings.Repeat("a", 200)}), true},
		{"project_name 201 char lewat batas", validProject(map[string]any{"project_name": strings.Repeat("a", 201)}), false},
		{"client_name 201 char lewat batas", validProject(map[string]any{"client_name": strings.Repeat("a", 201)}), false},
		{"drive_folder_url 501 char lewat batas", validProject(map[string]any{"drive_folder_url": strings.Repeat("a", 501)}), false},

		{"project_name wajib ada", map[string]any{"client_name": "K", "drive_folder_url": "u"}, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var input models.CreateProjectInput
			if got := bindJSON(t, &input, tc.body); got != tc.accepted {
				t.Fatalf("diterima=%v, seharusnya %v", got, tc.accepted)
			}
		})
	}
}

func TestSubmitSelectionInputLimits(t *testing.T) {
	cases := []struct {
		name     string
		body     map[string]any
		accepted bool
	}{
		{"satu foto", map[string]any{"selected_photos": []any{photo("abc", "foto.jpg")}}, true},
		{"5000 foto tepat di batas", map[string]any{"selected_photos": photos(5000)}, true},
		{"5001 foto lewat batas", map[string]any{"selected_photos": photos(5001)}, false},

		{"file_name 500 char tepat di batas", map[string]any{
			"selected_photos": []any{photo("abc", strings.Repeat("a", 500))}}, true},
		{"file_name 501 char lewat batas", map[string]any{
			"selected_photos": []any{photo("abc", strings.Repeat("a", 501))}}, false},
		{"drive_id 201 char lewat batas", map[string]any{
			"selected_photos": []any{photo(strings.Repeat("a", 201), "foto.jpg")}}, false},

		// `required` pada slice tidak menolak array kosong, jadi binding tetap
		// meloloskannya. Penolakannya ada satu lapis di atas: handler submit
		// membalas 400 sebelum menyentuh database. Kasus ini mengunci pembagian
		// tugas itu — kalau mulai gagal, artinya perilaku binding berubah dan
		// penjagaan di handler perlu ditinjau ulang. Lihat F-10 di FINDINGS.md.
		{"array kosong lolos binding, ditolak handler (lihat F-10)", map[string]any{"selected_photos": []any{}}, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var input models.SubmitSelectionInput
			if got := bindJSON(t, &input, tc.body); got != tc.accepted {
				t.Fatalf("diterima=%v, seharusnya %v", got, tc.accepted)
			}
		})
	}
}
