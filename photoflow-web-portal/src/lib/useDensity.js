import { useEffect, useState } from 'react';
import { DENSITIES, DEFAULT_DENSITY } from './justifiedRows';

/** Kerapatan tersimpan per peramban, bukan per galeri: ini preferensi orangnya. */
export function useDensity() {
  const [density, setDensity] = useState(() => {
    try {
      const tersimpan = window.localStorage.getItem('photoflow.density');
      return DENSITIES[tersimpan] ? tersimpan : DEFAULT_DENSITY;
    } catch {
      return DEFAULT_DENSITY;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem('photoflow.density', density);
    } catch {
      // Penyimpanan diblokir. Kerapatannya tetap berlaku selama tab terbuka.
    }
  }, [density]);

  return [density, setDensity];
}
