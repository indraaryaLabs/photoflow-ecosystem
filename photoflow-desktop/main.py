"""
PhotoFlow — mesin aplikasi desktop
==================================

Aplikasi ini adalah ujung terakhir alur PhotoFlow. Klien memilih fotonya di web
portal; di sini fotografer mengambil daftar pilihan itu, mencocokkannya dengan
berkas RAW di penyimpanan lokalnya, dan mengumpulkannya ke satu folder siap
edit. Selebihnya adalah alat bantu di sekitar pekerjaan itu: penjelajah Drive
dua arah, pratinjau RAW, dan operasi berkas massal.

Jembatan Python ↔ JavaScript memakai Eel: antarmukanya HTML/CSS/JS biasa yang
dijalankan di jendela Chromium, sedangkan seluruh akses berkas, decode RAW, dan
panggilan jaringan terjadi di proses Python ini.

Autentikasi berjalan langsung ke Supabase Auth (lihat auth.py), bukan lewat
backend PhotoFlow. Tidak ada berkas kredensial yang perlu disiapkan; refresh
token disimpan di keyring milik sistem operasi.

Menjalankan:
    python main.py
"""

import eel
import os
import sys
import shutil
import subprocess

# Fix console encoding for Unicode characters (✓, ✗, etc.)
# In PyInstaller --windowed mode on macOS, sys.stdout/stderr may be replaced
# by a NullWriter or dummy object that lacks .reconfigure(). Guard with hasattr().
def _safe_reconfigure_stream(stream):
    """Reconfigure stream encoding if the stream object supports it."""
    if stream is not None and hasattr(stream, 'reconfigure'):
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass  # Stream does not support reconfiguration (e.g. frozen binary)

_safe_reconfigure_stream(sys.stdout)
_safe_reconfigure_stream(sys.stderr)
import platform
import base64
import io
from pathlib import Path
# tkinter is imported lazily inside _choose_folder_fallback() to avoid
# unnecessary Cocoa framework initialization on macOS.
from PIL import Image
import hashlib
import threading
import concurrent.futures
import rawpy
import sentry_sdk
import urllib.request
import json
import webbrowser
import requests
import socket
from supabase import create_client, Client

import auth
import config
import gdrive
from auth import AuthError, SessionExpired

CURRENT_VERSION = config.CURRENT_VERSION
UPDATE_URL = config.UPDATE_URL
BACKEND_URL = config.BACKEND_URL
SUPABASE_URL = config.SUPABASE_URL
SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY

# ── Global State ────────────────────────────────────────────
# Default to offline until the background bootstrap confirms connectivity.
# All @eel.expose functions already null-check supabase_client before use.
is_offline = True
supabase_client: Client = None
_safari_fallback: bool = False
_startup_complete: bool = False


def current_user_id():
    """User id sesi yang sedang berjalan.

    Identitas selalu diambil dari sesi Supabase di proses ini, tidak pernah
    dari argumen yang dikirim frontend. Beberapa fungsi @eel.expose masih
    menerima parameter `user_id` demi kompatibilitas dengan pemanggil lama di
    script.js; nilainya sengaja diabaikan.
    """
    return auth.session.user_id


def _attach_supabase_session():
    """Pasang token sesi ke klien Supabase supaya query tunduk pada RLS.

    Tanpa ini klien berjalan sebagai peran `anon`, dan setiap query ke
    `projects` maupun `photos` mengembalikan nol baris karena policy RLS
    membandingkan `auth.uid()` dengan pemilik barisnya.
    """
    if not supabase_client or not auth.session.is_signed_in():
        return
    try:
        supabase_client.auth.set_session(
            auth.session.access_token(), auth.session.refresh_token
        )
        print(f"[PhotoFlow] ✓ Supabase RLS session attached (uid: {current_user_id()})")
    except Exception as exc:
        print(f"[PhotoFlow] ⚠ Gagal memasang sesi Supabase: {exc}")

# ── Internet Connectivity Check ─────────────────────────────
def check_internet():
    """Fast connectivity check via socket to Cloudflare DNS (1.1.1.1:53)."""
    global is_offline
    try:
        socket.create_connection(("1.1.1.1", 53), timeout=3)
        is_offline = False
    except OSError:
        is_offline = True
    status = "OFFLINE" if is_offline else "ONLINE"
    print(f"[PhotoFlow] Network status: {status}")
    return not is_offline

SENTRY_DSN = config.SENTRY_DSN


def _async_startup_tasks():
    """Background bootstrap for network-dependent initialization.
    Runs in a daemon thread so eel.start() can launch the browser window
    immediately without waiting for DNS resolution, HTTP handshakes,
    or SDK telemetry setup.

    Execution order:
      1. Sentry SDK init       — enables crash reporting (~200-500ms)
      2. Internet check        — socket to 1.1.1.1:53   (~50-3000ms)
      3. Supabase client init  — HTTP to Supabase API    (~300-1500ms)
      4. Restore saved session — refresh token exchange  (~300-1000ms)
    """
    global supabase_client, _startup_complete

    # 1. Sentry — safe to call early; capture_exception() is a no-op until init.
    if SENTRY_DSN:
        try:
            sentry_sdk.init(
                dsn=SENTRY_DSN,
                traces_sample_rate=1.0,
                profiles_sample_rate=1.0,
            )
            print("[PhotoFlow] ✓ Sentry crash analytics initialized.")
        except Exception as e:
            print(f"[PhotoFlow] ✗ Sentry init failed (non-fatal): {e}")

    # 2. Network check — updates global is_offline.
    check_internet()

    # 3. Supabase client — requires network; skip if offline.
    if not is_offline:
        try:
            supabase_client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
            print("[PhotoFlow] ✓ Supabase Client Connected!")
        except Exception as e:
            print(f"[PhotoFlow] ✗ Supabase Client failed: {e}")
            supabase_client = None

        # 4. Sesi tersimpan dipulihkan lewat refresh token, tanpa meminta
        #    password lagi. Kegagalannya tidak fatal: user tinggal login.
        try:
            if auth.session.restore():
                print(f"[PhotoFlow] ✓ Sesi dipulihkan untuk {auth.session.email}")
                _attach_supabase_session()
        except Exception as e:
            print(f"[PhotoFlow] ⚠ Gagal memulihkan sesi: {e}")
    else:
        print("[PhotoFlow] Supabase init skipped (offline).")

    _startup_complete = True
    print("[PhotoFlow] ✓ Background bootstrap complete.")

