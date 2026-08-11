#!/usr/bin/env python3
"""Bangun ikon aplikasi desktop dari lambang PhotoFlow.

Ikon lama adalah gambar rana kamera -- sisa dari masa sebelum lambang sendiri
ada. Lambang itu sudah diganti di mana-mana (layar masuk, bilah sisi, favicon
aplikasi web), tapi berkas ikon jendela tidak ikut, jadi satu-satunya tempat
rana itu masih muncul justru yang paling sering dilihat: sudut bilah judul
dan bilah tugas.

Geometrinya disalin dari photoflow-web-portal/public/favicon.svg, digambar
ulang dengan primitif Pillow supaya skrip ini tidak menuntut peramban atau
pengurai SVG hanya untuk membuat satu berkas ikon.

Ikon aplikasi tidak bisa ikut tema, tidak seperti favicon. Yang dipakai adalah
rupa bawaan lambangnya -- kotak pekat, lambang terang -- ditambah cincin tipis
di tepi dalam supaya kotaknya tidak lenyap ketika bilah judulnya sama gelapnya.

Jalankan:  python3 tools/buat_ikon.py
"""

import math
import os
import struct

from PIL import Image, ImageDraw

AKAR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TUJUAN = os.path.join(AKAR, "web", "assets")

KOTAK = (33, 37, 41, 255)        # ash-800
LAMBANG = (248, 249, 250, 255)   # ash-50
CINCIN = (255, 255, 255, 24)     # hairline, hanya terlihat di atas latar gelap

# Semua koordinat memakai kanvas 40x40 yang sama dengan favicon.svg.
KANVAS = 40.0
SUPER = 16  # supersampling; digambar besar lalu diperkecil, itu antialiasnya


def gambar(ukuran, tebal_p, tebal_garis, tebal_potong, radius=9.0):
    """Gambar lambang pada kanvas persegi berukuran `ukuran` piksel."""
    n = ukuran * SUPER
    s = n / KANVAS

    def sk(v):
        return v * s

    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, n - 1, n - 1], radius=sk(radius), fill=KOTAK)

    # Lambangnya digambar di lapisan sendiri supaya guratan diagonal dapat
    # melubanginya. Melubangi berarti menulis alpha nol -- itu tidak bisa
    # dilakukan langsung di atas kotaknya, karena yang terlihat lewat lubang
    # itu haruslah kotaknya, bukan latar transparan.
    lapis = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    dl = ImageDraw.Draw(lapis)

    lp = sk(tebal_p)
    h = lp / 2
    # Ujung guratan di SVG-nya persegi, bukan bundar (stroke-linecap="square"),
    # dan sudutnya bersiku. Keduanya dicapai dengan memanjangkan garisnya
    # sejauh setengah tebal: pada ujung terbuka itu jadi tutup persegi, pada
    # sudut ia mengisi petak sudutnya persis seperti sambungan siku.
    #
    # Sempat dicoba menutupnya dengan titik bundar di tiap sudut. Hasilnya
    # huruf P bergelembung di lima tempat -- terlihat jelas berdampingan
    # dengan favicon aplikasi web yang jadi acuannya.
    dl.line([sk(14.75), sk(30.5) + h, sk(14.75), sk(10.5) - h], fill=LAMBANG, width=round(lp))
    dl.line([sk(14.75) - h, sk(10.5), sk(23.75), sk(10.5)], fill=LAMBANG, width=round(lp))
    dl.line([sk(23.75), sk(23.5), sk(14.75) - h, sk(23.5)], fill=LAMBANG, width=round(lp))
    # Perut huruf P: setengah lingkaran berjari-jari 6.5 berpusat di (23.75, 17).
    # Ujung busurnya terpotong sepanjang jari-jari, jadi ia bertemu rata dengan
    # ujung kedua guratan mendatar tanpa perlu ditambal.
    #
    # Kotak pembatasnya dilebarkan setengah tebal. Pillow menggambar busur ke
    # ARAH DALAM dari kotak itu, sementara guratan SVG duduk di tengah-tengah
    # jalurnya. Tanpa pelebaran ini perutnya melesat ke dalam sejauh setengah
    # tebal dan tidak lagi bertemu ujung kedua guratan mendatar -- takik yang
    # baru kelihatan ketika ditaruh berdampingan dengan acuannya.
    r = 6.5 + tebal_p / 2
    kotak_busur = [sk(23.75 - r), sk(17 - r), sk(23.75 + r), sk(17 + r)]
    dl.arc(kotak_busur, start=-90, end=90, fill=LAMBANG, width=round(lp))

    # Celah: guratan diagonal yang lebih tebal, ditulis sebagai alpha nol.
    potong = Image.new("L", (n, n), 255)
    dp = ImageDraw.Draw(potong)
    dp.line([sk(9.75), sk(26), sk(26.25), sk(9.5)], fill=0, width=round(sk(tebal_potong)))
    lapis.putalpha(Image.composite(lapis.getchannel("A"), Image.new("L", (n, n), 0), potong))

    img.alpha_composite(lapis)

    # Guratan diagonalnya sendiri, digambar setelah celahnya. Tutup perseginya
    # memanjang searah garis, jadi tambahannya dipecah ke sumbu x dan y.
    wg = sk(tebal_garis)
    e = wg / 2 * math.sqrt(0.5)
    d.line(
        [sk(9.75) - e, sk(26) + e, sk(26.25) + e, sk(9.5) - e],
        fill=LAMBANG, width=round(wg),
    )

    # Cincin tepi dalam.
    tepi = max(1.0, sk(0.6))
    d.rounded_rectangle(
        [tepi / 2, tepi / 2, n - 1 - tepi / 2, n - 1 - tepi / 2],
        radius=sk(radius) - tepi / 2, outline=CINCIN, width=round(tepi),
    )

    return img.resize((ukuran, ukuran), Image.LANCZOS)


