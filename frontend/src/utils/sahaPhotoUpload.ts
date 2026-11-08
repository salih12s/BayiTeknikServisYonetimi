/**
 * Saha fotoğraflarının tarayıcıda hazırlanması ve depoya (R2) yüklenmesi.
 *
 * Fotoğraf sunucudan GEÇMEZ: tarayıcıda küçültülür, sunucudan alınan imzalı adrese
 * doğrudan yüklenir, kayıt kaydedilirken yalnızca fotoğrafın numarası gönderilir.
 */
import { api } from '../services/api';
import { reportClientEvent } from '../services/clientLog';
import { PreparedPhoto, SahaPhoto, dataUrlToBlob } from './sahaPhoto';

/** Fotoğrafın en uzun kenarı (piksel) ve JPEG kalitesi. */
const PHOTO_MAX_EDGE = 2000;
const PHOTO_QUALITY = 0.82;
const THUMB_MAX_EDGE = 400;
const THUMB_QUALITY = 0.8;

/** Sunucunun kabul ettiği dosya tipleri (orijinali olduğu gibi saklanan küçük dosyalar için). */
const UPLOADABLE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/**
 * Seçilebilecek en büyük dosya. Fotoğraf yüklenmeden önce küçültüldüğü için büyük olması
 * sorun değildir (50-200 MP telefon kameraları 15-30 MB çekebilir); orijinal yalnızca
 * küçültülmüş halinden küçükse saklanır.
 */
export const MAX_SOURCE_BYTES = 30 * 1024 * 1024;
export const MAX_PHOTOS = 5;

const READ_TIMEOUT_MS = 60000;
const READ_ATTEMPTS = 3;
const DECODE_TIMEOUT_MS = 20000;
/** Normal açma başarısız olursa (ör. telefonun belleği yetmedi) küçültülerek açılan genişlik. */
const REDUCED_DECODE_WIDTH = 1500;
const UPLOAD_TIMEOUT_MS = 120000;
const UPLOAD_ATTEMPTS = 3;

/**
 * Fotoğraf eklenemedi; `message` kullanıcıya olduğu gibi gösterilir. `code` ve `detail`
 * teşhis içindir (sunucu loguna gider): ör. `okunamadi` / `NotReadableError`.
 */
export class PhotoPrepareError extends Error {
  constructor(
    message: string,
    readonly code: 'okunamadi' | 'acilamadi',
    readonly detail?: string,
  ) {
    super(message);
  }
}

const errorName = (error: unknown): string | undefined =>
  error instanceof Error ? `${error.name}: ${error.message}` : error === undefined ? undefined : String(error);

const READ_FAILED_MESSAGE =
  'Fotoğraf telefondan okunamadı. Lütfen fotoğrafı yeniden çekin ya da galeriden yeniden seçin.';
