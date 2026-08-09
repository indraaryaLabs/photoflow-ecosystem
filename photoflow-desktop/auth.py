"""
PhotoFlow Desktop — sesi login.

Aplikasi ini dulu login lewat `POST /api/login-desktop` di backend PhotoFlow.
Rute itu sudah dihapus (FINDINGS.md F-04): ia query langsung ke tabel
`auth.users` milik Supabase dan membandingkan hash bcrypt sendiri — menembus
lapisan Auth yang seharusnya jadi satu-satunya pintu — lalu mengembalikan token
buatan sendiri yang tidak pernah diverifikasi di mana pun.

Penggantinya adalah alur yang dipakai dashboard web: login langsung ke Supabase
Auth, pegang access token beserta refresh token-nya, dan bawa access token itu
sebagai `Authorization: Bearer` ke backend. Dua akibatnya:

  * password tidak pernah melewati backend PhotoFlow sama sekali, dan
  * token yang dibawa desktop app adalah JWT yang sama dengan yang diverifikasi
    middleware backend ke JWKS Supabase — bukan token dekoratif.

Access token Supabase berumur satu jam. Karena satu sesi memanen bisa berjalan
lebih lama dari itu, token diperbarui sendiri di sini: setiap pemanggil cukup
meminta `access_token()` dan mendapat token yang masih berlaku.
"""

import json
import os
import stat
import threading
import time

import requests

import config

# Nama layanan untuk keyring OS. Konstan supaya sesi lama tetap ketemu setelah
# aplikasi diperbarui.
_KEYRING_SERVICE = "PhotoFlow Desktop"
_KEYRING_USER = "supabase-session"

# Sisa umur minimum sebelum token dianggap perlu diperbarui. Diberi jeda supaya
# token tidak kedaluwarsa di tengah perjalanan request yang sudah terbang.
_REFRESH_MARGIN_SECONDS = 120

_TIMEOUT = 15


class AuthError(Exception):
    """Login gagal atau sesi tidak dapat dipulihkan."""


class SessionExpired(AuthError):
    """Refresh token ditolak. User harus login ulang."""


def _keyring():
    """Kembalikan modul keyring kalau ada backend yang benar-benar bisa dipakai.

    keyring terpasang di banyak sistem tapi tidak selalu punya backend nyata;
    pada mesin tanpa keychain ia memuat `fail.Keyring` yang melempar begitu
    dipakai. Deteksinya harus di sini, bukan saat menyimpan, supaya kegagalan
    tidak muncul pertama kali di tengah alur login.
    """
    try:
        import keyring
        from keyring.backends import fail

        if isinstance(keyring.get_keyring(), fail.Keyring):
            return None
        return keyring
    except Exception:
        return None


class TokenStore:
    """Penyimpanan refresh token.

    Utamanya keyring milik OS (Keychain di macOS, Credential Manager di
    Windows). Kalau tidak ada backend yang bisa dipakai — lazim di Linux tanpa
    desktop environment — token jatuh ke berkas di home directory dengan izin
    0600. Berkas itu memang lebih lemah daripada keychain, jadi jalur cadangan
    ini mengumumkan dirinya di log alih-alih diam.
    """

    def __init__(self, fallback_path=None):
        self._keyring = _keyring()
        self._path = fallback_path or os.path.join(
            os.path.expanduser("~"), ".photoflow", "session.json"
        )
        if self._keyring is None:
            print(
                "[PhotoFlow] ⚠ Keyring OS tidak tersedia. Sesi disimpan di "
                f"{self._path} dengan izin 0600."
            )

    def save(self, data):
        payload = json.dumps(data)
        if self._keyring is not None:
            try:
                self._keyring.set_password(_KEYRING_SERVICE, _KEYRING_USER, payload)
                return
            except Exception as exc:
                print(f"[PhotoFlow] ⚠ Gagal menulis ke keyring: {exc}")

        os.makedirs(os.path.dirname(self._path), exist_ok=True)
        # Berkas dibuat lewat os.open supaya izinnya sudah 0600 sejak detik
        # pertama; menulis dulu lalu chmod menyisakan jendela saat berkas
        # sempat terbaca proses lain.
        flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
        fd = os.open(self._path, flags, stat.S_IRUSR | stat.S_IWUSR)
        with os.fdopen(fd, "w") as handle:
            handle.write(payload)

    def load(self):
        if self._keyring is not None:
            try:
                raw = self._keyring.get_password(_KEYRING_SERVICE, _KEYRING_USER)
                if raw:
                    return json.loads(raw)
            except Exception as exc:
                print(f"[PhotoFlow] ⚠ Gagal membaca keyring: {exc}")

        try:
            with open(self._path, "r") as handle:
                return json.loads(handle.read())
        except (OSError, ValueError):
            return None

    def clear(self):
        if self._keyring is not None:
            try:
                self._keyring.delete_password(_KEYRING_SERVICE, _KEYRING_USER)
            except Exception:
                pass
        try:
            os.remove(self._path)
        except OSError:
            pass