def untuk(ukuran):
    """Ukuran kecil menuntut guratan lebih tebal; kalau tidak, lambangnya hilang."""
    if ukuran <= 24:
        return gambar(ukuran, 4.6, 4.0, 7.2, radius=8.0)
    if ukuran <= 48:
        return gambar(ukuran, 3.8, 3.3, 6.2, radius=8.5)
    return gambar(ukuran, 3.2, 2.8, 5.4)


UKURAN_ICO = [16, 24, 32, 48, 64, 72, 96, 128, 256]

# Tipe ICNS yang isinya boleh PNG, beserta ukuran piksel yang dituntutnya.
TIPE_ICNS = [
    (b"icp4", 16), (b"icp5", 32), (b"ic11", 32), (b"ic12", 64),
    (b"ic07", 128), (b"ic13", 256), (b"ic08", 256),
    (b"ic14", 512), (b"ic09", 512), (b"ic10", 1024),
]


def tulis_icns(jalur, gambar_per_ukuran):
    """Susun berkas .icns sendiri.

    Pillow hanya dapat menulis ICNS di macOS, karena ia memanggil `iconutil`.
    Bentuk berkasnya sendiri sederhana: kepala 'icns', lalu potongan bertipe
    yang isinya boleh berupa PNG apa adanya.
    """
    import io

    potongan = []
    for tipe, ukuran in TIPE_ICNS:
        buf = io.BytesIO()
        gambar_per_ukuran[ukuran].save(buf, format="PNG")
        data = buf.getvalue()
        potongan.append(tipe + struct.pack(">I", len(data) + 8) + data)

    isi = b"".join(potongan)
    with open(jalur, "wb") as f:
        f.write(b"icns" + struct.pack(">I", len(isi) + 8) + isi)


def main():
    perlu = sorted(set(UKURAN_ICO + [u for _, u in TIPE_ICNS]))
    peta = {u: untuk(u) for u in perlu}

    ico = os.path.join(TUJUAN, "icon.ico")
    peta[256].save(ico, format="ICO", sizes=[(u, u) for u in UKURAN_ICO])
    print("ditulis", ico)

    icns = os.path.join(TUJUAN, "icon.icns")
    tulis_icns(icns, peta)
    print("ditulis", icns)


if __name__ == "__main__":
    main()
