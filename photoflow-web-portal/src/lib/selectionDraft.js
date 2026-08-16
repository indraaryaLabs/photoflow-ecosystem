/**
 * Simpan pilihan klien yang belum dikirim, di perambannya sendiri.
 *
 * Sampai sekarang pilihan hanya hidup di state React. Menutup tab, menekan
 * refresh, atau kehabisan baterai berarti seluruhnya hilang — dan galeri
 * pernikahan berisi ratusan foto tidak dipilih dalam satu duduk. Kegagalan
 * seperti ini yang membuat orang berhenti memakai sebuah produk: bukan
 * karena rusak, tapi karena kerjanya lenyap.
 *
 * Yang disimpan NAMA BERKAS, bukan id-nya. Dua alasan:
 *
 *   1. id foto tidak stabil antar sumber. Ketika daftar datang dari Drive,
 *      id-nya adalah id berkas Drive; ketika Drive tidak terbaca dan backend
 *      jatuh ke salinan database, id-nya UUID baris. Satu galeri yang sama
 *      bisa memuat keduanya pada dua kunjungan berbeda, dan draf berisi id
 *      akan cocok ke nol foto tanpa satu pun tanda.
 *
 *   2. Nama berkas juga yang dikirim saat submit, jadi draf tersimpan sudah
 *      dalam satuan yang sama dengan hasil akhirnya.
 *
 * Foto yang namanya sudah tidak ada di folder — misalnya karena fotografer
 * menghapusnya lalu menarik ulang — hilang sendiri saat draf dipetakan
 * kembali. Itu perilaku yang diinginkan; memilih foto yang tidak lagi ada
 * tidak ada artinya.
 */

const AWALAN = 'photoflow.selection.';

// Draf yang lebih tua dari ini dibuang saat dibaca. Galeri klien selesai dalam
// hitungan hari; draf setahun lalu hampir pasti milik proyek yang sudah lama
// dikirim, dan memulihkannya justru membingungkan.
const UMUR_MAKS_HARI = 30;

function kunci(token) {
  return AWALAN + token;
}

/**
 * Nama berkas yang tersimpan untuk token ini.
 *
 * Selalu mengembalikan array. Setiap kegagalan — localStorage diblokir
 * (Safari mode pribadi melempar saat diakses), JSON rusak, bentuk tak terduga
 * — dianggap "tidak ada draf". Draf yang tidak terbaca tidak boleh membuat
 * galerinya gagal dibuka.
 */
export function bacaDraf(token) {
  if (!token) return [];
  try {
    const mentah = window.localStorage.getItem(kunci(token));
    if (!mentah) return [];

    const data = JSON.parse(mentah);
    if (!Array.isArray(data?.names)) return [];

    const umurHari = (Date.now() - (data.savedAt ?? 0)) / 86400000;
    if (umurHari > UMUR_MAKS_HARI) {
      hapusDraf(token);
      return [];
    }

    return data.names.filter((n) => typeof n === 'string' && n);
  } catch {
    return [];
  }
}

export function simpanDraf(token, names) {
  if (!token) return;
  try {
    if (!names.length) {
      window.localStorage.removeItem(kunci(token));
      return;
    }
    window.localStorage.setItem(kunci(token), JSON.stringify({
      names,
      savedAt: Date.now(),
    }));
  } catch {
    // Kuota penuh atau penyimpanan diblokir. Pilihannya tetap hidup di memori
    // selama tab terbuka; yang hilang hanya kemampuan memulihkannya nanti.
    // Itu bukan alasan untuk mengganggu orang yang sedang memilih foto.
  }
}

export function hapusDraf(token) {
  if (!token) return;
  try {
    window.localStorage.removeItem(kunci(token));
  } catch {
    // Sama seperti di atas: tidak ada yang bisa dilakukan, dan tidak ada yang
    // perlu dikatakan.
  }
}

/**
 * Petakan nama tersimpan ke id foto yang sedang ditampilkan.
 *
 * @param {string[]} names   dari bacaDraf()
 * @param {Array}    photos  daftar foto yang sedang tampil
 * @param {number}   max     batas jumlah pilihan proyek ini
 * @returns {Set<string>} id foto, tidak pernah melebihi `max`
 */
export function petakanKeId(names, photos, max) {
  const perNama = new Map();
  photos.forEach((p) => {
    if (p?.name && !perNama.has(p.name)) perNama.set(p.name, p.id);
  });

  const ids = new Set();
  for (const nama of names) {
    // Batas pilihan bisa saja diturunkan fotografer setelah draf tersimpan.
    // Memulihkan lebih banyak dari yang kini diizinkan membuat galerinya
    // terbuka dalam keadaan yang tidak bisa dikirim.
    if (Number.isFinite(max) && ids.size >= max) break;
    const id = perNama.get(nama);
    if (id !== undefined) ids.add(id);
  }
  return ids;
}
