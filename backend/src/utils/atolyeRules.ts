/** Atölye kayıtlarının veritabanına dokunmayan kuralları. */

/** Tek seferde açılabilecek en çok kayıt (yanlışlıkla "300" yazılmasına karşı). */
export const MAX_ATOLYE_ADET = 100;

/**
 * Yeni kayıt isteğindeki `adet` alanı: aynı üründen kaç ayrı kayıt açılacağı.
 * Alan gönderilmediyse 1'dir. Geçersizse null döner.
 */
export function parseAdet(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return 1;
  const adet = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  if (typeof adet !== 'number' || !Number.isSafeInteger(adet)) return null;
  return adet >= 1 && adet <= MAX_ATOLYE_ADET ? adet : null;
}
