"""Tes pemeriksa pembaruan.

`main.py` mengimpor eel, Pillow, dan rawpy di tingkat modul, jadi mengimpornya
di sini akan menuntut seluruh dependensi runtime terpasang hanya untuk menguji
satu fungsi. Yang diuji karena itu adalah salinan logikanya lewat pemanggilan
langsung ke fungsi tersebut, dengan modul beratnya diganti stub — cara yang
sama dipakai CI, yang hanya memasang requirements-dev.txt.
"""

import io
import json
import os
import sys
import unittest
import urllib.error
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402


def _load_main_with_stubs():
    """Impor main.py dengan dependensi berat diganti stub."""
    heavy = [
        "eel", "PIL", "PIL.Image", "rawpy", "supabase", "bottle",
        "googleapiclient", "googleapiclient.discovery", "googleapiclient.http",
        "google", "google.oauth2", "google.oauth2.credentials",
    ]
    stubs = {name: mock.MagicMock() for name in heavy}
    stubs["supabase"].Client = object
    # @eel.expose harus mengembalikan fungsi aslinya. Sebagai MagicMock, ia
    # menggantikan setiap fungsi yang didekorasinya dengan mock — dan tes akan
    # memanggil mock itu, bukan kode yang hendak diuji.
    stubs["eel"].expose = lambda fn: fn
    with mock.patch.dict(sys.modules, stubs):
        import importlib
        return importlib.import_module("main")


class CheckForUpdatesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.main = _load_main_with_stubs()

    def _urlopen(self, payload):
        response = mock.MagicMock()
        response.read.return_value = json.dumps(payload).encode()
        response.__enter__ = lambda s: s
        response.__exit__ = lambda *a: False
        return mock.patch("urllib.request.urlopen", return_value=response)

    def test_rilis_lebih_baru_dilaporkan(self):
        payload = {
            "tag_name": "v9.0.0",
            "assets": [
                {"name": "PhotoFlow-Windows.exe", "browser_download_url": "https://x/win.exe"},
                {"name": "PhotoFlow-macOS.dmg", "browser_download_url": "https://x/mac.dmg"},
            ],
        }
        with self._urlopen(payload):
            result = self.main.check_for_updates()

        self.assertIsNotNone(result)
        self.assertEqual(result["latest_version"], "9.0.0")
        # Berkas yang ditawarkan harus cocok dengan sistem yang berjalan.
        expected = "mac.dmg" if sys.platform == "darwin" else "win.exe"
        self.assertIn(expected, result["download_url"])

    def test_versi_sama_bukan_pembaruan(self):
        with self._urlopen({"tag_name": f"v{config.CURRENT_VERSION}"}):
            self.assertIsNone(self.main.check_for_updates())

    def test_versi_lebih_lama_bukan_pembaruan(self):
        with self._urlopen({"tag_name": "v0.1.0"}):
            self.assertIsNone(self.main.check_for_updates())

    def test_404_bukan_kegagalan(self):
        """Repo tanpa rilis mengembalikan 404, dan itu keadaan normal.

        Melaporkannya sebagai error membuat setiap kali aplikasi dibuka
        terlihat seperti ada yang rusak.
        """
        error = urllib.error.HTTPError(
            url="https://api.github.com/x", code=404, msg="Not Found",
            hdrs=None, fp=io.BytesIO(b"{}"),
        )
        buffer = io.StringIO()
        with mock.patch("urllib.request.urlopen", side_effect=error):
            with mock.patch("sys.stdout", buffer):
                self.assertIsNone(self.main.check_for_updates())

        printed = buffer.getvalue()
        self.assertIn("Belum ada rilis", printed)
        self.assertNotIn("failed", printed.lower())

    def test_gagal_jaringan_tidak_melempar(self):
        with mock.patch("urllib.request.urlopen", side_effect=OSError("network down")):
            self.assertIsNone(self.main.check_for_updates())

    def test_manifes_sendiri_juga_diterima(self):
        payload = {"latest_version": "9.9.9", "download_url": "https://x/PhotoFlow.zip"}
        with self._urlopen(payload):
            result = self.main.check_for_updates()
        self.assertEqual(result["latest_version"], "9.9.9")
        self.assertEqual(result["download_url"], "https://x/PhotoFlow.zip")


if __name__ == "__main__":
    unittest.main()
