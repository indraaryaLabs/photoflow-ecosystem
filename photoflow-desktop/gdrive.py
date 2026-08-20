"""
PhotoFlow — layanan Google Drive.

Semua operasi Drive memakai access token sementara yang diminta ke backend
lewat `GET /api/gdrive/token`. Backend menukar refresh token milik pemilik
akun jadi access token berumur pendek, jadi tidak ada `credentials.json`
maupun `token.json` yang perlu disimpan di mesin ini.

Identitas pemanggil ditentukan sepenuhnya oleh JWT pada header
`Authorization`. Versi sebelumnya juga mengirim header `X-User-ID`, sisa dari
masa ketika backend mempercayai identitas yang dikirim pemanggil; header itu
sudah tidak dibaca backend dan dihapus dari sini supaya tidak ada yang mengira
ia masih menentukan sesuatu.
"""

import os
import threading

import requests

import telemetry

import auth
import config

# google-api-python-client diimpor di dalam fungsi, bukan di sini. Paketnya
# butuh ratusan milidetik untuk dimuat, sedangkan sebagian besar sesi tidak
# pernah menyentuh Drive sama sekali — memuatnya saat start berarti membayar
# ongkos itu untuk semua orang. Efek sampingnya modul ini bisa diuji tanpa
# memasang SDK Google.

BACKEND_URL = config.BACKEND_URL

_TIMEOUT = 20


class DriveNotConnected(Exception):
    """User belum menghubungkan Google Drive, atau izinnya dicabut.

    Dibedakan dari kegagalan sesi karena tindakan yang diminta ke user berbeda:
    yang ini butuh menghubungkan Drive, bukan login ulang.
    """

    def __init__(self, code="drive_not_connected"):
        self.code = code
        super().__init__(
            "Google Drive is not connected. Connect your Google account first."
            if code == "drive_not_connected"
            else "Your Google Drive access needs renewing. Reconnect your Google account."
        )


# Service Drive dibangun ulang setiap access token berganti. Membangunnya bukan
# operasi gratis, dan satu sesi memanen memanggil belasan operasi berturut-turut
# dengan token yang sama.
_service_lock = threading.Lock()
_cached_service = None
_cached_token = None


def _fetch_access_token(force_refresh=False):
    """Minta access token Drive ke backend, bawa JWT Supabase milik pemanggil."""
    response = requests.get(
        f"{BACKEND_URL}/api/gdrive/token",
        headers=auth.bearer_headers(force_refresh),
        timeout=_TIMEOUT,
    )

    if response.status_code == 200:
        token = response.json().get("access_token")
        if not token:
            raise ValueError("The server did not return an access token.")
        return token

    body = {}
    try:
        body = response.json()
    except ValueError:
        pass

    # 409 berarti backend sehat tapi Drive user-nya belum siap.
    if response.status_code == 409:
        raise DriveNotConnected(body.get("code") or "drive_not_connected")

    # 401 berkode token_expired: JWT-nya lewat batas tepat saat request terbang.
    # Sekali percobaan ulang dengan token yang baru diperbarui, lalu menyerah.
    if response.status_code == 401:
        if body.get("code") == "token_expired" and not force_refresh:
            return _fetch_access_token(force_refresh=True)
        raise PermissionError("Your session has expired. Please sign in again.")

    raise PermissionError(f"Backend Error {response.status_code}: {response.text[:200]}")


def get_drive_service(force_refresh=False):
    """Bangun service Drive v3 memakai access token dari backend."""
    global _cached_service, _cached_token

    from googleapiclient.discovery import build
    from google.oauth2.credentials import Credentials

    access_token = _fetch_access_token(force_refresh)
    with _service_lock:
        if _cached_service is not None and _cached_token == access_token:
            return _cached_service
        creds = Credentials(token=access_token)
        _cached_service = build("drive", "v3", credentials=creds, cache_discovery=False)
        _cached_token = access_token
        return _cached_service


def reset_drive_service():
    """Buang service yang tersimpan. Dipakai saat berganti akun."""
    global _cached_service, _cached_token
    with _service_lock:
        _cached_service = None
        _cached_token = None
    print("[gdrive] ✓ Drive service cache cleared.")


