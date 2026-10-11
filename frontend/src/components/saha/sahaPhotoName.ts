import { SahaKayit } from '../../types';

/**
 * İndirilen fotoğrafın dosya adı tabanı: kayıttaki ad soyad ("Ahmet_Yilmaz").
 * R2'deki fotoğraflarda adı sunucu verir; bu, henüz yüklenmemiş ya da eski biçimdeki
 * fotoğraflar için aynı kuralın arayüzdeki karşılığıdır.
 */
export function buildKayitFallbackName(kayit?: SahaKayit | null): string {
  if (!kayit) return 'fotograf';
  return [kayit.isim, kayit.soyisim].filter(Boolean).join('_') || 'fotograf';
}
