/**
 * Saha kayıtlarındaki fotoğrafların ortak modeli ve yardımcıları.
 *
 * Bir fotoğraf üç yerden gelebilir:
 *   1. R2 (depo): sunucu imzalı görüntüleme/indirme adresleri verir; `id` doludur.
 *   2. Eski kayıt: fotoğraf veritabanında base64 (`foto_data`) olarak durur; `url` bir
 *      data: adresidir. İki sürümü vardır:
 *        ["data:image/jpeg;base64,...", ...]
 *        [{ "name": "IMG_2034.jpg", "data": "data:image/jpeg;base64,..." }, ...]
 *   3. Formda yeni seçilmiş dosya: henüz yüklenmemiştir; `upload` doludur ve `url`
 *      tarayıcıdaki geçici (blob:) adrestir.
 */

/** Yüklenmeye hazır (küçültülmüş) fotoğraf. */
export interface PreparedPhoto {
  blob: Blob;
  /** 400 px önizleme; üretilemediyse null (o zaman fotoğrafın kendisi kullanılır). */
  thumbBlob: Blob | null;
}

export interface SahaPhoto {
  /** Görüntüleme adresi (https:, data: ya da blob:). */
  url: string;
  /** Küçük önizleme adresi; yoksa `url` ile aynıdır. */
  thumbUrl: string;
  /** Yüklendiği andaki orijinal dosya adı. Eski kayıtlarda olmayabilir. */
  name?: string;
  /** R2'deki fotoğrafın numarası. */
  id?: number;
  /** R2: dosyayı doğru adla indirten imzalı adres. */
  downloadUrl?: string;
  /** R2: indirme adı (sunucu üretir). */
  downloadName?: string;
  /** Yeni seçilmiş, henüz yüklenmemiş dosya. */
  upload?: PreparedPhoto;
}

/** `GET /saha/kayit-photos/:id` yanıtı. */
export interface SahaPhotosResponse {
  fotolar?: Array<{
    id: number;
    name: string | null;
    url: string;
    thumb_url: string;
    download_url: string;
    download_name: string;
  }>;
  foto_data?: string | null;
}

/** Eski biçimdeki foto_data yükünü — hangi sürüm olursa olsun — tek biçime indirger. */
export function parseSahaPhotos(raw: string | null | undefined): SahaPhoto[] {
  if (!raw) return [];
  const legacy = (data: string, name?: string): SahaPhoto => ({ url: data, thumbUrl: data, name });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Hiç JSON değilse tek bir data URL'dir
    return [legacy(raw)];
  }

  if (!Array.isArray(parsed)) {
    return typeof parsed === 'string' ? [legacy(parsed)] : [legacy(raw)];
  }

  return parsed
    .map((item): SahaPhoto | null => {
      if (typeof item === 'string') return legacy(item);
      if (item && typeof item === 'object' && typeof (item as any).data === 'string') {
        const name = (item as any).name;
        return legacy((item as any).data, typeof name === 'string' ? name : undefined);
      }
      return null;
    })
    .filter((p): p is SahaPhoto => p !== null);
}

/** Sunucu yanıtını fotoğraf listesine çevirir: R2 fotoğrafları varsa onlar, yoksa eski biçim. */
export function photosFromResponse(response: SahaPhotosResponse): SahaPhoto[] {
  if (response.fotolar && response.fotolar.length > 0) {
    return response.fotolar.map((foto) => ({
      id: foto.id,
      url: foto.url,
      thumbUrl: foto.thumb_url,
      name: foto.name ?? undefined,
      downloadUrl: foto.download_url,
      downloadName: foto.download_name,
    }));
  }
  return parseSahaPhotos(response.foto_data);
}

/** Bir data URL'in ya da dosyanın MIME tipinden dosya uzantısı çıkarır. */
function extensionOf(photo: SahaPhoto): string {
  const mime = photo.upload?.blob.type || /^data:(image\/[a-z0-9.+-]+)/i.exec(photo.url)?.[1] || '';
  const subtype = mime.toLowerCase().replace(/^image\//, '');
  if (!subtype || subtype === 'jpeg') return 'jpg';
  if (subtype === 'svg+xml') return 'svg';
  return subtype;
}

/** Dosya sisteminde sorun çıkaran karakterleri temizler. */
function sanitizeFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 120);
}

/**
 * İndirme için dosya adı üretir.
 *
 * R2'deki fotoğraflarda adı sunucu verir. Diğerlerinde öncelik sırası:
 *   1. Fotoğrafın saklanan orijinal adı
 *   2. `fallbackBase` (ör. "Ahmet_Yilmaz_2026-07-28")
 *
 * Uzantı her durumda verinin GERÇEK MIME tipinden alınır: yükleme sırasında
 * görüntü yeniden kodlanıyor, dolayısıyla ".png" olarak seçilen bir dosya
 * JPEG olarak duruyor olabilir.
 */
export function buildPhotoFileName(
  photo: SahaPhoto,
  fallbackBase: string,
  index: number,
  total: number
): string {
  if (photo.downloadName) return photo.downloadName;

  const ext = extensionOf(photo);

  if (photo.name) {
    const base = sanitizeFileName(photo.name.replace(/\.[^.]+$/, ''));
    if (base) return `${base}.${ext}`;
  }

  const base = sanitizeFileName(fallbackBase) || 'fotograf';
  const suffix = total > 1 ? `_${index + 1}` : '';
  return `${base}${suffix}.${ext}`;
}

function clickDownloadLink(href: string, fileName?: string): void {
  const link = document.createElement('a');
  link.href = href;
  if (fileName) link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/** data: URL'i Blob'a çevirir. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const commaIndex = dataUrl.indexOf(',');
  const header = commaIndex >= 0 ? dataUrl.slice(0, commaIndex) : '';
  const payload = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  const mime = /^data:([^;,]+)/.exec(header)?.[1] || 'image/jpeg';

  if (/;base64/i.test(header)) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(payload)], { type: mime });
}

/** Fotoğrafı tarayıcıya indirtir. */
export function downloadPhoto(photo: SahaPhoto, fileName: string): void {
  // R2: adres başka bir alan adında olduğu için tarayıcı `download` özniteliğini yok
  // sayar; dosya adını imzalı adresin kendisi (Content-Disposition) taşır.
  if (photo.downloadUrl) {
    clickDownloadLink(photo.downloadUrl);
    return;
  }

  if (photo.url.startsWith('data:')) {
    const url = URL.createObjectURL(dataUrlToBlob(photo.url));
    clickDownloadLink(url, fileName);
    // Chrome indirmeyi başlatana kadar URL'in yaşaması gerekiyor.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return;
  }

  clickDownloadLink(photo.url, fileName);
}
