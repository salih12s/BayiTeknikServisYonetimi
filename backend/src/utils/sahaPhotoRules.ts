/**
 * Saha fotoğraflarının veritabanına ve depoya dokunmayan kuralları: istek doğrulama,
 * depo adresi ve indirme adı üretimi. Saf fonksiyonlardır (girdi -> çıktı).
 */

export const MAX_PHOTOS_PER_RECORD = 5;
/** Tarayıcı fotoğrafı ~2000 px JPEG'e küçültür; küçültülemeyen orijinal en çok 10 MB'tır. */
export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
export const MAX_THUMB_BYTES = 512 * 1024;
export const THUMB_MIME_TYPE = 'image/jpeg';

/** Yüklemede kabul edilen (bütün tarayıcıların gösterebildiği) tipler ve uzantıları. */
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Dosya tipi yüklemede kabul edilenlerden biri mi? */
export function isUploadableMimeType(mimeType: string): boolean {
  return Object.prototype.hasOwnProperty.call(EXTENSION_BY_MIME, mimeType);
}

/**
 * Dosya tipinin uzantısı. Yüklemede kabul edilmeyen ama eski kayıtlardan olduğu gibi
 * taşınmış olabilecek tipler (ör. image/heic) için alt tip kullanılır.
 */
export function extensionForMimeType(mimeType: string): string {
  if (isUploadableMimeType(mimeType)) return EXTENSION_BY_MIME[mimeType];
  const subtype = /^image\/([a-z0-9]{1,8})$/.exec(mimeType)?.[1];
  return subtype ?? 'jpg';
}

export interface UploadRequestPhoto {
  name: string | null;
  mimeType: string;
  sizeBytes: number;
  thumbSizeBytes: number | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

function isByteCount(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max;
}

/** `POST /saha/foto-yukleme` gövdesini doğrular. */
export function parseUploadRequest(body: unknown): Parsed<UploadRequestPhoto[]> {
  const list = (body as { fotolar?: unknown } | null)?.fotolar;
  if (!Array.isArray(list) || list.length === 0) {
    return { ok: false, message: 'En az bir fotoğraf gerekli' };
  }
  if (list.length > MAX_PHOTOS_PER_RECORD) {
    return { ok: false, message: `En fazla ${MAX_PHOTOS_PER_RECORD} fotoğraf yüklenebilir` };
  }

  const photos: UploadRequestPhoto[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      return { ok: false, message: 'Geçersiz fotoğraf bilgisi' };
    }
    const { name, mime_type, size_bytes, thumb_size_bytes } = item as Record<string, unknown>;

    if (typeof mime_type !== 'string' || !isUploadableMimeType(mime_type)) {
      return { ok: false, message: 'Desteklenmeyen fotoğraf biçimi (JPEG, PNG ya da WebP olmalı)' };
    }
    if (!isByteCount(size_bytes, MAX_PHOTO_BYTES)) {
      return { ok: false, message: 'Fotoğraf boyutu geçersiz ya da çok büyük' };
    }
    if (
      thumb_size_bytes !== undefined &&
      thumb_size_bytes !== null &&
      !isByteCount(thumb_size_bytes, MAX_THUMB_BYTES)
    ) {
      return { ok: false, message: 'Önizleme boyutu geçersiz ya da çok büyük' };
    }
    if (name !== undefined && name !== null && typeof name !== 'string') {
      return { ok: false, message: 'Geçersiz dosya adı' };
    }

    photos.push({
      name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 255) : null,
      mimeType: mime_type,
      sizeBytes: size_bytes,
      thumbSizeBytes: isByteCount(thumb_size_bytes, MAX_THUMB_BYTES) ? thumb_size_bytes : null,
    });
  }
  return { ok: true, value: photos };
}

/**
 * Kayıt gövdesindeki `foto_ids` alanını doğrular. Alan hiç gönderilmediyse `null`
 * döner ("fotoğraflara dokunma"); boş dizi "bütün fotoğrafları kaldır" demektir.
 */
export function parsePhotoIds(value: unknown): Parsed<number[] | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (!Array.isArray(value)) return { ok: false, message: 'Geçersiz fotoğraf listesi' };
  if (value.length > MAX_PHOTOS_PER_RECORD) {
    return { ok: false, message: `En fazla ${MAX_PHOTOS_PER_RECORD} fotoğraf eklenebilir` };
  }
  if (!value.every((id) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)) {
    return { ok: false, message: 'Geçersiz fotoğraf listesi' };
  }
  if (new Set(value).size !== value.length) {
    return { ok: false, message: 'Aynı fotoğraf iki kez eklenemez' };
  }
  return { ok: true, value: value as number[] };
}

/** Yeni yüklenen bir fotoğrafın ve önizlemesinin depo adresleri. */
export function buildObjectKeys(
  uniqueId: string,
  mimeType: string,
  now: Date,
): { objectKey: string; thumbKey: string } {
  if (!isUploadableMimeType(mimeType)) throw new Error(`Desteklenmeyen fotoğraf biçimi: ${mimeType}`);
  const extension = EXTENSION_BY_MIME[mimeType];
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const base = `saha/${year}/${month}/${uniqueId}`;
  return { objectKey: `${base}.${extension}`, thumbKey: `${base}_k.jpg` };
}

/** Dosya sisteminde sorun çıkaran karakterleri temizler. */
export function sanitizeFileName(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 120);
}

/**
 * İndirme için dosya adı. Öncelik: fotoğrafın saklanan orijinal adı, yoksa kaydın
 * bilgilerinden üretilen ad (ör. "Ahmet_Yilmaz_2026-07-28_2"). Uzantı her durumda
 * dosyanın GERÇEK tipinden gelir: ".png" olarak seçilen dosya JPEG'e çevrilmiş olabilir.
 */
export function buildDownloadName(photo: {
  originalName: string | null;
  mimeType: string;
  fallbackBase: string;
  index: number;
  total: number;
}): string {
  const extension = extensionForMimeType(photo.mimeType);

  if (photo.originalName) {
    const base = sanitizeFileName(photo.originalName.replace(/\.[^.]+$/, ''));
    if (base) return `${base}.${extension}`;
  }

  const base = sanitizeFileName(photo.fallbackBase) || 'fotograf';
  const suffix = photo.total > 1 ? `_${photo.index + 1}` : '';
  return `${base}${suffix}.${extension}`;
}

/** Orijinal adı olmayan fotoğraflar için ad tabanı: "Ahmet_Yilmaz_2026-07-28". */
export function buildFallbackBase(kayit: {
  isim?: string | null;
  soyisim?: string | null;
  created_at?: Date | string | null;
}): string {
  const adSoyad = [kayit.isim, kayit.soyisim].filter(Boolean).join('_');
  const created =
    kayit.created_at instanceof Date ? kayit.created_at.toISOString() : String(kayit.created_at ?? '');
  const tarih = /^\d{4}-\d{2}-\d{2}/.exec(created)?.[0] ?? '';
  return [adSoyad, tarih].filter(Boolean).join('_') || 'fotograf';
}

/**
 * Eski biçimde (veritabanında base64) saklanan ilk fotoğrafın data URL'i. İki sürüm
 * vardır: `["data:image/..."]` ve `[{ "name": "...", "data": "data:image/..." }]`.
 * Fotoğraf yoksa null döner; metin JSON değilse hata fırlatır.
 */
export function firstLegacyPhoto(fotoData: string): string | null {
  const parsed: unknown = JSON.parse(fotoData);
  const first: unknown = Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : null;
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object' && typeof (first as { data?: unknown }).data === 'string') {
    return (first as { data: string }).data;
  }
  return null;
}