const DECODE_FAILED_MESSAGE =
  'Fotoğraf açılamadı. Lütfen fotoğrafı yeniden çekin ya da başka bir fotoğraf seçin.';

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** İlk baytlara göre gerçek dosya tipi: JPEG, PNG, WebP ya da (başka bir şeyse) null. */
function sniffImageType(bytes: Uint8Array): string | null {
  const startsWith = (signature: number[], offset = 0) =>
    signature.every((byte, index) => bytes[offset + index] === byte);
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith([0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'; // RIFF....WEBP
  return null;
}

/** Dosyanın ilk baytları gerçekten JPEG, PNG ya da WebP mi? (uzantıya/tipe güvenilmez) */
async function hasImageSignature(blob: Blob): Promise<boolean> {
  return sniffImageType(new Uint8Array(await blob.slice(0, 12).arrayBuffer())) !== null;
}

/**
 * Seçilen dosyanın TAMAMINI hemen belleğe kopyalar; dosya seçilir seçilmez çağrılmalıdır.
 *
 * Neden: telefonda seçilen dosya, telefonun deposundaki dosyaya bağlı bir işarettir. Kamera
 * uygulaması fotoğrafı arka planda yeniden yazınca ya da okuma izni düşünce dosya sonradan
 * okunamaz hale gelir (Chrome: NotReadableError). Eskiden bu durumda fotoğraf "eklendi"
 * görünüyor, önizlemesi kırık çıkıyor ve kaydetme her denemede başarısız oluyordu. Bellekteki
 * kopya o dosyadan bağımsızdır: eklenen fotoğraf sonradan okunamaz hale gelemez.
 *
 * Okunamazsa PhotoPrepareError fırlatır (kullanıcı fotoğrafı yeniden çekmelidir).
 */
export async function readIntoMemory(file: Blob): Promise<Blob> {
  let lastError: string | undefined;
  for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt += 1) {
    try {
      const buffer = await withTimeout(file.arrayBuffer(), READ_TIMEOUT_MS, 'Fotoğraf zamanında okunamadı');
      if (buffer.byteLength === 0) {
        lastError = 'boş dosya (0 bayt)';
        break; // Boş dosya: tekrar okumak düzeltmez.
      }
      const type = sniffImageType(new Uint8Array(buffer, 0, Math.min(12, buffer.byteLength))) ?? file.type;
      return new Blob([buffer], { type });
    } catch (error) {
      lastError = `${errorName(error)} (deneme ${attempt})`;
      console.warn(`Fotoğraf okunamadı (deneme ${attempt}/${READ_ATTEMPTS}):`, error);
      // Süre aşımında okuma hâlâ sürüyor olabilir; üst üste yeni okuma başlatılmaz.
      if (error instanceof Error && error.message === 'Fotoğraf zamanında okunamadı') break;
    }
    if (attempt < READ_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
  }
  throw new PhotoPrepareError(READ_FAILED_MESSAGE, 'okunamadi', lastError);
}

/**
 * Dosyayı çizilebilir görüntüye çevirir (telefonun yön bilgisi uygulanmış olarak).
 * `reducedWidth` verilirse görüntü o genişliğe küçültülerek açılır: çok büyük fotoğrafta
 * telefonun belleği tam boy açmaya yetmediğinde kullanılır.
 */
async function decodeImage(blob: Blob, reducedWidth?: number): Promise<DecodedImage> {
  if (reducedWidth !== undefined) {
    if (typeof createImageBitmap !== 'function') throw new Error('Küçültülerek açma desteklenmiyor');
    const bitmap = await createImageBitmap(blob, {
      imageOrientation: 'from-image',
      resizeWidth: reducedWidth,
      resizeQuality: 'high',
    });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  }

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Bazı tarayıcılar bazı biçimleri burada açamaz; <img> ile yeniden denenir.
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Görüntü açılamadı'));
      element.src = objectUrl;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

/** Görüntüyü en uzun kenarı `maxEdge` olacak şekilde (büyütmeden) JPEG'e çevirir. */
function renderJpeg(image: DecodedImage, maxEdge: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas kullanılamıyor'));

  // JPEG saydamlık taşımaz; saydam PNG'nin arka planı siyah değil beyaz olsun.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image.source, 0, 0, canvas.width, canvas.height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Görüntü kodlanamadı'))),
      'image/jpeg',
      quality,
    );
  });
}

/** decodeImage + süre sınırı. Süre aşılıp görüntü sonradan açılırsa belleği bırakılır. */
async function decodeWithTimeout(blob: Blob, reducedWidth?: number): Promise<DecodedImage> {
  const pending = decodeImage(blob, reducedWidth);
  try {
    return await withTimeout(pending, DECODE_TIMEOUT_MS, 'Görüntü zamanında açılamadı');
  } catch (error) {
    pending.then((image) => image.release(), () => undefined);
    throw error;
  }
}

/**
 * Belleğe alınmış fotoğrafı (bkz. readIntoMemory) yüklemeye hazırlar: en uzun kenarı
 * 2000 px JPEG + 400 px önizleme.
 *
 * Küçültülmüş hali orijinalden büyük çıkarsa orijinal saklanır (zaten küçük ve iyi
 * sıkıştırılmış dosyalar). Tam boy açılamazsa küçültülerek açmayı dener. Hiç açılamayan
 * fotoğraf EKLENMEZ (PhotoPrepareError): önizlemesi gösterilemeyen dosya genelde yarım
 * yazılmış ya da bozuktur ve kullanıcının bunu kaydetmeden önce, fotoğrafı yeniden
 * çekebilecekken öğrenmesi gerekir.
 */
export async function preparePhoto(source: Blob): Promise<PreparedPhoto> {
  const canKeepOriginal = UPLOADABLE_TYPES.includes(source.type) && (await hasImageSignature(source));

  let image: DecodedImage;
  try {
    image = await decodeWithTimeout(source);
  } catch (error) {
    console.warn('Fotoğraf tam boy açılamadı, küçültülerek deneniyor:', error);
    try {
      image = await decodeWithTimeout(source, REDUCED_DECODE_WIDTH);
    } catch (reducedError) {
      console.warn('Fotoğraf küçültülerek de açılamadı:', reducedError);
      throw new PhotoPrepareError(DECODE_FAILED_MESSAGE, 'acilamadi', `${errorName(error)} / küçültülerek: ${errorName(reducedError)}`);
    }
  }

  try {
    const [resized, thumbBlob] = await Promise.all([
      renderJpeg(image, PHOTO_MAX_EDGE, PHOTO_QUALITY),
      renderJpeg(image, THUMB_MAX_EDGE, THUMB_QUALITY),
    ]);
    const blob = canKeepOriginal && resized.size >= source.size ? source : resized;
    return { blob, thumbBlob };
  } catch (error) {
    console.warn('Fotoğraf küçültülemedi:', error);
    throw new PhotoPrepareError(DECODE_FAILED_MESSAGE, 'acilamadi', `küçültme: ${errorName(error)}`);
  } finally {
    image.release();
  }
}

