"""Tes perbandingan versi.

Versi sebelumnya membandingkan versi sebagai string. Tes pertama di bawah ini
adalah kasus yang membuat cara itu salah diam-diam.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402


class VersionCompareTest(unittest.TestCase):
    def test_komponen_dua_digit_lebih_besar_dari_satu_digit(self):
        # Perbandingan string menjawab False di sini, karena karakter "1"
        # lebih kecil dari "9" — sehingga rilis 1.10 tidak akan pernah
        # terdeteksi sebagai pembaruan atas 1.9.
        self.assertTrue(config.is_newer("1.10.0", "1.9.0"))
        self.assertFalse(config.is_newer("1.9.0", "1.10.0"))

    def test_versi_sama_bukan_pembaruan(self):
        self.assertFalse(config.is_newer("1.1.0", "1.1.0"))

    def test_awalan_v_diabaikan(self):
        self.assertFalse(config.is_newer("v1.1.0", "1.1.0"))
        self.assertTrue(config.is_newer("v1.2.0", "1.1.0"))

    def test_panjang_komponen_berbeda(self):
        self.assertTrue(config.is_newer("2.0", "1.99.99"))
        self.assertFalse(config.is_newer("1.1", "1.1.0"))
        self.assertTrue(config.is_newer("1.1.1", "1.1"))

    def test_suffix_pra_rilis_diabaikan(self):
        self.assertFalse(config.is_newer("1.1.0-beta.2", "1.1.0"))
        self.assertTrue(config.is_newer("1.2.0-beta.1", "1.1.0"))

    def test_masukan_rusak_tidak_melempar(self):
        self.assertFalse(config.is_newer("", "1.1.0"))
        self.assertFalse(config.is_newer(None, "1.1.0"))
        self.assertFalse(config.is_newer("bukan-versi", "1.1.0"))

    def test_parse_version(self):
        self.assertEqual(config.parse_version("1.10.2"), (1, 10, 2))
        self.assertEqual(config.parse_version("v2.0"), (2, 0))


if __name__ == "__main__":
    unittest.main()
