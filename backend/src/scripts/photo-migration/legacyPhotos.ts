/**
 * Eski biçimdeki (veritabanında base64 duran) saha fotoğraflarının R2'ye taşınmak üzere
 * çözülmesi ve hazırlanması. Veritabanına ve depoya dokunmaz.
 */
import crypto from 'crypto';
import sharp from 'sharp';
import { extensionForMimeType, isUploadableMimeType } from '../../utils/sahaPhotoRules';

/** Arayüzdeki yeni yüklemelerle aynı biçim (bkz. frontend/src/utils/sahaPhotoUpload.ts). */
const PHOTO_MAX_EDGE = 2000;
const PHOTO_QUALITY = 82;
const THUMB_MAX_EDGE = 400;
const THUMB_QUALITY = 80;

export interface LegacyPhoto {
  dataUrl: string;
  name: string | null;
}

/**
 * foto_data yükünü fotoğraf listesine çevirir. İki sürüm vardır:
 *   ["data:image/jpeg;base64,...", ...]
 *   [{ "name": "IMG_2034.jpg", "data": "data:image/jpeg;base64,..." }, ...]
 * Arayüz JSON olmayan yükü tek bir data URL sayar; burada da öyle. Çözülemeyen öğe
 * `null` olarak döner: sıra numaraları kaymaz ve taşıma raporunda hata olarak görünür.
 */
export function parseLegacyPhotos(raw: string): Array<LegacyPhoto | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [{ dataUrl: raw, name: null }];
  }
  if (typeof parsed === 'string') return [{ dataUrl: parsed, name: null }];
  if (!Array.isArray(parsed)) return [null];

  return parsed.map((item): LegacyPhoto | null => {
    if (typeof item === 'string') return { dataUrl: item, name: null };
    if (item && typeof item === 'object' && typeof (item as { data?: unknown }).data === 'string') {
      const name = (item as { name?: unknown }).name;
      return {
        dataUrl: (item as { data: string }).data,
        name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 255) : null,
      };
    }
    return null;
  });
}

/** data: adresini bayt dizisine ve dosya tipine çevirir; geçersizse null. */
export function decodeDataUrl(dataUrl: string): { body: Buffer; mimeType: string } | null {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma < 0) return null;
  const header = dataUrl.slice(5, comma);
  const mimeType = header.split(';')[0].trim().toLowerCase();
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mimeType)) return null;

  const payload = dataUrl.slice(comma + 1);
  let body: Buffer;
  if (/;base64$/i.test(header)) {
    body = Buffer.from(payload, 'base64');
  } else {
    try {
      body = Buffer.from(decodeURIComponent(payload), 'utf8');
    } catch {
      return null;
    }
  }
  return body.length > 0 ? { body, mimeType } : null;
}

export interface PreparedLegacyPhoto {
  /** Depoya yazılacak dosya. */
  body: Buffer;
  mimeType: string;
  /** 400 px önizleme; görüntü açılamadıysa null. */
  thumb: Buffer | null;
  /** 'resized': küçültüldü · 'original': orijinali saklandı · 'unreadable': açılamadı, olduğu gibi saklandı */
  outcome: 'resized' | 'original' | 'unreadable';
}

/**
 * Fotoğrafı taşımaya hazırlar: en uzun kenarı 2000 px JPEG (kalite 82) + 400 px önizleme.
 *
 * Küçültülmüş hali orijinalden büyük çıkarsa ve orijinal tarayıcıların gösterebildiği
 * bir tipteyse orijinali saklanır. Görüntü açılamazsa dosya OLDUĞU GİBİ, önizlemesiz
 * saklanır: taşıma sırasında hiçbir fotoğraf atılmaz.
 */
export async function prepareLegacyPhoto(body: Buffer, mimeType: string): Promise<PreparedLegacyPhoto> {
  try {
    // rotate(): telefonun yön (EXIF) bilgisi uygulanır. flatten: JPEG saydamlık taşımaz,
    // saydam arka plan siyah değil beyaz olur.
    const render = (edge: number, quality: number): Promise<Buffer> =>
      sharp(body, { failOn: 'error' })
        .rotate()
        .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();

    const [resized, thumb] = await Promise.all([
      render(PHOTO_MAX_EDGE, PHOTO_QUALITY),
      render(THUMB_MAX_EDGE, THUMB_QUALITY),
    ]);
    if (isUploadableMimeType(mimeType) && resized.length >= body.length) {
      return { body, mimeType, thumb, outcome: 'original' };
    }
    return { body: resized, mimeType: 'image/jpeg', thumb, outcome: 'resized' };
  } catch {
    return { body, mimeType: mimeType.slice(0, 100), thumb: null, outcome: 'unreadable' };
  }
}

export function sha256(body: Buffer): string {
  return crypto.createHash('sha256').update(body).digest('hex');
}

/**
 * Taşınan fotoğrafın depo adresleri. Adres kayıt numarası, sıra ve ORİJİNAL içeriğin
 * özetinden oluşur: aynı fotoğraf yeniden taşınırsa aynı adrese yazılır (idempotent).
 */
export function legacyObjectKeys(
  kayitId: number,
  index: number,
  originalChecksum: string,
  mimeType: string,
): { objectKey: string; thumbKey: string } {
  const base = `saha/eski/${kayitId}/${index}-${originalChecksum.slice(0, 16)}`;
  return { objectKey: `${base}.${extensionForMimeType(mimeType)}`, thumbKey: `${base}_k.jpg` };
}
