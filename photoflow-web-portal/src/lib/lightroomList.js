/**
 * Menyusun daftar nama berkas untuk ditempel ke penyaring Lightroom Classic.
 *
 * Cara pakainya di sisi fotografer: Library Filter → Text → Filename →
 * Contains, lalu tempel. Lightroom memecah isian itu pada koma dan
 * memperlakukan tiap potongan sebagai kata kunci "mengandung", jadi hasilnya
 * adalah gabungan semua foto yang namanya memuat salah satu potongan.
 *
 * Yang membuat ini bekerja untuk kasus PhotoFlow — dan ini inti seluruh
 * berkas ini — adalah "Contains", bukan "Equals". Klien memilih dari JPG di
 * Drive, sementara yang ada di katalog Lightroom adalah RAW-nya. Nama
 * dasarnya sama (fotografer menjaga itu), yang berbeda hanya ekstensinya.
 * Dengan membuang ekstensi, `IMG_1234` cocok ke `IMG_1234.CR3` tanpa siapa
 * pun perlu menebak ekstensi mana yang benar.
 *
 * Karena itu MODE_BASENAME yang jadi bawaan, bukan MODE_ORIGINAL.
 */

export const MODE_BASENAME = 'basename';
export const MODE_ORIGINAL = 'original';
export const MODE_REPLACE = 'replace';

/** Ekstensi RAW yang ditawarkan pada mode "ganti ekstensi". */
export const RAW_EXTENSIONS = [
  'CR2', 'CR3', 'NEF', 'NRW', 'ARW', 'RAF', 'RW2', 'ORF', 'PEF', 'DNG',
];

/** Buang ekstensi terakhir. `IMG_1234.CR3` → `IMG_1234`. */
export function stripExtension(name) {
  const titik = name.lastIndexOf('.');
  // Titik di posisi 0 berarti berkas tersembunyi tanpa ekstensi (`.gitignore`),
  // bukan berkas berekstensi. Namanya dibiarkan utuh.
  return titik > 0 ? name.slice(0, titik) : name;
}

/**
 * Nama yang memuat spasi tidak dapat dipakai di penyaring Lightroom.
 *
 * Lightroom memecah isian pada koma DAN spasi, jadi `Bali Trip 001` masuk
 * sebagai tiga kata kunci terpisah — dan `Bali` akan menyeret setiap foto lain
 * yang namanya memuat kata itu. Ini batasan Lightroom, bukan sesuatu yang bisa
 * kita perbaiki dengan mengutip atau meloloskan karakter; satu-satunya
 * tindakan yang jujur adalah memberitahukannya.
 */
export function namesWithSpaces(names) {
  return names.filter((n) => /\s/.test(stripExtension(n)));
}

/**
 * @param {string[]} names  nama berkas apa adanya, seperti tersimpan di database
 * @param {object}   opsi
 * @param {string}   opsi.mode       MODE_BASENAME | MODE_ORIGINAL | MODE_REPLACE
 * @param {string}   opsi.extension  dipakai hanya pada MODE_REPLACE, tanpa titik
 * @returns {string} siap tempel
 */
export function buildLightroomList(names, { mode = MODE_BASENAME, extension = 'CR3' } = {}) {
  const bersih = names.map((n) => (n ?? '').trim()).filter(Boolean);

  const potongan = bersih.map((nama) => {
    if (mode === MODE_ORIGINAL) return nama;
    const dasar = stripExtension(nama);
    if (mode === MODE_REPLACE) {
      const ext = extension.replace(/^\./, '').trim();
      return ext ? `${dasar}.${ext}` : dasar;
    }
    return dasar;
  });

  // Nama kembar dibuang. Pada MODE_BASENAME itu bukan hal langka: sebuah
  // proyek bisa memuat `IMG_1234.jpg` dan `IMG_1234.jpeg` sekaligus, dan
  // keduanya menyusut jadi kata kunci yang sama. Mengirim duplikatnya hanya
  // memperpanjang isian penyaring tanpa mengubah hasilnya.
  const unik = [...new Set(potongan)];

  // Koma + spasi. Itu pemisah yang diminta Lightroom.
  return unik.join(', ');
}
