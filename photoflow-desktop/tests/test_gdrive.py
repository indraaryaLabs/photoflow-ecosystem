"""Tes lapisan pengambilan access token Drive.

Yang diuji adalah cara gdrive.py menafsirkan jawaban backend: identitas apa
yang dikirim, kapan sebuah kegagalan berarti "hubungkan Drive" dan bukan
"login ulang", dan berapa kali percobaan ulang dilakukan.
"""

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import gdrive  # noqa: E402


class FakeResponse:
    def __init__(self, status_code, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


class FetchAccessTokenTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch("gdrive.auth.bearer_headers", return_value={"Authorization": "Bearer jwt-1"})
        self.bearer = patcher.start()
        self.addCleanup(patcher.stop)

    def test_hanya_authorization_yang_dikirim(self):
        """Tidak ada lagi X-User-ID.

        Backend mengambil identitas dari klaim `sub` JWT dan mengabaikan apa pun
        yang dikirim pemanggil. Header X-User-ID adalah sisa dari masa ketika
        identitas ditentukan pengirim; mengirimnya terus membuat pembaca kode
        mengira ia masih menentukan sesuatu.
        """
        with mock.patch("gdrive.requests.get", return_value=FakeResponse(200, {"access_token": "ya29.x"})) as get:
            token = gdrive._fetch_access_token()

        self.assertEqual(token, "ya29.x")
        headers = get.call_args.kwargs["headers"]
        self.assertEqual(headers, {"Authorization": "Bearer jwt-1"})
        self.assertNotIn("X-User-ID", headers)

    def test_409_jadi_drive_not_connected(self):
        payload = {"error": "drive_not_connected", "code": "drive_not_connected"}
        with mock.patch("gdrive.requests.get", return_value=FakeResponse(409, payload)):
            with self.assertRaises(gdrive.DriveNotConnected) as ctx:
                gdrive._fetch_access_token()
        self.assertEqual(ctx.exception.code, "drive_not_connected")

    def test_409_reconnect_membawa_kodenya_sendiri(self):
        payload = {"code": "drive_reconnect_required"}
        with mock.patch("gdrive.requests.get", return_value=FakeResponse(409, payload)):
            with self.assertRaises(gdrive.DriveNotConnected) as ctx:
                gdrive._fetch_access_token()
        self.assertEqual(ctx.exception.code, "drive_reconnect_required")

    def test_token_expired_dicoba_ulang_sekali_dengan_token_baru(self):
        responses = [
            FakeResponse(401, {"code": "token_expired"}),
            FakeResponse(200, {"access_token": "ya29.baru"}),
        ]
        with mock.patch("gdrive.requests.get", side_effect=responses):
            token = gdrive._fetch_access_token()

        self.assertEqual(token, "ya29.baru")
        # Percobaan pertama memakai token yang ada, percobaan kedua memaksa
        # sesi memperbarui JWT-nya lebih dulu.
        self.assertEqual([c.args[0] for c in self.bearer.call_args_list], [False, True])

    def test_token_expired_dua_kali_menyerah(self):
        """Percobaan ulang berhenti di satu kali.

        Kalau 401 tetap datang setelah JWT diperbarui, masalahnya bukan token
        yang basi — mengulanginya terus hanya menghasilkan lingkaran.
        """
        responses = [
            FakeResponse(401, {"code": "token_expired"}),
            FakeResponse(401, {"code": "token_expired"}),
        ]
        with mock.patch("gdrive.requests.get", side_effect=responses) as get:
            with self.assertRaises(PermissionError):
                gdrive._fetch_access_token()
        self.assertEqual(get.call_count, 2)

    def test_401_biasa_langsung_gagal(self):
        with mock.patch("gdrive.requests.get", return_value=FakeResponse(401, {"error": "unauthorized"})) as get:
            with self.assertRaises(PermissionError):
                gdrive._fetch_access_token()
        self.assertEqual(get.call_count, 1)

    def test_respons_200_tanpa_token_ditolak(self):
        with mock.patch("gdrive.requests.get", return_value=FakeResponse(200, {})):
            with self.assertRaises(ValueError):
                gdrive._fetch_access_token()


class UniquePathTest(unittest.TestCase):
    """Google Drive membolehkan nama ganda dalam satu folder, filesystem tidak."""

    def setUp(self):
        import tempfile

        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_nama_bebas_dipakai_apa_adanya(self):
        dest = gdrive._unique_path(self.tmp.name, "DSC_0001.ARW")
        self.assertEqual(dest, os.path.join(self.tmp.name, "DSC_0001.ARW"))

    def test_nama_bentrok_tidak_menimpa_berkas_yang_ada(self):
        first = os.path.join(self.tmp.name, "DSC_0001.ARW")
        open(first, "wb").close()

        second = gdrive._unique_path(self.tmp.name, "DSC_0001.ARW")
        self.assertEqual(second, os.path.join(self.tmp.name, "DSC_0001 (2).ARW"))

        open(second, "wb").close()
        third = gdrive._unique_path(self.tmp.name, "DSC_0001.ARW")
        self.assertEqual(third, os.path.join(self.tmp.name, "DSC_0001 (3).ARW"))


class BatchResultTest(unittest.TestCase):
    """Operasi massal harus melaporkan kegagalan per berkas, bukan menelannya."""

    def test_move_yang_gagal_tidak_dilaporkan_sukses(self):
        service = mock.MagicMock()
        service.files.return_value.update.return_value.execute.side_effect = [
            None,
            RuntimeError("403 insufficient permissions"),
        ]

        with mock.patch("gdrive.get_drive_service", return_value=service):
            result = gdrive.move_drive_files(["ok-1", "gagal-1"], "src", "dst")

        self.assertFalse(result["success"])
        self.assertEqual(result["moved"], 1)
        self.assertEqual(result["failed"], ["gagal-1"])

    def test_move_yang_semuanya_berhasil(self):
        service = mock.MagicMock()
        with mock.patch("gdrive.get_drive_service", return_value=service):
            result = gdrive.move_drive_files(["a", "b"], "src", "dst")

        self.assertTrue(result["success"])
        self.assertEqual(result["moved"], 2)
        self.assertEqual(result["failed"], [])


class SharedDriveTest(unittest.TestCase):
    """Setiap operasi Drive harus menyertakan supportsAllDrives.

    Tanpa parameter itu Google berpura-pura Drive Bersama tidak ada, dan
    caranya berpura-pura yang membuat bug ini mahal: listing mengembalikan
    daftar KOSONG, bukan error. Tidak ada yang gagal, tidak ada yang tercatat
    di log — foldernya sekadar tampak tidak berisi apa-apa. Studio ber-Workspace
    yang arsipnya memang tinggal di Drive Bersama akan melihat aplikasi ini
    seolah rusak tanpa satu pun petunjuk.

    Karena kegagalannya sunyi, tidak ada tes lain yang akan menangkapnya kalau
    parameter ini hilang lagi di kemudian hari.
    """

    def setUp(self):
        self.service = mock.MagicMock()
        patcher = mock.patch("gdrive.get_drive_service", return_value=self.service)
        patcher.start()
        self.addCleanup(patcher.stop)

    def kwargs_terakhir(self, metode):
        return getattr(self.service.files.return_value, metode).call_args.kwargs

    def test_listing_memasukkan_isi_drive_bersama(self):
        self.service.files.return_value.list.return_value.execute.return_value = {}

        for panggil in (gdrive.list_files, gdrive.list_folders_only):
            with self.subTest(fungsi=panggil.__name__):
                panggil("folder-1")
                kwargs = self.kwargs_terakhir("list")
                self.assertTrue(kwargs.get("supportsAllDrives"))
                # supportsAllDrives sendirian tidak mengubah apa pun pada
                # Files.List; yang benar-benar memasukkan isinya yang ini.
                self.assertTrue(kwargs.get("includeItemsFromAllDrives"))

    def test_operasi_per_berkas_mengenali_drive_bersama(self):
        gdrive.rename_drive_item("berkas-1", "nama baru")
        self.assertTrue(self.kwargs_terakhir("update").get("supportsAllDrives"))

        gdrive.create_drive_folder("Pilihan Klien", "induk-1")
        self.assertTrue(self.kwargs_terakhir("create").get("supportsAllDrives"))

        gdrive.move_drive_files(["berkas-1"], "asal", "tujuan")
        self.assertTrue(self.kwargs_terakhir("update").get("supportsAllDrives"))

        gdrive.copy_drive_files(["berkas-1"], "tujuan")
        self.assertTrue(self.kwargs_terakhir("copy").get("supportsAllDrives"))
        self.assertTrue(self.kwargs_terakhir("get").get("supportsAllDrives"))

        gdrive.trash_drive_files(["berkas-1"])
        self.assertTrue(self.kwargs_terakhir("update").get("supportsAllDrives"))


if __name__ == "__main__":
    unittest.main()