# Google Drive memperlakukan Drive Bersama sebagai wilayah terpisah dari
# "My Drive". Setiap panggilan yang tidak menyertakan supportsAllDrives
# berpura-pura wilayah itu tidak ada: listing mengembalikan daftar kosong,
# operasi per-berkas mengembalikan 404, keduanya tanpa menyebut Drive Bersama
# sama sekali. Studio yang memakai Google Workspace hampir selalu menaruh
# arsipnya di sana, jadi tanpa ini seluruh aplikasi tampak rusak bagi mereka
# dengan gejala yang menyesatkan.
#
# Konstanta ini dipakai di SETIAP operasi Drive di berkas ini. Kalau nanti ada
# operasi baru, ia harus ikut membawanya.
_ALL_DRIVES = {"supportsAllDrives": True}

# Khusus Files.List, supportsAllDrives saja tidak mengubah apa pun; yang
# benar-benar memasukkan isi Drive Bersama ke hasil adalah parameter kedua.
_ALL_DRIVES_LIST = {**_ALL_DRIVES, "includeItemsFromAllDrives": True}


# ── LIST FILES ─────────────────────────────────────────────

def list_files(folder_id):
    """Daftar berkas dan folder di dalam sebuah folder Google Drive."""
    service = get_drive_service()
    results = service.files().list(
        q=f"'{folder_id}' in parents and trashed = false",
        fields="files(id, name, mimeType, size, modifiedTime)",
        orderBy="folder,name",
        pageSize=500,
        **_ALL_DRIVES_LIST,
    ).execute()
    return results.get("files", [])


def list_folders_only(folder_id):
    """Daftar sub-folder saja di dalam sebuah folder Google Drive."""
    service = get_drive_service()
    results = service.files().list(
        q=(
            f"'{folder_id}' in parents "
            "and mimeType = 'application/vnd.google-apps.folder' "
            "and trashed = false"
        ),
        fields="files(id, name, mimeType, modifiedTime)",
        orderBy="name",
        pageSize=500,
        **_ALL_DRIVES_LIST,
    ).execute()
    return results.get("files", [])


# ── CREATE FOLDER ──────────────────────────────────────────

def create_drive_folder(folder_name, parent_id):
    service = get_drive_service()
    folder = service.files().create(
        body={
            "name": folder_name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        },
        fields="id, name",
        **_ALL_DRIVES,
    ).execute()
    return {"success": True, "id": folder.get("id"), "name": folder.get("name")}


# ── MOVE FILES ─────────────────────────────────────────────

def move_drive_files(file_ids, current_parent, target_parent):
    service = get_drive_service()
    moved, failed = 0, []
    for fid in file_ids:
        try:
            service.files().update(
                fileId=fid,
                addParents=target_parent,
                removeParents=current_parent,
                fields="id, parents",
                **_ALL_DRIVES,
            ).execute()
            moved += 1
        except Exception as exc:
            print(f"[gdrive] ✗ Move failed for {fid}: {exc}")
            telemetry.capture(exc)
            failed.append(fid)
    # Kegagalan per berkas ikut dilaporkan. Sebelumnya fungsi ini selalu
    # mengembalikan success=True walaupun setiap berkas gagal dipindah,
    # sehingga UI menampilkan keberhasilan atas pekerjaan yang tidak terjadi.
    return {"success": not failed, "moved": moved, "failed": failed}


# ── COPY FILES ─────────────────────────────────────────────

def copy_drive_files(file_ids, target_parent):
    service = get_drive_service()
    copied, failed = 0, []
    for fid in file_ids:
        try:
            original = service.files().get(
                fileId=fid, fields="name", **_ALL_DRIVES
            ).execute()
            service.files().copy(
                fileId=fid,
                body={"name": original.get("name", "Copy"), "parents": [target_parent]},
                fields="id",
                **_ALL_DRIVES,
            ).execute()
            copied += 1
        except Exception as exc:
            print(f"[gdrive] ✗ Copy failed for {fid}: {exc}")
            telemetry.capture(exc)
            failed.append(fid)
    return {"success": not failed, "copied": copied, "failed": failed}