class SupabaseSession:
    """Sesi Supabase Auth beserta pembaruan token otomatis.

    Aman dipanggil dari banyak thread: Eel melayani setiap panggilan frontend di
    worker-nya sendiri, jadi dua permintaan Drive yang berbarengan bisa sama-sama
    mendapati token kedaluwarsa. Tanpa kunci, keduanya akan menukar refresh token
    yang sama — dan Supabase memutar refresh token setiap kali dipakai, sehingga
    yang kalah cepat memegang token yang sudah dibatalkan.
    """

    def __init__(self, base_url=None, anon_key=None, store=None):
        self._base_url = (base_url or config.SUPABASE_URL).rstrip("/")
        self._anon_key = anon_key or config.SUPABASE_ANON_KEY
        self._store = store if store is not None else TokenStore()
        self._lock = threading.RLock()

        self._access_token = None
        self._refresh_token = None
        self._expires_at = 0.0
        self._user_id = None
        self._email = None

    # ── Keadaan ────────────────────────────────────────────────

    @property
    def user_id(self):
        return self._user_id

    @property
    def email(self):
        return self._email

    @property
    def refresh_token(self):
        return self._refresh_token

    def is_signed_in(self):
        return bool(self._refresh_token)

    # ── HTTP ke Supabase Auth ──────────────────────────────────

    def _token_endpoint(self, grant_type):
        return f"{self._base_url}/auth/v1/token?grant_type={grant_type}"

    def _post_token(self, grant_type, payload):
        response = requests.post(
            self._token_endpoint(grant_type),
            json=payload,
            headers={
                "apikey": self._anon_key,
                "Content-Type": "application/json",
            },
            timeout=_TIMEOUT,
        )
        if response.status_code == 200:
            return response.json()

        detail = ""
        try:
            body = response.json()
            detail = body.get("error_description") or body.get("msg") or body.get("error") or ""
        except ValueError:
            detail = response.text[:200]

        if response.status_code in (400, 401, 403):
            raise SessionExpired(detail or "Kredensial ditolak Supabase Auth.")
        raise AuthError(detail or f"Supabase Auth mengembalikan HTTP {response.status_code}.")

    def _adopt(self, data):
        """Simpan hasil login atau refresh ke keadaan sesi dan ke penyimpanan."""
        self._access_token = data.get("access_token")
        self._refresh_token = data.get("refresh_token") or self._refresh_token

        # `expires_at` dari Supabase adalah epoch absolut; `expires_in` relatif.
        # Yang absolut lebih dipercaya karena tidak terpengaruh lamanya request.
        expires_at = data.get("expires_at")
        if expires_at:
            self._expires_at = float(expires_at)
        else:
            self._expires_at = time.time() + float(data.get("expires_in") or 3600)

        user = data.get("user") or {}
        self._user_id = user.get("id") or self._user_id
        self._email = user.get("email") or self._email

        self._store.save(
            {
                "refresh_token": self._refresh_token,
                "user_id": self._user_id,
                "email": self._email,
            }
        )

    # ── Operasi ────────────────────────────────────────────────

    def sign_in(self, email, password):
        """Login dengan email dan password. Password tidak disimpan di mana pun."""
        with self._lock:
            data = self._post_token(
                "password", {"email": email, "password": password}
            )
            self._adopt(data)
            return {
                "access_token": self._access_token,
                "user_id": self._user_id,
                "email": self._email,
            }

    def restore(self):
        """Pulihkan sesi tersimpan tanpa meminta password. False kalau tidak ada."""
        with self._lock:
            saved = self._store.load()
            if not saved or not saved.get("refresh_token"):
                return False
            self._refresh_token = saved["refresh_token"]
            self._user_id = saved.get("user_id")
            self._email = saved.get("email")
            try:
                self.refresh()
                return True
            except SessionExpired:
                # Refresh token sudah tidak berlaku — buang supaya percobaan
                # berikutnya tidak mengulangi kegagalan yang sama.
                self.sign_out()
                return False
            except AuthError:
                # Gagal karena jaringan, bukan karena tokennya ditolak. Sesi
                # dipertahankan supaya mode offline masih mengenali user.
                return False

    def refresh(self):
        with self._lock:
            if not self._refresh_token:
                raise SessionExpired("Tidak ada refresh token tersimpan.")
            data = self._post_token(
                "refresh_token", {"refresh_token": self._refresh_token}
            )
            self._adopt(data)
            return self._access_token

    def access_token(self, force_refresh=False):
        """Access token yang dijamin masih berlaku saat dikembalikan."""
        with self._lock:
            if not self._refresh_token:
                raise SessionExpired("Belum login.")
            expiring = time.time() >= (self._expires_at - _REFRESH_MARGIN_SECONDS)
            if force_refresh or not self._access_token or expiring:
                self.refresh()
            return self._access_token

    def sign_out(self):
        with self._lock:
            self._access_token = None
            self._refresh_token = None
            self._expires_at = 0.0
            self._user_id = None
            self._email = None
            self._store.clear()


# Satu sesi dipakai seluruh aplikasi.
session = SupabaseSession()


def access_token(force_refresh=False):
    return session.access_token(force_refresh=force_refresh)


def bearer_headers(force_refresh=False):
    return {"Authorization": f"Bearer {access_token(force_refresh)}"}
