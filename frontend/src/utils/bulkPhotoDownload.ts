/**
 * Toplu fotoğraf indirme: fotoğraflar depodan (R2) doğrudan tarayıcıya indirilir ve
 * tarayıcıda tek bir zip dosyasına konur. Fotoğraflar sunucudan geçmez.
 *
 * JPEG zaten sıkıştırılmıştır; zip'e sıkıştırılmadan ("store") eklenir, böylece yüzlerce
 * fotoğraf işlemciyi yormadan paketlenir.
 */
import { Zip, ZipPassThrough, strToU8 } from 'fflate';

export interface BulkPhoto {
  /** Zip içindeki dosya adı. */
  name: string;
  /** İmzalı indirme adresi. */
  url: string;
  size_bytes: number;
}

export interface BulkZipResult {
  blob: Blob;
  downloaded: number;
  /** İndirilemeyen dosyaların adları (zip'e girmediler). */
  failed: string[];
}

const CONCURRENT_DOWNLOADS = 4;
const DOWNLOAD_ATTEMPTS = 3;
/** Biriken zip verisi bu boyuta ulaşınca Blob'a çevrilir: tarayıcı büyük Blob'ları diske alabilir. */
const FLUSH_BYTES = 32 * 1024 * 1024;

async function downloadBytes(url: string, signal: AbortSignal): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      // no-store: aynı adres önizleme olarak önbelleğe alınmış olabilir; taze iste.
      const response = await fetch(url, { cache: 'no-store', signal });
      if (!response.ok) throw new Error(`Depo yanıtı ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
      if (attempt < DOWNLOAD_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
    }
  }
  throw lastError;
}

/**
 * Fotoğrafları indirip zip'ler. İndirilemeyen dosya işlemi durdurmaz: adı sonuçta
 * `failed` içinde döner ve zip'e "İNDİRİLEMEYENLER.txt" olarak da yazılır.
 * `signal` iptal edilirse AbortError fırlatır.
 */
export async function buildPhotoZip(
  photos: BulkPhoto[],
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<BulkZipResult> {
  const parts: Blob[] = [];
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let zipError: Error | null = null;
  let markFinished!: () => void;
  const finished = new Promise<void>((resolve) => { markFinished = resolve; });

  const zip = new Zip((error, chunk, final) => {
    if (error) {
      zipError = error;
      markFinished();
      return;
    }
    pending.push(chunk);
    pendingBytes += chunk.length;
    if (pendingBytes >= FLUSH_BYTES || final) {
      parts.push(new Blob(pending as BlobPart[]));
      pending = [];
      pendingBytes = 0;
    }
    if (final) markFinished();
  });

  let next = 0;
  let downloaded = 0;
  const failed: string[] = [];
  const worker = async (): Promise<void> => {
    for (;;) {
      const photo = photos[next];
      next += 1;
      if (!photo) return;
      try {
        const bytes = await downloadBytes(photo.url, signal);
        const entry = new ZipPassThrough(photo.name);
        zip.add(entry);
        entry.push(bytes, true);
        downloaded += 1;
      } catch (error) {
        if (signal.aborted) throw error;
        failed.push(photo.name);
      }
      onProgress(downloaded + failed.length, photos.length);
    }
  };
  onProgress(0, photos.length);
  await Promise.all(Array.from({ length: Math.min(CONCURRENT_DOWNLOADS, photos.length) }, worker));

  if (failed.length > 0) {
    const note = new ZipPassThrough('İNDİRİLEMEYENLER.txt');
    zip.add(note);
    note.push(strToU8(`Bu dosyalar indirilemedi, lütfen yeniden deneyin:\r\n${failed.join('\r\n')}\r\n`), true);
  }
  zip.end();
  await finished;
  if (zipError) throw zipError;

  return { blob: new Blob(parts, { type: 'application/zip' }), downloaded, failed };
}

/** Hazırlanan dosyayı tarayıcıya indirtir. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Tarayıcı indirmeyi başlatana kadar adresin yaşaması gerekir.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
