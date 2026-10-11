/**
 * Bayi kayıt linkinin veritabanına dokunmayan kuralları: link anahtarı, form doğrulama
 * ve hız sınırı. Form herkese açık olduğu için gelen her alan burada denetlenir.
 */
import crypto from 'crypto';

/** Link anahtarı: tahmin edilemez 256 bit, adres çubuğuna uygun 43 karakter. */
export function generateLinkToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function isLinkToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/**
 * Türkçe büyük harfe çevirir (i -> İ, ı -> I). Ofisteki kayıt formu da metinleri böyle
 * büyütür; listede aynı görünsünler. Sunucunun dil desteğine bağlı kalmamak için elle.
 */
export function upperTr(value: string): string {
  return value.replace(/i/g, 'İ').replace(/ı/g, 'I').toUpperCase();
}

export interface BayiKayit {
  ad_soyad: string;
  ilce: string;
  mahalle: string;
  cadde: string;
  sokak: string;
  kapi_no: string;
  apartman_site: string | null;
  blok_no: string | null;
  daire_no: string;
  cep_tel: string;
  yedek_tel: string | null;
  urun: string;
  marka: string;
  sikayet: string;
}

export type ParsedKayit = { ok: true; value: BayiKayit } | { ok: false; message: string };

function text(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  // Tek satırlık alanlarda satır sonu ve fazla boşluk tek boşluğa iner.
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Formdan gelen kaydı doğrular. Kurallar ofisteki kayıt formuyla aynıdır: ad soyad, ilçe,
 * mahalle, kapı no, daire no, cep telefonu, ürün, marka ve şikâyet zorunludur; cadde ile
 * sokaktan en az biri dolu olmalıdır. Uzun metin sessizce kesilmez, hata döner.
 */
export function parseBayiKayit(input: unknown): ParsedKayit {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: 'Geçersiz form' };
  }
  const body = input as Record<string, unknown>;
  const fail = (message: string): ParsedKayit => ({ ok: false, message });

  const limits: Array<[key: string, label: string, max: number]> = [
    ['ad_soyad', 'Ad Soyad', 100],
    ['ilce', 'İlçe', 100],
    ['mahalle', 'Mahalle', 100],
    ['cadde', 'Cadde', 100],
    ['sokak', 'Sokak', 100],
    ['kapi_no', 'Kapı No', 20],
    ['apartman_site', 'Apartman/Site', 100],
    ['blok_no', 'Blok', 20],
    ['daire_no', 'Daire No', 20],
    ['urun', 'Ürün', 100],
    ['marka', 'Marka', 100],
    ['sikayet', 'Şikayet', 1000],
  ];
  for (const [key, label, max] of limits) {
    if (body[key] !== undefined && body[key] !== null && typeof body[key] !== 'string') {
      return fail(`${label} alanı geçersiz`);
    }
    if (text(body, key).length > max) return fail(`${label} en fazla ${max} karakter olabilir`);
  }

  const required: Array<[key: string, label: string]> = [
    ['ad_soyad', 'Ad Soyad'],
    ['ilce', 'İlçe'],
    ['mahalle', 'Mahalle'],
    ['kapi_no', 'Kapı No'],
    ['daire_no', 'Daire No'],
    ['urun', 'Ürün'],
    ['marka', 'Marka'],
    ['sikayet', 'Şikayet'],
  ];
  for (const [key, label] of required) {
    if (!text(body, key)) return fail(`${label} alanı zorunludur`);
  }
  if (!text(body, 'cadde') && !text(body, 'sokak')) {
    return fail('Cadde veya Sokak alanlarından en az biri doldurulmalıdır');
  }

  const digits = (key: string): string =>
    typeof body[key] === 'string' ? (body[key] as string).replace(/\D/g, '') : '';
  const cepTel = digits('cep_tel');
  if (!cepTel) return fail('Cep Telefonu alanı zorunludur');
  if (cepTel.length !== 11) return fail('Cep telefonu 11 haneli olmalıdır (05XX XXX XX XX)');
  const yedekTel = digits('yedek_tel');
  if (yedekTel && yedekTel.length !== 11) return fail('Yedek telefon numarası 11 haneli olmalıdır');

  return {
    ok: true,
    value: {
      ad_soyad: upperTr(text(body, 'ad_soyad')),
      // İlçe, mahalle, ürün ve marka listeden seçilir; olduğu gibi alınır ve çağıran
      // listede var olduklarını ayrıca doğrular.
      ilce: text(body, 'ilce'),
      mahalle: text(body, 'mahalle'),
      cadde: upperTr(text(body, 'cadde')),
      sokak: upperTr(text(body, 'sokak')),
      kapi_no: upperTr(text(body, 'kapi_no')),
      apartman_site: upperTr(text(body, 'apartman_site')) || null,
      blok_no: upperTr(text(body, 'blok_no')) || null,
      daire_no: upperTr(text(body, 'daire_no')),
      cep_tel: cepTel,
      yedek_tel: yedekTel || null,
      urun: text(body, 'urun'),
      marka: text(body, 'marka'),
      sikayet: upperTr(text(body, 'sikayet')),
    },
  };
}

/** İşlem kaydında "kim açtı" alanına yazılan değer (kolon 50 karakter). */
export function bayiCreatedBy(bayiIsim: string): string {
  return `Bayi: ${bayiIsim}`.slice(0, 50);
}

export interface RateLimiter {
  /** İzin varsa true döner ve denemeyi sayar; sınır dolmuşsa false. */
  allow(key: string): boolean;
}

/**
 * Kayan pencereli hız sınırı: `windowMs` içinde anahtar başına en çok `max` deneme.
 * Bellekte tutulur (uygulama tek süreç çalışır). `now` testlerde saati sabitlemek içindir.
 */
export function createRateLimiter(max: number, windowMs: number, now: () => number = Date.now): RateLimiter {
  const attempts = new Map<string, number[]>();
  return {
    allow(key) {
      const current = now();
      const recent = (attempts.get(key) ?? []).filter((time) => current - time < windowMs);
      if (recent.length >= max) {
        attempts.set(key, recent);
        return false;
      }
      recent.push(current);
      attempts.set(key, recent);
      return true;
    },
  };
}
