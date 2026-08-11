"""Tes pencocokan pilihan klien ke berkas di komputer.

Ini inti aplikasi desktop: klien memilih dari JPG di Google Drive, yang
dibutuhkan fotografer adalah RAW di komputernya, dan yang menghubungkan
keduanya hanyalah nama dasarnya.

Versi sebelumnya menyalin sambil menelusuri folder — berkas pertama yang nama
dasarnya cocok langsung disalin. Karena JPG hasil konversi bernama persis sama
dengan RAW-nya, keduanya sama-sama cocok, dan yang menang ditentukan urutan
`os.walk`: urutan filesystem, bukan abjad, dan tidak sama antar komputer. Tes
pertama di berkas ini menjaga supaya keadaan itu tidak kembali.

`main.py` mengimpor eel, Pillow, dan rawpy di tingkat modul, jadi modul beratnya
diganti stub — cara yang sama dipakai tests/test_updates.py.
"""

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _load_main_with_stubs():
    heavy = [
        "eel", "PIL", "PIL.Image", "rawpy", "supabase", "bottle",
        "googleapiclient", "googleapiclient.discovery", "googleapiclient.http",
        "google", "google.oauth2", "google.oauth2.credentials",
    ]
    stubs = {name: mock.MagicMock() for name in heavy}
    stubs["supabase"].Client = object
    stubs["eel"].expose = lambda fn: fn
    with mock.patch.dict(sys.modules, stubs):
        import importlib
        return importlib.import_module("main")


main = _load_main_with_stubs()


def buat_pohon(akar, berkas):
    """Buat berkas kosong sesuai daftar path relatif."""
    for relatif in berkas:
        penuh = os.path.join(akar, relatif)
        os.makedirs(os.path.dirname(penuh), exist_ok=True)
        with open(penuh, "wb") as f:
            f.write(b"x")


