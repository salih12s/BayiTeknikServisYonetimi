import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Fotoğraf deposunun (Cloudflare R2) uygulamanın kullandığı yüzü. Route'lar ve
 * servisler S3 istemcisine değil bu arayüze bağlıdır; testlerde bellekte çalışan
 * bir sahte depo (fake) takılır.
 */
export interface PhotoStorage {
  /** Nesne yoksa null döner. */
  head(objectKey: string): Promise<{ sizeBytes: number; contentType?: string } | null>;
  put(objectKey: string, body: Buffer, contentType: string): Promise<void>;
  /** Olmayan nesneyi silmek hata değildir. */
  deleteMany(objectKeys: string[]): Promise<void>;
  /** Tarayıcının dosyayı doğrudan depoya yüklemesi için imzalı PUT adresi. */
  signUpload(objectKey: string, contentType: string, sizeBytes: number): Promise<string>;
  /** Görüntüleme ya da (downloadName verilirse) indirme için imzalı GET adresi. */
  signRead(objectKey: string, options?: SignReadOptions): Promise<string>;
}

export interface SignReadOptions {
  /** Verilirse tarayıcı dosyayı bu adla indirir (Content-Disposition: attachment). */
  downloadName?: string;
}

/** İmzalı yükleme adresinin geçerlilik süresi (saniye). */
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;

// İmzalı okuma adresi her istekte değişirse tarayıcı aynı fotoğrafı her seferinde
// yeniden indirir. İmza zamanı 30 dakikalık dilime yuvarlanır: aynı dilimde üretilen
// adresler aynıdır ve tarayıcı önbelleği çalışır. Adres üretildikten sonra en az
// 90 dakika, en çok 2 saat geçerlidir.
const READ_URL_WINDOW_MS = 30 * 60 * 1000;
const READ_URL_TTL_SECONDS = 2 * 60 * 60;
/** Bir okuma adresinin üretildikten sonra geçerli kalacağı en kısa süre (saniye). */
export const READ_URL_MIN_VALIDITY_SECONDS = READ_URL_TTL_SECONDS - READ_URL_WINDOW_MS / 1000;

const REQUIRED_ENV = ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];

/** Dosya adını Content-Disposition başlığına güvenle yerleştirir (RFC 6266 / 5987). */
export function contentDispositionAttachment(fileName: string): string {
  const ascii = fileName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function createR2Storage(): PhotoStorage | null {
  if (REQUIRED_ENV.some((name) => !process.env[name])) return null;

  const bucket = process.env.R2_BUCKET as string;
  const client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
    },
  });

  return {
    async head(objectKey) {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
        return { sizeBytes: result.ContentLength ?? 0, contentType: result.ContentType };
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode;
        if (status === 404) return null;
        throw error;
      }
    },

    async put(objectKey, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Body: body,
          ContentType: contentType,
        }),
      );
    },

    async deleteMany(objectKeys) {
      // S3 toplu silme isteği en çok 1000 anahtar alır.
      for (let start = 0; start < objectKeys.length; start += 1000) {
        const chunk = objectKeys.slice(start, start + 1000);
        const result = await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        if (result.Errors && result.Errors.length > 0) {
          const first = result.Errors[0];
          throw new Error(
            `R2 silme hatası: ${result.Errors.length} nesne silinemedi (${first.Key}: ${first.Code})`,
          );
        }
      }
    },

    signUpload(objectKey, contentType, sizeBytes) {
      // Boyut ve tip imzaya dahildir: tarayıcı farklı boyutta ya da tipte bir dosya
      // gönderirse R2 isteği reddeder (403).
      return getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          ContentType: contentType,
          ContentLength: sizeBytes,
        }),
        { expiresIn: UPLOAD_URL_TTL_SECONDS, signableHeaders: new Set(['content-type']) },
      );
    },

    signRead(objectKey, options = {}) {
      const signingDate = new Date(Math.floor(Date.now() / READ_URL_WINDOW_MS) * READ_URL_WINDOW_MS);
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          ResponseCacheControl: 'private, max-age=31536000, immutable',
          ResponseContentDisposition: options.downloadName
            ? contentDispositionAttachment(options.downloadName)
            : undefined,
        }),
        { expiresIn: READ_URL_TTL_SECONDS, signingDate },
      );
    },
  };
}

// Ortam değişkenleri ilk kullanımda okunur (modül yüklenirken değil): dotenv ya da
// barındırma paneli değişkenleri bu dosya içe aktarıldıktan sonra da yükleyebilir.
let storage: PhotoStorage | null | undefined;

/** Fotoğraf deposu; R2 ayarları eksikse null. */
export function getPhotoStorage(): PhotoStorage | null {
  if (storage === undefined) storage = createR2Storage();
  return storage;
}

/** Testlerde sahte depo takmak ya da (undefined ile) ayarı yeniden okutmak için. */
export function setPhotoStorage(next: PhotoStorage | null | undefined): void {
  storage = next;
}

export function isR2Configured(): boolean {
  return getPhotoStorage() !== null;
}