# ── Setup Caching (local filesystem, no network) ──────────────
CACHE_DIR = os.path.join(os.path.expanduser('~'), '.photoflow_cache')
os.makedirs(CACHE_DIR, exist_ok=True)

# ── Resolve Base Directory (PyInstaller Bundle Support) ──────
# PyInstaller --onefile extracts to a temp directory and sets sys._MEIPASS.
# In development mode, use the script's own directory.
if getattr(sys, 'frozen', False):
    BASE_DIR = sys._MEIPASS
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Initialize Eel ──────────────────────────────────────────
WEB_DIR = os.path.join(BASE_DIR, 'web')
eel.init(WEB_DIR)

# Supported image / RAW extensions (lowercase for matching)
SUPPORTED_EXTENSIONS = {
    '.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif', '.webp',  # Common image
    '.arw',                                                      # Sony
    '.cr2', '.cr3',                                              # Canon
    '.nef', '.nrw',                                              # Nikon
    '.raf',                                                      # Fujifilm
    '.rw2',                                                      # Panasonic
    '.orf',                                                      # Olympus
    '.pef',                                                      # Pentax
    '.dng',                                                      # Leica / Universal RAW
}


# ── Exposed Backend Functions ───────────────────────────────

@eel.expose
def test_connection():
    """
    A simple health-check function exposed to the frontend.
    The JS side can call `eel.test_connection()()` to verify
    that the Python backend is reachable.
    """
    print("[PhotoFlow] ✓ Frontend connected successfully.")
    if _safari_fallback:
        try:
            eel.showAdvancedToast(
                "Safari environment detected. For optimal performance and stability, "
                "a Chromium-based browser (Chrome, Edge, Brave) is recommended.",
                "warning"
            )
        except Exception:
            pass  # Frontend may not have showAdvancedToast defined yet
    return "Backend Connected Successfully!"


@eel.expose
def check_offline_status():
    """
    Returns True if OFFLINE, False if ONLINE.
    Uses a fast socket connection to Cloudflare DNS (1.1.1.1).
    """
    try:
        socket.create_connection(("1.1.1.1", 53), timeout=3)
        print("[PhotoFlow] Network status: ONLINE")
        return False
    except OSError:
        print("[PhotoFlow] Network status: OFFLINE")
        return True


@eel.expose
def login_to_server(email, password):
    """
    Login langsung ke Supabase Auth, bukan lewat backend PhotoFlow.

    Rute lama `POST /api/login-desktop` sudah dihapus (FINDINGS.md F-04): ia
    membaca tabel `auth.users` dan membandingkan hash bcrypt sendiri, lalu
    mengembalikan token buatan sendiri yang tidak pernah diverifikasi. Sekarang
    password langsung ke Supabase Auth dan yang dipegang aplikasi ini adalah JWT
    sungguhan — token yang sama yang diverifikasi middleware backend ke JWKS.

    Refresh token disimpan di keyring OS, jadi aplikasi tidak perlu menyimpan
    password dan sesi bertahan setelah aplikasi ditutup.
    """
    global is_offline

    check_internet()

    if is_offline:
        return {
            "success": False,
            "error": "offline",
            "message": "Tidak ada koneksi internet. Gunakan sesi tersimpan jika tersedia.",
        }

    try:
        result = auth.session.sign_in(email, password)
        _attach_supabase_session()
        print(f"[PhotoFlow] ✓ Login berhasil untuk {email}")
        # Access token sengaja tidak ikut dikembalikan. Frontend tidak
        # memanggil backend langsung — setiap permintaan lewat fungsi
        # @eel.expose di proses ini — jadi menyerahkan JWT ke konteks browser
        # hanya menambah tempat ia bisa bocor tanpa menambah kemampuan apa pun.
        return {
            "success": True,
            "user_id": result["user_id"],
            "email": result["email"],
        }
    except SessionExpired:
        # Pesan asli dari Supabase sengaja tidak diteruskan ke UI: ia
        # membedakan email tidak terdaftar dari password salah, dan perbedaan
        # itu memberi tahu penebak akun mana yang ada.
        print("[PhotoFlow] ✗ Login ditolak: kredensial tidak valid")
        return {
            "success": False,
            "error": "unauthorized",
            "message": "Email atau password salah.",
        }
    except requests.exceptions.Timeout:
        print("[PhotoFlow] ✗ Login timeout — server tidak merespons")
        is_offline = True
        return {
            "success": False,
            "error": "timeout",
            "message": "Server tidak merespons. Coba lagi nanti.",
        }
    except requests.exceptions.RequestException as e:
        print(f"[PhotoFlow] ✗ Login gagal karena jaringan: {e}")
        is_offline = True
        return {
            "success": False,
            "error": "offline",
            "message": "Tidak dapat menghubungi server autentikasi.",
        }
    except AuthError as e:
        print(f"[PhotoFlow] ✗ Login error: {e}")
        return {"success": False, "error": "server_error", "message": str(e)}
    except Exception as e:
        print(f"[PhotoFlow] ✗ Login error: {e}")
        sentry_sdk.capture_exception(e)
        return {"success": False, "error": "exception", "message": str(e)}


