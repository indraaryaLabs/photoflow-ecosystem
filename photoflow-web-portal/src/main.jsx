import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Inter dilayani dari domain aplikasi sendiri, bukan dari Google Fonts.
//
// Sebelumnya index.html memuat <link> ke fonts.googleapis.com. Tautan itu
// MENGHALANGI PENGGAMBARAN: peramban menolak melukis satu piksel pun sebelum
// stylesheet-nya tiba, dan stylesheet itu ada di domain lain — satu DNS, satu
// TCP, satu TLS — yang kemudian menyuruhnya mengambil berkas fontnya dari
// domain LAIN lagi, fonts.gstatic.com, dengan rangkaian yang sama. Tiga
// perjalanan berantai sebelum halaman boleh terlihat.
//
// Diukur pada koneksi 8 Mbps dengan latensi 120ms: 13.103ms menjadi 571ms.
// Angka pertama itu keadaan terburuk — jaringan yang tidak dapat menjangkau
// Google sama sekali — tapi keadaan itu bukan hipotesis di Indonesia, dan
// bahkan pada jaringan sehat ongkosnya tetap ratusan milidetik layar kosong.
//
// Varian `wght` memuat seluruh rentang tebal 100-900 dalam satu berkas, dan
// dipecah per subset dengan `unicode-range` — peramban hanya mengunduh subset
// latin, 48 KB. `font-display: swap` sudah disetel di dalamnya, jadi teks
// tampil seketika memakai huruf sistem lalu berganti setibanya Inter.
import '@fontsource-variable/inter/wght.css'

import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
