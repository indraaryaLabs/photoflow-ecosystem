"""
Pelaporan crash, dimuat saat dibutuhkan.

`sentry_sdk` menarik puluhan modul saat diimpor. Sebelumnya ia diimpor di
tingkat modul oleh main.py dan gdrive.py, jadi ongkosnya dibayar sebelum
jendela aplikasi muncul — pada peluncuran pertama di Windows, saat berkasnya
belum ada di cache sistem, itu berarti detik-detik yang dihabiskan menatap
layar kosong.

Di sini impornya terjadi di dalam `init()`, yang dipanggil dari thread latar
belakang setelah `eel.start()` berjalan. Sebelum itu — dan selamanya, kalau
DSN-nya dikosongkan — `capture()` tidak melakukan apa-apa dan tidak menarik
apa pun.
"""

_sentry = None


def init(dsn):
    """Nyalakan pelaporan crash. Tanpa DSN, seluruh modul tidak pernah dimuat."""
    global _sentry
    if not dsn:
        return False
    try:
        import sentry_sdk

        sentry_sdk.init(dsn=dsn, traces_sample_rate=1.0, profiles_sample_rate=1.0)
        _sentry = sentry_sdk
        return True
    except Exception as exc:
        print(f"[PhotoFlow] WARN  Sentry init failed (non-fatal): {exc}")
        return False


def capture(exc):
    """Laporkan sebuah exception. Diam saja kalau pelaporan tidak aktif.

    Fungsi ini tidak boleh melempar: ia dipanggil dari dalam blok `except`,
    dan kegagalan di sini akan menutupi kesalahan yang sedang ditangani.
    """
    if _sentry is None:
        return
    try:
        _sentry.capture_exception(exc)
    except Exception:
        pass


def is_active():
    return _sentry is not None