# ── TRASH FILES ────────────────────────────────────────────

def trash_drive_files(file_ids):
    service = get_drive_service()
    trashed, failed = 0, []
    for fid in file_ids:
        try:
            service.files().update(
                fileId=fid, body={"trashed": True}, **_ALL_DRIVES
            ).execute()
            trashed += 1
        except Exception as exc:
            print(f"[gdrive] ✗ Trash failed for {fid}: {exc}")
            telemetry.capture(exc)
            failed.append(fid)
    return {"success": not failed, "trashed": trashed, "failed": failed}


# ── RENAME ITEM ────────────────────────────────────────────

def rename_drive_item(file_id, new_name):
    service = get_drive_service()
    updated = service.files().update(
        fileId=file_id, body={"name": new_name}, fields="id, name", **_ALL_DRIVES
    ).execute()
    return {"success": True, "id": updated.get("id"), "name": updated.get("name")}


# ── DOWNLOAD FILES ─────────────────────────────────────────

def download_drive_files(file_ids, local_dest_folder):
    from googleapiclient.http import MediaIoBaseDownload

    service = get_drive_service()
    downloaded, failed = 0, []
    for fid in file_ids:
        try:
            meta = service.files().get(
                fileId=fid, fields="name, mimeType", **_ALL_DRIVES
            ).execute()
            name = meta.get("name", fid)
            mime = meta.get("mimeType", "")

            # Dokumen native Google (Docs, Sheets) tidak punya isi biner untuk
            # diunduh langsung; melewatinya lebih jujur daripada menulis
            # berkas kosong.
            if mime.startswith("application/vnd.google-apps."):
                print(f"[gdrive] Skipping native Google file: {name}")
                continue

            dest_path = _unique_path(local_dest_folder, name)
            request = service.files().get_media(fileId=fid, **_ALL_DRIVES)
            with open(dest_path, "wb") as handle:
                downloader = MediaIoBaseDownload(handle, request)
                done = False
                while not done:
                    _, done = downloader.next_chunk()

            downloaded += 1
            print(f"[gdrive] ✓ Downloaded: {os.path.basename(dest_path)}")
        except Exception as exc:
            print(f"[gdrive] ✗ Download failed for {fid}: {exc}")
            telemetry.capture(exc)
            failed.append(fid)
    return {"success": not failed, "downloaded": downloaded, "failed": failed}


def _unique_path(folder, name):
    """Cari nama yang belum terpakai di folder tujuan.

    Google Drive mengizinkan dua berkas bernama sama dalam satu folder,
    sedangkan filesystem tidak. Tanpa ini, mengunduh dua berkas bernama sama
    membuat yang kedua menimpa yang pertama tanpa peringatan.
    """
    dest = os.path.join(folder, name)
    if not os.path.exists(dest):
        return dest
    stem, ext = os.path.splitext(name)
    counter = 2
    while True:
        candidate = os.path.join(folder, f"{stem} ({counter}){ext}")
        if not os.path.exists(candidate):
            return candidate
        counter += 1


# ── UPLOAD FILES ───────────────────────────────────────────

def upload_files_to_drive(file_paths, target_folder_id):
    from googleapiclient.http import MediaFileUpload

    service = get_drive_service()
    uploaded, failed = 0, []
    for path in file_paths:
        try:
            media = MediaFileUpload(path, resumable=False)
            service.files().create(
                body={"name": os.path.basename(path), "parents": [target_folder_id]},
                media_body=media,
                fields="id",
                **_ALL_DRIVES,
            ).execute()
            uploaded += 1
            print(f"[gdrive] ✓ Uploaded: {os.path.basename(path)}")
        except Exception as exc:
            print(f"[gdrive] ✗ Upload failed for {path}: {exc}")
            telemetry.capture(exc)
            failed.append(path)
    return {"success": not failed, "uploaded": uploaded, "failed": failed}