@eel.expose
def logout_from_server():
    """Akhiri sesi: buang token dari keyring dan lepas sesi klien Supabase."""
    auth.session.sign_out()
    gdrive.reset_drive_service()
    if supabase_client:
        try:
            supabase_client.auth.sign_out()
        except Exception:
            pass
    print("[PhotoFlow] ✓ Sesi diakhiri.")
    return True


@eel.expose
def get_login_state():
    """Check if the user is currently authenticated."""
    return {
        "is_logged_in": auth.session.is_signed_in(),
        "user_id": current_user_id(),
        "email": auth.session.email,
        "is_offline": is_offline,
    }


# ── Cross-Platform Folder Picker ────────────────────────────

def _choose_folder_macos(title="Select Folder"):
    """Invoke macOS native folder picker via osascript (AppleScript).
    Executed as a subprocess to avoid Cocoa main-thread violations
    when called from Eel's gevent/greenlet worker thread.
    Returns the selected POSIX path, or empty string if cancelled.
    """
    # Escape double quotes in title to prevent AppleScript syntax errors
    safe_title = title.replace('"', '\\"')
    script = (
        'tell application "System Events"\n'
        '  activate\n'
        'end tell\n'
        f'set theFolder to POSIX path of (choose folder with prompt "{safe_title}")\n'
        'return theFolder'
    )
    try:
        result = subprocess.run(
            ['osascript', '-e', script],
            capture_output=True, text=True, timeout=120
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip().rstrip('/')
        return ""
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return ""


def _choose_folder_fallback(title="Select Folder"):
    """Tkinter-based folder picker for Windows and Linux.
    Tkinter is imported lazily to avoid Cocoa framework initialization on macOS.
    """
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    root.update()
    folder = filedialog.askdirectory(title=title, parent=root)
    root.destroy()
    return folder if folder else ""


def _choose_folder_native(title="Select Folder"):
    """Cross-platform folder picker dispatcher.
    macOS: osascript subprocess (thread-safe, avoids Cocoa main-thread constraint).
    Windows/Linux: tkinter.filedialog (no main-thread restriction on these platforms).
    """
    if platform.system() == 'Darwin':
        return _choose_folder_macos(title)
    return _choose_folder_fallback(title)


@eel.expose
def choose_folder():
    """
    Opens a native OS folder-picker dialog and returns the
    selected absolute path, or an empty string if cancelled.
    Dispatches to osascript on macOS, tkinter on Windows/Linux.
    """
    selected = _choose_folder_native("Select Folder")
    print(f"[PhotoFlow] Folder selected: {selected or '(cancelled)'}")
    return selected


@eel.expose
def scan_directory(folder_path):
    """
    Recursively scan *folder_path* for supported image / RAW files.

    Instead of returning everything at once, this function **streams**
    results in chunks of CHUNK_SIZE to the frontend via
    ``eel.receive_scan_chunk()`` so the UI stays responsive even for
    folders with 10 000+ files.

    When the scan finishes it calls ``eel.scan_complete(total_count)``.
    """
    CHUNK_SIZE = 50

    root = Path(folder_path)

    if not root.is_dir():
        print(f"[PhotoFlow] ✗ Invalid directory: {folder_path}")
        eel.scan_complete(0)          # signal the frontend immediately
        return

    print(f"[PhotoFlow] Scanning: {folder_path} ...")

    chunk = []
    total = 0

    try:
        for root_dir, dirs, files in os.walk(str(root)):
            for filename in files:
                try:
                    entry = Path(os.path.join(root_dir, filename))
                    if entry.is_file() and entry.suffix.lower() in SUPPORTED_EXTENSIONS:
                        chunk.append({
                            "filename": entry.name,
                            "path":     str(entry.resolve()),
                            "size_mb":  round(entry.stat().st_size / (1024 * 1024), 2),
                            "ext":      entry.suffix.lstrip('.').upper(),
                        })

                        if len(chunk) >= CHUNK_SIZE:
                            eel.receive_scan_chunk(chunk)()   # push to frontend
                            total += len(chunk)
                            chunk = []
                            eel.sleep(0.01)                   # let the UI breathe
                except (OSError, PermissionError):
                    continue
    except (OSError, PermissionError) as e:
        print(f"[PhotoFlow] ⚠ Scan interrupted: {e}")

    # Flush remaining files
    if chunk:
        eel.receive_scan_chunk(chunk)()
        total += len(chunk)

    print(f"[PhotoFlow] ✓ Found {total} supported files.")
    eel.scan_complete(total)()




@eel.expose
def get_image_thumbnail(file_path, max_size=256):
    """
    Generate a Base64-encoded JPEG thumbnail for *file_path*.

    Uses a 3-step fallback strategy:
      1. Pillow  – fastest for standard formats (JPG, PNG, TIFF…)
      2. rawpy embedded thumbnail – very fast for RAW files (CR2, NEF, ARW)
      3. rawpy full post-process  – slower fallback if no embedded thumb exists

    Returns a base64 ASCII string, or "" if all methods fail.
    """
    try:
        # STEP 1: Try standard Pillow first (fastest for JPG/PNG)
        try:
            img = Image.open(file_path)
            img.thumbnail((max_size, max_size))
            buffer = io.BytesIO()
            img.convert('RGB').save(buffer, format='JPEG', quality=80)
            return base64.b64encode(buffer.getvalue()).decode('utf-8')
        except Exception:
            pass  # Not a Pillow-readable format — fall through to RAW

        # STEP 2: Try extracting embedded RAW thumbnail using rawpy
        try:
            with rawpy.imread(file_path) as raw:
                try:
                    thumb = raw.extract_thumb()
                    if thumb.format == rawpy.ThumbFormat.JPEG:
                        img = Image.open(io.BytesIO(thumb.data))
                        img.thumbnail((max_size, max_size))
                        buffer = io.BytesIO()
                        img.convert('RGB').save(buffer, format='JPEG', quality=80)
                        return base64.b64encode(buffer.getvalue()).decode('utf-8')
                except rawpy.LibRawNoThumbnailError:
                    pass  # No embedded thumbnail — fall through to full decode

                # STEP 3: Last resort — full RAW post-process (slower but guaranteed)
                rgb = raw.postprocess(half_size=True)
                img = Image.fromarray(rgb)
                img.thumbnail((max_size, max_size))
                buffer = io.BytesIO()
                img.save(buffer, format='JPEG', quality=80)
                return base64.b64encode(buffer.getvalue()).decode('utf-8')
        except Exception:
            pass  # rawpy can't handle this file either

    except Exception as e:
        print(f"[PhotoFlow] Thumbnail failed for {file_path}: {e}")

    return ""  # Frontend keeps the placeholder icon


@eel.expose
def execute_file_action(action_type, file_paths, dest_folder):
    """
    Copy or move files to *dest_folder*.

    Parameters
    ----------
    action_type : str   – "copy" or "move"
    file_paths  : list  – absolute source file paths
    dest_folder : str   – absolute destination directory

    Returns
    -------
    dict  {"success_count": int, "failed_files": [str, ...]}
    """
    success_count = 0
    failed_files = []

    dest = Path(dest_folder)
    if not dest.is_dir():
        print(f"[PhotoFlow] ✗ Destination does not exist: {dest_folder}")
        return {"success_count": 0, "failed_files": [p.split('/')[-1] for p in file_paths]}

    verb = "Copying" if action_type == "copy" else "Moving"
    print(f"[PhotoFlow] {verb} {len(file_paths)} files → {dest_folder}")

    for src_path in file_paths:
        src = Path(src_path)
        dst = dest / src.name
        try:
            if action_type == "copy":
                shutil.copy2(str(src), str(dst))   # preserves metadata
            else:
                shutil.move(str(src), str(dst))
            success_count += 1
        except Exception as e:
            print(f"[PhotoFlow]   ✗ Failed: {src.name} — {e}")
            failed_files.append(src.name)

    result_verb = "Copied" if action_type == "copy" else "Moved"
    print(f"[PhotoFlow] ✓ {result_verb} {success_count}/{len(file_paths)} files. "
          f"{len(failed_files)} failed.")

    return {"success_count": success_count, "failed_files": failed_files}


@eel.expose
def get_high_res_image(file_path):
    """
    Generate a high-resolution Base64-encoded JPEG for the lightbox viewer.

    Resizes so the longest edge is a maximum of 2500 px — enough for
    checking focus on high-DPI screens without saturating the websocket.

    Uses the same 3-step fallback as thumbnails:
      1. Pillow for standard formats
      2. rawpy embedded JPEG for RAW files
      3. rawpy full post-process as last resort
    """
    MAX_SIZE = (2500, 2500)

    try:
        # STEP 1: Pillow for standard formats
        try:
            img = Image.open(file_path)
            img.thumbnail(MAX_SIZE, Image.LANCZOS)
            buffer = io.BytesIO()
            img.convert('RGB').save(buffer, format='JPEG', quality=90)
            return base64.b64encode(buffer.getvalue()).decode('utf-8')
        except Exception:
            pass

        # STEP 2: rawpy embedded full-size JPEG
        try:
            with rawpy.imread(file_path) as raw:
                try:
                    thumb = raw.extract_thumb()
                    if thumb.format == rawpy.ThumbFormat.JPEG:
                        img = Image.open(io.BytesIO(thumb.data))
                        img.thumbnail(MAX_SIZE, Image.LANCZOS)
                        buffer = io.BytesIO()
                        img.convert('RGB').save(buffer, format='JPEG', quality=90)
                        return base64.b64encode(buffer.getvalue()).decode('utf-8')
                except rawpy.LibRawNoThumbnailError:
                    pass

                # STEP 3: Full RAW decode at half_size for performance
                rgb = raw.postprocess(half_size=True)
                img = Image.fromarray(rgb)
                img.thumbnail(MAX_SIZE, Image.LANCZOS)
                buffer = io.BytesIO()
                img.save(buffer, format='JPEG', quality=90)
                return base64.b64encode(buffer.getvalue()).decode('utf-8')
        except Exception:
            pass

    except Exception as e:
        print(f"[PhotoFlow] High-res failed for {file_path}: {e}")

    return ""


@eel.expose
def open_in_os(file_path):
    """
    Open a file in the OS default application (e.g. Photos, Preview).
    """
    try:
        system = platform.system()
        if system == 'Windows':
            os.startfile(file_path)
        elif system == 'Darwin':        # macOS
            subprocess.call(['open', file_path])
        else:                           # Linux
            subprocess.call(['xdg-open', file_path])
        print(f"[PhotoFlow] Opened in OS: {file_path}")
        return True
    except Exception as e:
        print(f"[PhotoFlow] OS open failed: {e}")
        return False


@eel.expose
def start_drive_upload(file_paths, user_id=None):
    """Legacy single-step upload. Delegates to gdrive module."""
    try:
        result = gdrive.upload_files_to_drive(file_paths, 'root')
        return result
    except PermissionError:
        return {"success": False, "error": "Sesi cloud berakhir. Mohon login ulang."}
    except Exception as e:
        print(f"[PhotoFlow] ✗ Drive upload failed: {e}")
        sentry_sdk.capture_exception(e)
        return {"success": False, "error": str(e)}


@eel.expose
def get_drive_contents(folder_id='root', user_id=None):
    """Fetch the contents of a Google Drive folder."""
    try:
        return gdrive.list_files(folder_id)
    except PermissionError:
        return {"error": "Sesi cloud berakhir. Mohon login ulang."}
    except Exception as e:
        print(f"[PhotoFlow] ✗ Drive explorer failed: {e}")
        sentry_sdk.capture_exception(e)
        return {"error": str(e)}

@eel.expose
def get_drive_folders_only(folder_id='root', user_id=None):
    try:
        return gdrive.list_folders_only(folder_id)
    except PermissionError:
        return {"error": "Sesi cloud berakhir. Mohon login ulang."}
    except Exception as e:
        print(f"[PhotoFlow] ✗ Drive folders fetch failed: {e}")
        sentry_sdk.capture_exception(e)
        return {"error": str(e)}

@eel.expose
def execute_drive_move(file_ids, current_parent, target_parent, user_id=None):
    try:
        return gdrive.move_drive_files(file_ids, current_parent, target_parent)
    except PermissionError:
        return {"success": False, "error": "Sesi cloud berakhir. Mohon login ulang."}
    except Exception as e:
        print(f"[PhotoFlow] ✗ Drive move failed: {e}")
        sentry_sdk.capture_exception(e)
        return {"success": False, "error": str(e)}

@eel.expose
def execute_drive_copy(file_ids, target_parent, user_id=None):
    try:
        return gdrive.copy_drive_files(file_ids, target_parent)
    except PermissionError:
        return {"success": False, "error": "Sesi cloud berakhir. Mohon login ulang."}
    except Exception as e:
        print(f"[PhotoFlow] ✗ Drive copy failed: {e}")
        sentry_sdk.capture_exception(e)
        return {"success": False, "error": str(e)}

@eel.expose
def create_new_drive_folder(folder_name, parent_id='root', user_id=None):
    try:
        return gdrive.create_drive_folder(folder_name, parent_id)
    except PermissionError:
        return {"success": False, "error": "Sesi cloud berakhir. Mohon login ulang."}
    except Exception as e:
        print(f"[PhotoFlow] ✗ Drive create folder failed: {e}")
        sentry_sdk.capture_exception(e)
        return {"success": False, "error": str(e)}

@eel.expose
def trash_drive_files(file_ids, user_id=None):
    try:
        return gdrive.trash_drive_files(file_ids)
    except PermissionError:
        return {"success": False, "error": "Sesi cloud berakhir. Mohon login ulang."}
    except Exception as e:
        print(f"[PhotoFlow] ✗ Drive trash failed: {e}")
        sentry_sdk.capture_exception(e)
        return {"success": False, "error": str(e)}

@eel.expose
def rename_drive_item(file_id, new_name, user_id=None):
    try:
        return gdrive.rename_drive_item(file_id, new_name)
    except PermissionError:
        return {"success": False, "error": "Sesi cloud berakhir. Mohon login ulang."}
    except Exception as e:
        print(f"[PhotoFlow] ✗ Drive rename failed: {e}")
        sentry_sdk.capture_exception(e)
        return {"success": False, "error": str(e)}

@eel.expose
def resetUploadState():
    pass

@eel.expose
def upload_files_to_drive(local_file_paths, target_folder_id, mode='preview', user_id=None):
    """
    Upload files to Google Drive using a temporary access token from the backend.
    Runs in a background thread to keep the UI responsive.
    Supports 'preview' (compressed JPG) and 'backup' (original file) modes.
    """
    import tempfile
    from googleapiclient.http import MediaFileUpload


    def _upload_worker():
        processed_count = 0
        lock = threading.Lock()
        total = len(local_file_paths)

        try:
            service = gdrive.get_drive_service()
        except PermissionError as e:
            print(f"[PhotoFlow] ✗ Auth error: {e}")
            eel.showAdvancedToast("Sesi cloud berakhir. Mohon login ulang.", "error")
            eel.resetUploadState()
            return
        except Exception as e:
            print(f"[PhotoFlow] ✗ Token fetch error: {e}")
            sentry_sdk.capture_exception(e)
            eel.showAdvancedToast(f"Gagal terhubung ke cloud: {e}", "error")
            eel.resetUploadState()
            return

        def process_single_file(path):
            nonlocal processed_count
            try:
                if mode == 'backup':
                    # Full Backup: upload the original file as-is
                    print(f"[PhotoFlow] [Backup] Uploading original file: {os.path.basename(path)}")
                    file_metadata = {'name': os.path.basename(path), 'parents': [target_folder_id]}
                    media = MediaFileUpload(path, resumable=False)
                    service.files().create(body=file_metadata, media_body=media, fields='id').execute()
                    print(f"[PhotoFlow] ✓ [Backup] Upload success for {os.path.basename(path)}")
                else:
                    # Preview mode: compress then upload
                    ext = os.path.splitext(path)[1].lower()
                    base_name = os.path.splitext(os.path.basename(path))[0]
                    compressed_filename = f"{base_name}.jpg"
                    tmp_path = os.path.join(temp_dir, f"{base_name}_{threading.current_thread().ident}.jpg")

                    print(f"[PhotoFlow] [Preview] Processing: {os.path.basename(path)}")

                    raw_exts = {'.dng', '.cr2', '.cr3', '.nef', '.nrw', '.arw', '.rw2', '.raf', '.orf', '.pef'}
                    if ext in raw_exts:
                        with rawpy.imread(path) as raw:
                            try:
                                thumb = raw.extract_thumb()
                                if thumb.format == rawpy.ThumbFormat.JPEG:
                                    img = Image.open(io.BytesIO(thumb.data))
                                    if max(img.size) > 2048:
                                        resample_filter = Image.Resampling.LANCZOS if hasattr(Image, 'Resampling') else Image.LANCZOS
                                        img.thumbnail((2048, 2048), resample_filter)
                                    img.save(tmp_path, "JPEG", quality=85)
                                else:
                                    raise rawpy.LibRawNoThumbnailError()
                            except rawpy.LibRawNoThumbnailError:
                                rgb = raw.postprocess(use_camera_wb=True, half_size=True)
                                img = Image.fromarray(rgb)
                                resample_filter = Image.Resampling.LANCZOS if hasattr(Image, 'Resampling') else Image.LANCZOS
                                img.thumbnail((2048, 2048), resample_filter)
                                img.save(tmp_path, "JPEG", quality=85)
                    else:
                        img = Image.open(path)
                        if img.mode in ("RGBA", "P"):
                            img = img.convert("RGB")
                        resample_filter = Image.Resampling.LANCZOS if hasattr(Image, 'Resampling') else Image.LANCZOS
                        img.thumbnail((2048, 2048), resample_filter)
                        img.save(tmp_path, "JPEG", quality=85)

                    file_metadata = {'name': compressed_filename, 'parents': [target_folder_id]}
                    media = MediaFileUpload(tmp_path, mimetype='image/jpeg', resumable=False)
                    service.files().create(body=file_metadata, media_body=media, fields='id').execute()
                    print(f"[PhotoFlow] ✓ [Preview] Upload success for {compressed_filename}")

            except Exception as img_err:
                print(f"[PhotoFlow] ✗ Failed to process or upload {path}: {img_err}")
                sentry_sdk.capture_exception(img_err)
            finally:
                with lock:
                    processed_count += 1
                    percent = int((processed_count / total) * 100)
                    eel.update_sync_progress(percent)

        try:
            print(f"[PhotoFlow] Started Turbo Upload ({mode} mode) for {total} files with 5 workers.")

            if mode == 'backup':
                # Backup mode: no temp dir needed
                with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
                    list(executor.map(process_single_file, local_file_paths))
            else:
                # Preview mode: needs temp dir for compressed files
                with tempfile.TemporaryDirectory() as temp_dir:
                    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
                        list(executor.map(process_single_file, local_file_paths))

            print("[PhotoFlow] Calling sync_complete on UI...")
            eel.sync_complete()
        except Exception as e:
            print(f"[PhotoFlow] ✗ Worker drive upload failed: {e}")
            sentry_sdk.capture_exception(e)
        finally:
            print("[PhotoFlow] Thread upload finished. Triggering resetUploadState().")
            eel.resetUploadState()

    # Use a real OS thread to prevent blocking the Eel websocket loop
    threading.Thread(target=_upload_worker, daemon=True).start()
    return {"success": True, "message": f"Turbo upload triggered ({mode} mode) via OS thread"}

@eel.expose
def auto_gather_raws(selected_filenames, source_folder, project_name="Selected_RAWs"):
    import traceback

    dest_folder = _choose_folder_native(f"Select Export Destination for {project_name}")
    
    if not dest_folder:
        return {"success": False, "message": "Operation cancelled by user."}

    def _gather_worker():
        print(f"\n[PhotoFlow] 🚀 MENGAKTIFKAN MESIN PEMANEN RAW: {project_name}")
        print(f"Target: {len(selected_filenames)} file dari database.")
        
        try:
            # 1. Bersihkan base name target (hilangkan ekstensi & kecilkan huruf)
            target_bases = {os.path.splitext(f)[0].lower() for f in selected_filenames if f}
            
            # 2. Buat sub-folder proyek (Aman dari karakter aneh)
            safe_project_name = "".join([c for c in project_name if c.isalpha() or c.isdigit() or c==' ']).rstrip()
            target_dir = os.path.join(dest_folder, safe_project_name)
            os.makedirs(target_dir, exist_ok=True)
            print(f"Folder tujuan disiapkan: {target_dir}")

            found_count = 0
            
            # 3. Pindai folder sumber
            print(f"Memindai direktori sumber: {source_folder} ...")
            for root, _, files in os.walk(source_folder):
                for file in files:
                    base = os.path.splitext(file)[0].lower()
                    if base in target_bases:
                        src_path = os.path.join(root, file)
                        dst_path = os.path.join(target_dir, file)
                        
                        # Copy file dengan metadata
                        shutil.copy2(src_path, dst_path)
                        found_count += 1
                        print(f"  -> Disalin: {file}")
                        
                        # Hapus dari set agar tidak tertimpa jika ada duplikat di subfolder lain
                        target_bases.discard(base)
                        
                        # Update UI
                        percent = int((found_count / len(selected_filenames)) * 100)
                        try:
                            eel.update_sync_progress(percent)()
                        except:
                            pass
                            
            print(f"[PhotoFlow] ✓ Selesai! Berhasil memanen {found_count} file RAW/JPG.")
            if target_bases:
                print(f"[WARNING] Ada {len(target_bases)} file yang TIDAK DITEMUKAN di hardisk Anda!")
                
        except Exception as e:
            print(f"[PhotoFlow] ✗ FATAL ERROR di Mesin Pemanen: {e}")
            traceback.print_exc()
        finally:
            try:
                # Gunakan 0 sebagai fallback jika error terjadi sebelum variabel ini dibuat
                fc = found_count if 'found_count' in locals() else 0
                mc = len(target_bases) if 'target_bases' in locals() else 0
                eel.auto_gather_complete(fc, mc)()
            except Exception as e:
                print(f"[PhotoFlow] Gagal mengirim sinyal ke UI: {e}")

    threading.Thread(target=_gather_worker, daemon=True).start()
    return {"success": True, "message": "Pemanen RAW berjalan di latar belakang"}

@eel.expose
def download_drive_files(file_ids_list, local_dest_folder, user_id=None):
    """Download files from Google Drive to a local folder."""
    try:
        return gdrive.download_drive_files(file_ids_list, local_dest_folder)
    except PermissionError:
        return {"success": False, "error": "Sesi cloud berakhir. Mohon login ulang."}
    except Exception as e:
        print(f"[PhotoFlow] ✗ Drive download failed: {e}")
        sentry_sdk.capture_exception(e)
        return {"success": False, "error": str(e)}

@eel.expose
def check_drive_auth(user_id=None):
    """Test if the user's Drive connection is actually working by requesting a token."""
    if not auth.session.is_signed_in():
        print("[PhotoFlow] Auth Polling: belum login.")
        return False
    try:
        return gdrive.get_drive_service() is not None
    except gdrive.DriveNotConnected as e:
        print(f"[PhotoFlow] Drive belum terhubung: {e.code}")
        return False
    except Exception as e:
        print(f"[PhotoFlow] Auth Polling Error: {e}")
        return False

@eel.expose
def logout_drive_account(user_id=None):
    """Clear the local session, Drive cache, and remove refresh token from DB."""
    try:
        gdrive.reset_drive_service()
        uid = current_user_id()
        if uid and supabase_client:
            # Barisnya dibatasi ke id milik sesi ini. Policy RLS pada `profiles`
            # sudah menolak baris milik orang lain, tapi menyaringnya di sini
            # juga berarti perintahnya tidak pernah bergantung pada nilai yang
            # dikirim frontend.
            supabase_client.table('profiles').update(
                {'gdrive_refresh_token': None}
            ).eq('id', uid).execute()
        print("[PhotoFlow] ✓ Drive account disconnected, cache cleared, and token removed from DB.")
        return True
    except Exception as e:
        print(f"[PhotoFlow] Logout Error: {e}")
        return False

@eel.expose
def login_drive_account():
    """Open Google OAuth in the browser, then return current auth state."""
    return open_google_login()


@eel.expose
def open_google_login(user_id=None):
    """
    Buka alur OAuth Google di browser default.

    Rute lama `GET /api/auth/google/login?user_id=...` sudah dihapus
    (FINDINGS.md F-05 dan F-21). Rute itu menerima user_id dari query string
    lalu meneruskannya apa adanya sebagai parameter `state` OAuth, sehingga
    siapa pun yang tahu user_id orang lain bisa membuka alur atas nama korban,
    menyetujuinya dengan akun Google miliknya sendiri, dan menitipkan refresh
    token miliknya ke profil korban.

    Penggantinya `POST /api/auth/google/url`: identitas diambil dari JWT yang
    dibawa header Authorization, backend membuat `state` acak sekali-pakai,
    dan yang dikembalikan adalah URL untuk dibuka — bukan redirect, karena
    navigasi teratas browser tidak membawa header Authorization.

    Parameter `user_id` dipertahankan supaya pemanggil lama di script.js tidak
    patah; nilainya diabaikan.
    """
    if not auth.session.is_signed_in():
        print("[PhotoFlow] ✗ Tidak bisa membuka Google Login: belum login.")
        return False

    try:
        response = requests.post(
            f"{BACKEND_URL}/api/auth/google/url",
            headers=auth.bearer_headers(),
            timeout=15,
        )
        if response.status_code != 200:
            print(f"[PhotoFlow] ✗ Gagal meminta URL OAuth (HTTP {response.status_code})")
            return False

        auth_url = response.json().get("auth_url")
        if not auth_url:
            print("[PhotoFlow] ✗ Backend tidak mengirimkan auth_url.")
            return False

        print("[PhotoFlow] Membuka alur OAuth Google di browser.")
        webbrowser.open(auth_url)
        return True
    except SessionExpired:
        print("[PhotoFlow] ✗ Sesi berakhir saat membuka Google Login.")
        return False
    except Exception as e:
        print(f"[PhotoFlow] ✗ Google Login error: {e}")
        sentry_sdk.capture_exception(e)
        return False

@eel.expose
def get_submitted_projects():
    """Fetch projects with 'submitted' status from Supabase."""
    if not supabase_client:
        return {"error": "Supabase not connected"}

    user_id = current_user_id()
    if user_id:
        try:
            query = (
                supabase_client
                .table('projects')
                .select('id, project_name, client_name, max_selections')
                .eq('status', 'submitted')
                .eq('user_id', user_id)
            )
            res = query.execute()
            mapped_data = []
            for item in res.data:
                actual_count = 0
                try:
                    photos_res = (
                        supabase_client.table('photos')
                        .select('id')
                        .eq('project_id', item.get('id'))
                        .eq('is_selected', True)
                        .execute()
                    )
                    actual_count = len(photos_res.data)
                except Exception as e:
                    print(f"[PhotoFlow] Warning: could not count photos for project {item.get('id')}: {e}")

                mapped_data.append({
                    "id": item.get("id"),
                    "project_name": item.get("project_name"),
                    "client_name": item.get("client_name"),
                    "selection_count": actual_count
                })
            print(f"[PhotoFlow] ✓ Fetched {len(mapped_data)} submitted projects.")
            return {"success": True, "data": mapped_data}
        except Exception as e:
            print(f"[PhotoFlow] ✗ Error fetching projects: {e}")
            sentry_sdk.capture_exception(e)
            return {"error": str(e)}
    else:
        return {"error": "User not authenticated. Akses ditolak."}

@eel.expose
def get_project_filenames(project_id):
    """Fetch selected filenames for a specific project from Supabase."""
    if not supabase_client:
        return {"error": "Supabase not connected"}
    try:
        res = (
            supabase_client
            .table('photos')
            .select('file_name')
            .eq('project_id', project_id)
            .eq('is_selected', True)
            .execute()
        )
        filenames = [item.get('file_name') for item in res.data if item.get('file_name')]
        print(f"[PhotoFlow] ✓ Fetched {len(filenames)} filenames for project '{project_id}'.")
        return {"success": True, "data": filenames}
    except Exception as e:
        print(f"[PhotoFlow] ✗ Error fetching filenames: {e}")
        sentry_sdk.capture_exception(e)
        return {"error": str(e)}

def _pick_release_asset(assets):
    """Pilih berkas rilis yang cocok dengan sistem yang sedang berjalan."""
    wanted = '.dmg' if platform.system() == 'Darwin' else '.exe'
    for asset in assets:
        name = (asset.get('name') or '').lower()
        if name.endswith(wanted):
            return asset.get('browser_download_url')
    for asset in assets:
        name = (asset.get('name') or '').lower()
        if name.endswith('.zip'):
            return asset.get('browser_download_url')
    return None


@eel.expose
def check_for_updates():
    """Cari rilis yang lebih baru. None kalau sudah paling baru atau gagal.

    Menerima dua bentuk respons: manifes sendiri berisi `latest_version` dan
    `download_url`, atau respons API release GitHub (`tag_name` dan `assets`).
    Default UPDATE_URL menunjuk yang kedua.

    Perbandingan versinya lewat config.is_newer, bukan operator `>` pada string.
    Versi sebelumnya membandingkan string, dan `"1.10" > "1.9"` bernilai False —
    rilis 1.10 tidak akan pernah terdeteksi sebagai lebih baru dari 1.9.
    """
    if not UPDATE_URL or UPDATE_URL.startswith('YOUR_'):
        return None
    try:
        req = urllib.request.Request(
            UPDATE_URL,
            headers={
                'User-Agent': f'PhotoFlow/{CURRENT_VERSION}',
                'Accept': 'application/vnd.github+json',
            },
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode())
    except Exception as e:
        print(f"[PhotoFlow] Update check failed: {e}")
        return None

    latest = data.get('latest_version') or data.get('tag_name')
    if not latest or not config.is_newer(latest, CURRENT_VERSION):
        return None

    download_url = (
        data.get('download_url')
        or _pick_release_asset(data.get('assets') or [])
        or data.get('html_url')
    )
    print(f"[PhotoFlow] Versi baru tersedia: {latest}")
    return {
        'latest_version': str(latest).lstrip('vV'),
        'download_url': download_url,
        'notes': data.get('body') or data.get('notes') or '',
    }

@eel.expose
def open_url(url):
    webbrowser.open(url)

# ── Custom Bottle Route for Thumbnails ──────────────────────
import bottle

RAW_EXTS = ('.cr2', '.cr3', '.nef', '.arw', '.rw2', '.dng', '.raf', '.orf')

@bottle.route('/thumb')
def serve_thumbnail():
    filepath = bottle.request.query.path
    if not filepath or not os.path.exists(filepath):
        return bottle.HTTPError(404, "File not found")
    
    # Create safe hash for cache filename
    safe_name = hashlib.md5(filepath.encode('utf-8')).hexdigest() + '.jpg'
    cache_path = os.path.join(CACHE_DIR, safe_name)
    
    # Generate if not in cache
    if not os.path.exists(cache_path):
        try:
            ext = os.path.splitext(filepath)[1].lower()
            if ext in RAW_EXTS:
                # Use rawpy for camera RAW files
                with rawpy.imread(filepath) as raw:
                    # half_size=True speeds up processing significantly
                    rgb = raw.postprocess(use_camera_wb=True, half_size=True)
                    img = Image.fromarray(rgb)
            else:
                # Use standard Pillow for JPG, PNG, etc.
                img = Image.open(filepath)
                if img.mode in ("RGBA", "P"): img = img.convert("RGB")
                
            # Common resize and save logic
            img.thumbnail((256, 256))
            img.save(cache_path, "JPEG", quality=70)
        except Exception as e:
            print(f"Thumb error for {filepath}: {e}")
            return bottle.HTTPError(500, "Render failed")
    
    # Serve the binary file directly
    return bottle.static_file(safe_name, root=CACHE_DIR)

# ── Launch the Application ──────────────────────────────────

if __name__ == '__main__':
    print("[PhotoFlow] Starting desktop application...")

    # Launch network-dependent init in background so eel.start() is not blocked.
    # The UI renders immediately; network services become available within ~1-3s.
    threading.Thread(target=_async_startup_tasks, daemon=True).start()

    eel_options = {
        'size': (850, 740),
        'port': 0,
    }

    # Browser priority on macOS: Chrome > Edge > Chromium > Brave > default.
    # Safari has strict WebSocket CORS enforcement that can interfere with
    # Eel's ws:// bridge. Prefer a Chromium-based browser when available.
    if platform.system() == 'Darwin':
        _chromium_paths = [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        ]
        _found_browser = None
        for _path in _chromium_paths:
            if os.path.exists(_path):
                _found_browser = _path
                break

        if _found_browser:
            eel_options['mode'] = 'custom'
            eel_options['cmdline_args'] = [_found_browser, '--new-window']
            print(f"[PhotoFlow] Using Chromium browser: {os.path.basename(_found_browser)}")
        else:
            eel_options['mode'] = 'default'
            _safari_fallback = True
            print("[PhotoFlow] No Chromium browser detected. Falling back to default browser.")

    try:
        eel.start('index.html', **eel_options)
    except EnvironmentError:
        # eel.start raises EnvironmentError if the specified browser is not found
        print("[PhotoFlow] Primary browser launch failed. Attempting default browser...")
        _safari_fallback = True
        try:
            eel.start('index.html', mode='default', size=(850, 740), port=0)
        except Exception as e:
            print(f"[PhotoFlow] All browser strategies exhausted: {e}")
            sentry_sdk.capture_exception(e)