/** Formda gösterilecek "yeni seçilmiş fotoğraf" kaydını üretir. */
export function pendingPhoto(prepared: PreparedPhoto, name?: string): SahaPhoto {
  const url = URL.createObjectURL(prepared.blob);
  const thumbUrl = prepared.thumbBlob ? URL.createObjectURL(prepared.thumbBlob) : url;
  return { url, thumbUrl, name, upload: prepared };
}

/** pendingPhoto ile açılan geçici adresleri serbest bırakır. */
export function releasePendingPhoto(photo: SahaPhoto): void {
  if (!photo.upload) return;
  URL.revokeObjectURL(photo.url);
  if (photo.thumbUrl !== photo.url) URL.revokeObjectURL(photo.thumbUrl);
}

/** Dosyayı imzalı adrese yükler; ağ hatasında birkaç kez yeniden dener. */
async function putToStorage(uploadUrl: string, blob: Blob): Promise<void> {
  let lastError: unknown;
  let lastStatus: number | undefined;
  let attempts = 0;
  const started = performance.now();
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
    try {
      // Bilerek axios (`api`) DEĞİL: depoya oturum token'ı gönderilmemeli; imza adresin içinde.
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': blob.type },
        body: blob,
        signal: controller.signal,
      });
      // Yanıt gövdesi (boş) okunur: okunmayan yanıtı tarayıcı sonradan "yarıda kesildi"
      // olarak kapatır.
      await response.arrayBuffer().catch(() => undefined);
      if (response.ok) return;
      lastStatus = response.status;
      lastError = new Error(`Depo yüklemeyi reddetti (${response.status})`);
      // İmza/izin hatası tekrar denemekle düzelmez.
      if (response.status >= 400 && response.status < 500) break;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < UPLOAD_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
  }
  // Teşhis: depoya yükleme sunucudan geçmez; sunucu bu hatayı hiç görmez.
  reportClientEvent({
    tur: 'r2',
    durum: lastStatus,
    kod: errorName(lastError),
    boyut: blob.size,
    dosyaTipi: blob.type,
    deneme: attempts,
    ms: Math.round(performance.now() - started),
  });
  throw lastError;
}

/**
 * Hazırlanmış fotoğrafları depoya yükler ve kayıt gövdesinde gönderilecek numaralarını
 * (verilen sırayla) döndürür.
 */
export async function uploadPhotos(
  photos: Array<{ prepared: PreparedPhoto; name?: string }>,
  onProgress?: (done: number, total: number) => void,
): Promise<number[]> {
  if (photos.length === 0) return [];

  const response = await api.post('/saha/foto-yukleme', {
    fotolar: photos.map(({ prepared, name }) => ({
      name,
      mime_type: prepared.blob.type,
      size_bytes: prepared.blob.size,
      thumb_size_bytes: prepared.thumbBlob ? prepared.thumbBlob.size : undefined,
    })),
  });
  const targets: Array<{ id: number; upload_url: string; thumb_upload_url: string | null }> =
    response.data.fotolar;

  let done = 0;
  onProgress?.(done, photos.length);
  await Promise.all(
    photos.map(async ({ prepared }, index) => {
      const target = targets[index];
      await putToStorage(target.upload_url, prepared.blob);
      if (prepared.thumbBlob && target.thumb_upload_url) {
        await putToStorage(target.thumb_upload_url, prepared.thumbBlob);
      }
      done += 1;
      onProgress?.(done, photos.length);
    }),
  );
  return targets.map((target) => target.id);
}

/**
 * Formdaki fotoğraf listesini kayıt gövdesindeki `foto_ids` listesine çevirir:
 * R2'de zaten duranlar numarasıyla kalır; yeni seçilenler ve eski biçimdeki (data:)
 * fotoğraflar önce depoya yüklenir.
 *
 * `uploaded` bir önbellektir: kaydetme başarısız olup yeniden denenirse aynı dosya
 * ikinci kez yüklenmez.
 */
export async function resolvePhotoIds(
  photos: SahaPhoto[],
  uploaded: Map<SahaPhoto, number>,
  onProgress?: (done: number, total: number) => void,
): Promise<number[]> {
  const waiting = photos.filter((photo) => photo.id === undefined && !uploaded.has(photo));

  const prepared = await Promise.all(
    waiting.map(async (photo) => ({
      name: photo.name,
      prepared: photo.upload ?? (await preparePhoto(dataUrlToBlob(photo.url))),
    })),
  );
  const ids = await uploadPhotos(prepared, onProgress);
  waiting.forEach((photo, index) => uploaded.set(photo, ids[index]));

  return photos.map((photo) => photo.id ?? (uploaded.get(photo) as number));
}
