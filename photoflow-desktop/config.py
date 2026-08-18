"""
PhotoFlow Desktop — konfigurasi.

Nilai di sini boleh ditimpa lewat environment variable supaya aplikasi bisa
diarahkan ke backend lokal saat pengembangan tanpa mengubah kode.

Anon key Supabase memang ikut dibundel ke dalam binary. Kunci itu dirancang
untuk dipegang klien: yang membatasi apa yang bisa dilakukannya adalah Row
Level Security di sisi database, bukan kerahasiaan kuncinya. Perlu dicatat
bahwa jaminan itu hanya berlaku selama RLS benar-benar menyala — FINDINGS.md
F-02 dan F-14 mencatat dua tabel yang sempat tidak punya RLS, dan selama itu
kunci ini berarti akses baca-tulis penuh tanpa melewati backend sama sekali.
`cmd/migrate` sekarang menolak berjalan kalau ada satu tabel pun tanpa RLS.
"""

import os

# Versi aplikasi. Dibaca check_for_updates() dan ditampilkan di UI.
CURRENT_VERSION = "1.1.0"

# Sumber informasi rilis. Default menunjuk API release GitHub repo ini.
UPDATE_URL = os.environ.get(
    "PHOTOFLOW_UPDATE_URL",
    "https://api.github.com/repos/indraaryaLabs/photoflow-ecosystem/releases/latest",
)

BACKEND_URL = os.environ.get(
    "PHOTOFLOW_BACKEND_URL",
    "https://photoflow-backend.vercel.app",
).rstrip("/")

# Aplikasi web, dituju tombol "Open Web Dashboard".
#
# Alamatnya dulu ditulis langsung di dalam script.js, satu-satunya alamat di
# aplikasi ini yang tidak dapat ditimpa lewat environment. Akibatnya mengganti
# nama project Vercel mematikan tombol itu di setiap salinan yang sudah
# terpasang, dan satu-satunya perbaikan adalah merilis ulang installer-nya.
WEB_APP_URL = os.environ.get(
    "PHOTOFLOW_WEB_APP_URL",
    "https://photoflow.vercel.app",
).rstrip("/")

SUPABASE_URL = os.environ.get(
    "PHOTOFLOW_SUPABASE_URL",
    "https://fmmgdpfybzsdgwgrbbdo.supabase.co",
).rstrip("/")

SUPABASE_ANON_KEY = os.environ.get(
    "PHOTOFLOW_SUPABASE_ANON_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZtbWdkcGZ5YnpzZGd3Z3JiYmRvIiwicm9sZSI6"
    "ImFub24iLCJpYXQiOjE3NzU4MzY0MDMsImV4cCI6MjA5MTQxMjQwM30."
    "-Pg2zv8k0_kScJ2faY3mpRE451jBfETKioav9rYxeHc",
)

# DSN Sentry memang dirancang publik — ia hanya menentukan ke mana event
# dikirim, bukan memberi akses baca ke project-nya. Dikosongkan lewat env
# untuk mematikan crash reporting sepenuhnya.
SENTRY_DSN = os.environ.get(
    "PHOTOFLOW_SENTRY_DSN",
    "https://43bd67a0e045d6edbfc488b9df2d1199@o4511189367586816.ingest.de.sentry.io/4511189387640912",
)


def parse_version(text):
    """Ubah "1.10.2" jadi (1, 10, 2) untuk dibandingkan sebagai angka.

    Perbandingan string tidak bisa dipakai di sini: "1.10" < "1.9" karena
    karakter "1" lebih kecil dari "9", sehingga rilis 1.10 tidak akan pernah
    dianggap lebih baru dari 1.9. Bagian yang bukan angka diabaikan supaya
    tag seperti "v1.2.0" dan "1.2.0-beta" tetap terbaca.
    """
    cleaned = str(text or "").strip().lstrip("vV").split("-")[0].split("+")[0]
    parts = []
    for chunk in cleaned.split("."):
        digits = "".join(ch for ch in chunk if ch.isdigit())
        parts.append(int(digits) if digits else 0)
    return tuple(parts) if parts else (0,)


def is_newer(candidate, current=CURRENT_VERSION):
    """True kalau `candidate` adalah versi yang lebih baru dari `current`."""
    a, b = parse_version(candidate), parse_version(current)
    length = max(len(a), len(b))
    a += (0,) * (length - len(a))
    b += (0,) * (length - len(b))
    return a > b