class PencocokanTest(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmp = tempfile.TemporaryDirectory()
        self.akar = self.tmp.name
        self.addCleanup(self.tmp.cleanup)
        main.buang_indeks_cache()

    def nama_hasil(self, hasil):
        return [os.path.basename(p) for p in hasil["paths"]]

    # ── Cacat yang memicu seluruh perubahan ini ──────────────────────

    def test_raw_menang_atas_jpg_bernama_sama(self):
        """Inti persoalannya.

        JPG hasil konversi bernama persis sama dengan RAW-nya, dan klien memilih
        dari JPG itu. Yang harus tersalin adalah RAW-nya.
        """
        buat_pohon(self.akar, ["kartu/IMG_1234.CR3", "ekspor/IMG_1234.jpg"])

        hasil = main.resolve_selection(["IMG_1234.jpg"], self.akar)

        self.assertEqual(self.nama_hasil(hasil), ["IMG_1234.CR3"])
        self.assertEqual(hasil["counts"]["matched"], 1)

    def test_hasilnya_tidak_bergantung_urutan_penelusuran(self):
        """Dulu pemenangnya ditentukan urutan os.walk.

        Diuji dengan membalik urutan yang dikembalikan os.walk: kalau kodenya
        masih menyalin sambil berjalan, hasilnya akan ikut berbalik.
        """
        buat_pohon(self.akar, ["a_ekspor/IMG_9.jpg", "z_kartu/IMG_9.NEF"])

        asli = os.walk

        def walk_terbalik(top, *a, **k):
            return [(r, d, sorted(f, reverse=True)) for r, d, f in reversed(list(asli(top, *a, **k)))]

        main.buang_indeks_cache()
        maju = main.resolve_selection(["IMG_9.jpg"], self.akar)
        main.buang_indeks_cache()
        with mock.patch("os.walk", walk_terbalik):
            mundur = main.resolve_selection(["IMG_9.jpg"], self.akar)

        self.assertEqual(self.nama_hasil(maju), ["IMG_9.NEF"])
        self.assertEqual(self.nama_hasil(mundur), ["IMG_9.NEF"])

    # ── Penggolongan ────────────────────────────────────────────────

    def test_jpg_tanpa_raw_dibedakan_dari_tidak_ada_sama_sekali(self):
        """Dua keadaan yang menuntut tindakan berbeda, jadi tidak boleh disatukan.

        "Ada JPG-nya tapi RAW-nya tidak" berarti arsip dan folder ekspor tidak
        sinkron. "Tidak ada sama sekali" berarti salah folder sumber.
        """
        buat_pohon(self.akar, ["ekspor/IMG_1.jpg", "kartu/IMG_2.CR3"])

        hasil = main.resolve_selection(["IMG_1.jpg", "IMG_2.jpg", "IMG_3.jpg"], self.akar)

        self.assertEqual(hasil["raw_absent"], ["IMG_1.jpg"])
        self.assertEqual(hasil["missing"], ["IMG_3.jpg"])
        self.assertEqual(self.nama_hasil(hasil), ["IMG_2.CR3"])

    def test_nama_kembar_di_dua_folder_dilaporkan_ambigu(self):
        """Dua kartu yang sama-sama mulai dari IMG_0001 itu keadaan biasa.

        Menebak salah satunya berarti fotografer mengedit foto yang keliru, dan
        tidak ada tanda apa pun bahwa itu terjadi.
        """
        buat_pohon(self.akar, ["kartu_a/IMG_0001.CR3", "kartu_b/IMG_0001.CR3"])

        hasil = main.resolve_selection(["IMG_0001.jpg"], self.akar)

        self.assertEqual(hasil["paths"], [])
        self.assertEqual(len(hasil["ambiguous"]), 1)
        self.assertEqual(len(hasil["ambiguous"][0]["paths"]), 2)

    def test_dua_ekstensi_raw_satu_folder_bukan_ambigu(self):
        """CR3 dan DNG berdampingan itu foto yang sama, bukan keraguan.

        Yang asli dari kamera didahulukan; DNG hampir selalu salinan konversi.
        """
        buat_pohon(self.akar, ["kartu/IMG_5.CR3", "kartu/IMG_5.DNG"])

        hasil = main.resolve_selection(["IMG_5.jpg"], self.akar)

        self.assertEqual(hasil["ambiguous"], [])
        self.assertEqual(self.nama_hasil(hasil), ["IMG_5.CR3"])

    # ── Mode ────────────────────────────────────────────────────────

    def test_mode_raw_jpg_membawa_pasangannya(self):
        buat_pohon(self.akar, ["kartu/IMG_7.ARW", "kartu/IMG_7.jpg"])

        hasil = main.resolve_selection(["IMG_7.jpg"], self.akar, prefer=main.PREFER_RAW_JPG)

        self.assertEqual(sorted(self.nama_hasil(hasil)), ["IMG_7.ARW", "IMG_7.jpg"])

    def test_mode_any_menerima_jpg_saat_raw_tak_ada(self):
        buat_pohon(self.akar, ["ekspor/IMG_8.jpg"])

        hasil = main.resolve_selection(["IMG_8.jpg"], self.akar, prefer=main.PREFER_ANY)

        self.assertEqual(self.nama_hasil(hasil), ["IMG_8.jpg"])
        self.assertEqual(hasil["raw_absent"], [])

    # ── Rincian yang mudah terlewat ─────────────────────────────────

    def test_ekstensi_boleh_beda_huruf_besar_kecil(self):
        buat_pohon(self.akar, ["kartu/img_11.cr3"])

        hasil = main.resolve_selection(["IMG_11.JPG"], self.akar)

        self.assertEqual(self.nama_hasil(hasil), ["img_11.cr3"])

    def test_nama_yang_diminta_dua_kali_hanya_disalin_sekali(self):
        buat_pohon(self.akar, ["kartu/IMG_12.CR3"])

        hasil = main.resolve_selection(["IMG_12.jpg", "IMG_12.JPEG"], self.akar)

        self.assertEqual(len(hasil["paths"]), 1)
        self.assertEqual(hasil["counts"]["requested"], 1)

    def test_berkas_tak_didukung_diabaikan(self):
        """Sidecar dan katalog berbagi nama dasar dengan fotonya."""
        buat_pohon(self.akar, ["kartu/IMG_13.CR3", "kartu/IMG_13.xmp", "kartu/IMG_13.txt"])

        hasil = main.resolve_selection(["IMG_13.jpg"], self.akar, prefer=main.PREFER_ANY)

        self.assertEqual(self.nama_hasil(hasil), ["IMG_13.CR3"])

    def test_daftar_kosong_bukan_kegagalan(self):
        buat_pohon(self.akar, ["kartu/IMG_14.CR3"])

        hasil = main.resolve_selection([], self.akar)

        self.assertEqual(hasil["paths"], [])
        self.assertEqual(hasil["counts"]["requested"], 0)

    def test_nama_kosong_dilewati(self):
        buat_pohon(self.akar, ["kartu/IMG_15.CR3"])

        hasil = main.resolve_selection(["", None, "IMG_15.jpg"], self.akar)

        self.assertEqual(self.nama_hasil(hasil), ["IMG_15.CR3"])

    # ── Cache ───────────────────────────────────────────────────────

    def test_penyalinan_tidak_boleh_memakai_indeks_basi(self):
        """Pratinjau boleh sedikit basi; yang benar-benar disalin tidak.

        Berkas yang baru ditambahkan setelah pratinjau harus ikut terlihat oleh
        pemanggilan tanpa cache.
        """
        buat_pohon(self.akar, ["kartu/IMG_16.CR3"])
        main.resolve_selection(["IMG_16.jpg"], self.akar, pakai_cache=True)

        buat_pohon(self.akar, ["kartu/IMG_17.CR3"])

        basi = main.resolve_selection(["IMG_17.jpg"], self.akar, pakai_cache=True)
        segar = main.resolve_selection(["IMG_17.jpg"], self.akar, pakai_cache=False)

        self.assertEqual(basi["missing"], ["IMG_17.jpg"])
        self.assertEqual(self.nama_hasil(segar), ["IMG_17.CR3"])

    def test_pindai_ulang_membuang_cache(self):
        buat_pohon(self.akar, ["kartu/IMG_18.CR3"])
        main.resolve_selection(["IMG_18.jpg"], self.akar, pakai_cache=True)

        buat_pohon(self.akar, ["kartu/IMG_19.CR3"])
        main.buang_indeks_cache()

        hasil = main.resolve_selection(["IMG_19.jpg"], self.akar, pakai_cache=True)
        self.assertEqual(self.nama_hasil(hasil), ["IMG_19.CR3"])


class DaftarEkstensiTest(unittest.TestCase):
    def test_semua_ekstensi_raw_ada_di_daftar_yang_didukung(self):
        """Kalau meleset, RAW-nya tidak akan pernah masuk indeks."""
        for ext in main.RAW_EXTENSIONS:
            self.assertIn(ext, main.SUPPORTED_EXTENSIONS, ext)

    def test_dng_didahulukan_paling_akhir(self):
        self.assertEqual(main.RAW_EXTENSIONS[-1], ".dng")


if __name__ == "__main__":
    unittest.main()
