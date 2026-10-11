import { useCallback, useRef } from 'react';
import { sahaService } from '../services/saha.service';
import { SahaPhoto } from '../utils/sahaPhoto';

// Sunucunun verdiği imzalı fotoğraf adresleri en az 90 dakika geçerlidir. Önbellekteki
// liste bu süreden önce yenilenir; yoksa uzun süre açık kalan sayfada fotoğraf açılmaz.
const CACHE_TTL_MS = 60 * 60 * 1000;

interface Entry {
  photos: SahaPhoto[];
  fetchedAt: number;
}

/**
 * Kayıtların fotoğraf listelerini sayfa açık kaldığı sürece saklar: aynı kaydın
 * fotoğrafları ikinci kez açıldığında sunucuya gidilmez.
 */
export function useSahaPhotoCache() {
  const cache = useRef(new Map<number, Entry>());

  const load = useCallback(async (kayitId: number): Promise<SahaPhoto[]> => {
    const cached = cache.current.get(kayitId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.photos;

    const photos = await sahaService.getKayitPhotos(kayitId);
    cache.current.set(kayitId, { photos, fetchedAt: Date.now() });
    return photos;
  }, []);

  /** Kaydın fotoğrafları değişti: bir sonraki açılışta sunucudan yeniden okunur. */
  const invalidate = useCallback((kayitId: number) => {
    cache.current.delete(kayitId);
  }, []);

  return { load, invalidate };
}
