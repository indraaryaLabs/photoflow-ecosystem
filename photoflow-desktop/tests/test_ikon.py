"""Tes berkas ikon aplikasi.

Ikon jendela pernah tertinggal satu generasi: lambang PhotoFlow sudah diganti
di layar masuk, bilah sisi, dan favicon aplikasi web, tapi `icon.ico` masih
memuat gambar rana kamera yang lama. Tidak ada yang menangkapnya karena ikon
adalah satu-satunya bagian antarmuka yang tidak pernah dirender oleh tes mana
pun -- ia hanya muncul di bilah judul sistem operasi.

Yang diperiksa di sini bukan kemiripan gambar, melainkan sifat-sifat yang
membedakan lambang sekarang dari ikon lama secara pasti: latar ikon lama putih,
latar ikon sekarang ash-800; dan `tools/buat_ikon.py` harus benar-benar
menghasilkan berkas yang sama dengan yang tersimpan di repo, supaya keduanya
tidak pernah berpisah.
"""

import os
import subprocess
import sys
import tempfile
import unittest

AKAR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASET = os.path.join(AKAR, "web", "assets")

try:
    from PIL import Image
    ADA_PILLOW = True
except ImportError:  # CI hanya memasang requirements-dev.txt
    ADA_PILLOW = False

ASH_800 = (33, 37, 41)
ASH_50 = (248, 249, 250)


def dekat(a, b, toleransi=6):
    return all(abs(x - y) <= toleransi for x, y in zip(a, b))


@unittest.skipUnless(ADA_PILLOW, "Pillow tidak terpasang")
class IkonTest(unittest.TestCase):
    def test_ico_punya_semua_ukuran_yang_dituntut_windows(self):
        with Image.open(os.path.join(ASET, "icon.ico")) as im:
            ukuran = {u for u, _ in im.info["sizes"]}
        # 16 dan 32 dipakai bilah judul dan bilah tugas; 256 dipakai tampilan
        # ikon besar di Explorer.
        self.assertTrue({16, 32, 48, 256}.issubset(ukuran), ukuran)

    def test_icns_punya_semua_ukuran_yang_dituntut_macos(self):
        with Image.open(os.path.join(ASET, "icon.icns")) as im:
            ukuran = {u for u, _, _ in im.info["sizes"]}
        self.assertTrue({16, 32, 128, 256, 512}.issubset(ukuran), ukuran)

    def test_latar_ikon_memakai_palet_sekarang(self):
        """Ikon rana yang lama berlatar putih; yang sekarang kotak ash-800."""
        with Image.open(os.path.join(ASET, "icon.ico")) as im:
            im.size = (256, 256)
            rgba = im.convert("RGBA")

        # Titik di dalam kotak tapi jauh dari lambangnya.
        for titik in ((40, 40), (216, 216), (40, 216)):
            piksel = rgba.getpixel(titik)
            self.assertEqual(piksel[3], 255, f"{titik} tembus pandang")
            self.assertTrue(dekat(piksel[:3], ASH_800), f"{titik} = {piksel}")

        # Sudut terluar harus tembus pandang: kotaknya bersudut tumpul, bukan
        # persegi penuh.
        self.assertLess(rgba.getpixel((1, 1))[3], 40)

    def test_lambangnya_terang_dan_cukup_menutup(self):
        with Image.open(os.path.join(ASET, "icon.ico")) as im:
            im.size = (256, 256)
            rgba = im.convert("RGBA")

        piksel = list(rgba.getdata())
        terang = sum(1 for p in piksel if p[3] > 200 and dekat(p[:3], ASH_50, 12))
        bagian = terang / len(piksel)
        # Angkanya dibatasi dua sisi. Terlalu sedikit berarti lambangnya gagal
        # tergambar; terlalu banyak berarti terang dan pekatnya tertukar --
        # kegagalan yang di layar terlihat sebagai ikon negatif, bukan kosong.
        self.assertGreater(bagian, 0.10, bagian)
        self.assertLess(bagian, 0.35, bagian)

    def test_berkas_di_repo_sama_dengan_keluaran_skripnya(self):
        """Ikon dan skrip pembuatnya tidak boleh berpisah.

        Kalau geometrinya diubah tapi skripnya lupa dijalankan -- atau
        sebaliknya -- yang terkirim ke pengguna adalah berkas yang tidak
        seorang pun pernah lihat.
        """
        alat = os.path.join(AKAR, "tools", "buat_ikon.py")
        with tempfile.TemporaryDirectory() as sementara:
            with open(alat, encoding="utf-8") as f:
                sumber = f.read()
            salinan = os.path.join(sementara, "buat_ikon.py")
            with open(salinan, "w", encoding="utf-8") as f:
                f.write(sumber.replace(
                    'TUJUAN = os.path.join(AKAR, "web", "assets")',
                    f'TUJUAN = {sementara!r}',
                ))
            subprocess.run([sys.executable, salinan], check=True,
                           capture_output=True, cwd=sementara)

            for nama in ("icon.ico", "icon.icns"):
                with open(os.path.join(ASET, nama), "rb") as f:
                    di_repo = f.read()
                with open(os.path.join(sementara, nama), "rb") as f:
                    dibuat_ulang = f.read()
                self.assertEqual(di_repo, dibuat_ulang,
                                 f"{nama} tidak cocok; jalankan tools/buat_ikon.py")


if __name__ == "__main__":
    unittest.main()
