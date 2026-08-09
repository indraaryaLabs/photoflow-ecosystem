"""Tes sesi login.

Tidak ada tes di sini yang menyentuh jaringan: `requests.post` diganti stub,
dan penyimpanan token diarahkan ke direktori sementara. Yang diuji adalah
keputusan yang dibuat auth.py sendiri — kapan token diperbarui, apa yang
disimpan, dan apa yang terjadi saat refresh token ditolak.
"""

import os
import stat
import sys
import threading
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from auth import AuthError, SessionExpired, SupabaseSession, TokenStore  # noqa: E402


class FakeResponse:
    def __init__(self, status_code, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


def token_payload(access="access-1", refresh="refresh-1", expires_in=3600, user_id="user-abc"):
    return {
        "access_token": access,
        "refresh_token": refresh,
        "expires_in": expires_in,
        "expires_at": time.time() + expires_in,
        "user": {"id": user_id, "email": "foto@example.com"},
    }


class MemoryStore:
    """TokenStore in-memory, supaya tes tidak menyentuh keyring maupun disk."""

    def __init__(self):
        self.data = None

    def save(self, data):
        self.data = dict(data)

    def load(self):
        return dict(self.data) if self.data else None

    def clear(self):
        self.data = None


class SignInTest(unittest.TestCase):
    def setUp(self):
        self.store = MemoryStore()
        self.session = SupabaseSession(
            base_url="https://example.supabase.co",
            anon_key="anon-key",
            store=self.store,
        )

    def test_sign_in_menyimpan_refresh_token_dan_identitas(self):
        with mock.patch("auth.requests.post", return_value=FakeResponse(200, token_payload())) as post:
            result = self.session.sign_in("foto@example.com", "rahasia")

        self.assertEqual(result["user_id"], "user-abc")
        self.assertEqual(self.session.user_id, "user-abc")
        self.assertTrue(self.session.is_signed_in())

        # Yang disimpan hanya refresh token dan identitas. Password tidak boleh
        # ikut, dan access token tidak perlu — ia selalu bisa dibuat ulang.
        self.assertEqual(self.store.data["refresh_token"], "refresh-1")
        self.assertNotIn("password", self.store.data)
        self.assertNotIn("access_token", self.store.data)

        # Password dikirim ke Supabase, bukan ke backend PhotoFlow.
        url = post.call_args[0][0]
        self.assertIn("example.supabase.co/auth/v1/token", url)
        self.assertIn("grant_type=password", url)
        self.assertEqual(post.call_args.kwargs["headers"]["apikey"], "anon-key")

    def test_kredensial_salah_jadi_session_expired(self):
        body = {"error_description": "Invalid login credentials"}
        with mock.patch("auth.requests.post", return_value=FakeResponse(400, body)):
            with self.assertRaises(SessionExpired):
                self.session.sign_in("foto@example.com", "salah")

    def test_error_server_bukan_session_expired(self):
        with mock.patch("auth.requests.post", return_value=FakeResponse(500, None, "boom")):
            with self.assertRaises(AuthError) as ctx:
                self.session.sign_in("foto@example.com", "rahasia")
        self.assertNotIsInstance(ctx.exception, SessionExpired)


class AccessTokenTest(unittest.TestCase):
    def setUp(self):
        self.store = MemoryStore()
        self.session = SupabaseSession(
            base_url="https://example.supabase.co",
            anon_key="anon-key",
            store=self.store,
        )
        with mock.patch("auth.requests.post", return_value=FakeResponse(200, token_payload())):
            self.session.sign_in("foto@example.com", "rahasia")

    def test_token_masih_segar_tidak_memicu_refresh(self):
        with mock.patch("auth.requests.post") as post:
            self.assertEqual(self.session.access_token(), "access-1")
        post.assert_not_called()

    def test_token_hampir_kedaluwarsa_diperbarui_sebelum_dipakai(self):
        # Sisa umur 30 detik: di bawah margin, jadi harus diperbarui walaupun
        # secara teknis belum kedaluwarsa. Tanpa margin, token bisa mati di
        # tengah perjalanan request yang sudah terbang.
        self.session._expires_at = time.time() + 30

        payload = token_payload(access="access-2", refresh="refresh-2")
        with mock.patch("auth.requests.post", return_value=FakeResponse(200, payload)) as post:
            self.assertEqual(self.session.access_token(), "access-2")

        self.assertIn("grant_type=refresh_token", post.call_args[0][0])
        # Supabase memutar refresh token setiap dipakai; yang baru harus ikut
        # tersimpan, kalau tidak sesi berikutnya memegang token yang dibatalkan.
        self.assertEqual(self.store.data["refresh_token"], "refresh-2")

    def test_refresh_bersamaan_hanya_sekali(self):
        """Dua thread yang sama-sama mendapati token kedaluwarsa.

        Tanpa kunci, keduanya menukar refresh token yang sama. Supabase
        membatalkan refresh token begitu dipakai, jadi yang kalah cepat akan
        memegang token mati — kegagalannya baru muncul jauh setelahnya.
        """
        self.session._expires_at = time.time() - 1
        calls = []

        def slow_post(*args, **kwargs):
            calls.append(args[0])
            time.sleep(0.05)
            return FakeResponse(200, token_payload(access="access-2", refresh="refresh-2"))

        results = []
        with mock.patch("auth.requests.post", side_effect=slow_post):
            threads = [
                threading.Thread(target=lambda: results.append(self.session.access_token()))
                for _ in range(4)
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

        self.assertEqual(len(calls), 1, "refresh token ditukar lebih dari sekali")
        self.assertEqual(results, ["access-2"] * 4)

    def test_belum_login_menolak_memberi_token(self):
        self.session.sign_out()
        with self.assertRaises(SessionExpired):
            self.session.access_token()


class RestoreTest(unittest.TestCase):
    def setUp(self):
        self.store = MemoryStore()
        self.store.save({"refresh_token": "refresh-lama", "user_id": "user-abc", "email": "a@b.c"})
        self.session = SupabaseSession(
            base_url="https://example.supabase.co",
            anon_key="anon-key",
            store=self.store,
        )

    def test_restore_menukar_refresh_token_tanpa_password(self):
        payload = token_payload(access="access-baru", refresh="refresh-baru")
        with mock.patch("auth.requests.post", return_value=FakeResponse(200, payload)) as post:
            self.assertTrue(self.session.restore())

        self.assertEqual(self.session.access_token(), "access-baru")
        body = post.call_args.kwargs["json"]
        self.assertEqual(body, {"refresh_token": "refresh-lama"})
        self.assertNotIn("password", body)

    def test_refresh_token_ditolak_membuang_sesi_tersimpan(self):
        # Kalau token mati dibiarkan tersimpan, setiap kali aplikasi dibuka ia
        # akan mengulangi permintaan yang sudah pasti gagal.
        with mock.patch("auth.requests.post", return_value=FakeResponse(401, {"msg": "invalid"})):
            self.assertFalse(self.session.restore())

        self.assertIsNone(self.store.load())
        self.assertFalse(self.session.is_signed_in())

    def test_gagal_jaringan_mempertahankan_sesi(self):
        # Jaringan mati bukan alasan membuang sesi: user offline masih harus
        # dikenali aplikasi saat koneksi kembali.
        import requests as real_requests

        with mock.patch("auth.requests.post", side_effect=real_requests.exceptions.ConnectionError()):
            with self.assertRaises(real_requests.exceptions.ConnectionError):
                self.session.restore()

        self.assertIsNotNone(self.store.load())


class TokenStoreFallbackTest(unittest.TestCase):
    """Jalur cadangan saat keyring OS tidak tersedia."""

    def setUp(self):
        import tempfile

        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "nested", "session.json")

    def test_berkas_dibuat_hanya_untuk_pemiliknya(self):
        with mock.patch("auth._keyring", return_value=None):
            store = TokenStore(fallback_path=self.path)
            store.save({"refresh_token": "abc", "user_id": "u1"})

        mode = stat.S_IMODE(os.stat(self.path).st_mode)
        self.assertEqual(mode, 0o600, f"izin berkas {oct(mode)}, bukan 0600")
        self.assertEqual(store.load()["refresh_token"], "abc")

    def test_clear_menghapus_berkas(self):
        with mock.patch("auth._keyring", return_value=None):
            store = TokenStore(fallback_path=self.path)
            store.save({"refresh_token": "abc"})
            store.clear()

        self.assertFalse(os.path.exists(self.path))
        self.assertIsNone(store.load())

    def test_keyring_dipakai_lebih_dulu_kalau_ada(self):
        fake_keyring = mock.MagicMock()
        fake_keyring.get_password.return_value = '{"refresh_token": "dari-keyring"}'

        with mock.patch("auth._keyring", return_value=fake_keyring):
            store = TokenStore(fallback_path=self.path)
            store.save({"refresh_token": "abc"})
            loaded = store.load()

        fake_keyring.set_password.assert_called_once()
        self.assertEqual(loaded["refresh_token"], "dari-keyring")
        self.assertFalse(os.path.exists(self.path), "berkas cadangan ditulis padahal keyring ada")


if __name__ == "__main__":
    unittest.main()
