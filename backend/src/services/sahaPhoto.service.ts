import crypto from 'crypto';
import { query, transaction, Transaction } from '../db';
import logger from '../utils/logger';
import {
  THUMB_MIME_TYPE,
  UploadRequestPhoto,
  buildBulkPhotoNames,
  buildDownloadName,
  buildRecordBaseName,
  buildObjectKeys,
} from '../utils/sahaPhotoRules';
import { PhotoStorage, getPhotoStorage } from './r2.service';

/**
 * Saha fotoğraflarının veritabanı + depo (R2) işleri.
 *
 * Akış: tarayıcı önce `createPendingUploads` ile imzalı yükleme adresi alır ve dosyayı
 * doğrudan depoya yükler; kayıt kaydedilirken yüklenen fotoğrafların numaraları
 * (`foto_ids`) gönderilir ve fotoğraflar kayda bağlanır. Depodan silme her zaman
 * `r2_silme_kuyrugu` üzerinden yapılır (bkz. migrations/mysql/002_saha_fotograflari.sql).
 */

/** İstemciye olduğu gibi gösterilebilen, HTTP durum kodu taşıyan hata. */
export class PhotoError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Bir kullanıcının aynı anda bekleyebilecek (kayda bağlanmamış) yükleme sayısı. */
export const MAX_PENDING_UPLOADS_PER_USER = 60;
/** Kayda bağlanmayan yükleme bu süreden sonra temizlenir. */
const PENDING_UPLOAD_TTL_HOURS = 24;
const SWEEP_BATCH_SIZE = 500;

export interface PendingUpload {
  id: number;
  upload_url: string;
  thumb_upload_url: string | null;
}

export interface RecordPhoto {
  id: number;
  name: string | null;
  mime_type: string;
  size_bytes: number;
  url: string;
  thumb_url: string;
  download_url: string;
  download_name: string;
}

interface PhotoRow {
  id: number;
  object_key: string;
  thumb_key: string | null;
  original_name: string | null;
  mime_type: string;
  size_bytes: number;
  thumb_size_bytes: number | null;
}

function requireStorage(): PhotoStorage {
  const storage = getPhotoStorage();
  if (!storage) throw new PhotoError(503, 'Fotoğraf deposu yapılandırılmamış');
  return storage;
}

/** `$first, $first+1, ...` biçiminde `count` adet yer tutucu. */
function placeholders(count: number, first = 1): string {
  return Array.from({ length: count }, (_, index) => `$${first + index}`).join(', ');
}

/** Fotoğraflar için bekleyen yükleme satırı açar ve imzalı yükleme adreslerini döndürür. */
export async function createPendingUploads(
  userId: number,
  photos: UploadRequestPhoto[],
): Promise<PendingUpload[]> {
  const storage = requireStorage();

  const pending = await query<{ n: string }>(
    'SELECT COUNT(*) AS n FROM saha_fotograflari WHERE yukleyen_id = $1 AND saha_kaydi_id IS NULL',
    [userId],
  );
  if (Number(pending.rows[0].n) + photos.length > MAX_PENDING_UPLOADS_PER_USER) {
    throw new PhotoError(429, 'Çok fazla yarım kalmış yükleme var. Lütfen daha sonra tekrar deneyin.');
  }

  const now = new Date();
  const uploads: PendingUpload[] = [];
  for (const photo of photos) {
    const { objectKey, thumbKey } = buildObjectKeys(crypto.randomUUID(), photo.mimeType, now);
    const inserted = await query<{ id: number }>(
      `INSERT INTO saha_fotograflari
         (yukleyen_id, object_key, thumb_key, original_name, mime_type, size_bytes, thumb_size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        userId,
        objectKey,
        photo.thumbSizeBytes === null ? null : thumbKey,
        photo.name,
        photo.mimeType,
        photo.sizeBytes,
        photo.thumbSizeBytes,
      ],
    );
    uploads.push({
      id: inserted.rows[0].id,
      upload_url: await storage.signUpload(objectKey, photo.mimeType, photo.sizeBytes),
      thumb_upload_url:
        photo.thumbSizeBytes === null
          ? null
          : await storage.signUpload(thumbKey, THUMB_MIME_TYPE, photo.thumbSizeBytes),
    });
  }
  return uploads;
}

/**
 * Verilen bekleyen yüklemelerin bu kullanıcıya ait olduğunu ve dosyaların depoya
 * gerçekten, bildirilen boyutta yüklendiğini doğrular. Transaction DIŞINDA çağrılır
 * (depoya ağ isteği yapar).
 */
export async function assertUploaded(userId: number, photoIds: number[]): Promise<void> {
  if (photoIds.length === 0) return;
  const storage = requireStorage();

  const { rows } = await query<PhotoRow>(
    `SELECT id, object_key, thumb_key, size_bytes, thumb_size_bytes
     FROM saha_fotograflari
     WHERE id IN (${placeholders(photoIds.length)})
       AND yukleyen_id = $${photoIds.length + 1} AND saha_kaydi_id IS NULL`,
    [...photoIds, userId],
  );
  if (rows.length !== photoIds.length) {
    throw new PhotoError(400, 'Fotoğraf yüklemesi bulunamadı. Fotoğrafları yeniden ekleyin.');
  }

  const expected = rows.flatMap((row) =>
    row.thumb_key
      ? [
          { key: row.object_key, size: row.size_bytes },
          { key: row.thumb_key, size: row.thumb_size_bytes },
        ]
      : [{ key: row.object_key, size: row.size_bytes }],
  );
  const heads = await Promise.all(expected.map((item) => storage.head(item.key)));
  if (heads.some((head, index) => !head || head.sizeBytes !== expected[index].size)) {
    throw new PhotoError(400, 'Fotoğraf yüklemesi tamamlanmamış. Fotoğrafları yeniden ekleyin.');
  }
}

/**
 * Bekleyen yüklemeleri kayda bağlar. Koşullu güncellemedir: fotoğraf bu arada başka
 * bir kayda bağlandıysa ya da temizlendiyse hiçbir satır değişmez ve işlem geri alınır.
 */
async function attachPendingPhotos(
  tx: Transaction,
  userId: number,
  kayitId: number,
  photoIds: number[],
): Promise<void> {
  if (photoIds.length === 0) return;
  const updated = await tx.query(
    `UPDATE saha_fotograflari SET saha_kaydi_id = $1
     WHERE id IN (${placeholders(photoIds.length, 3)})
       AND yukleyen_id = $2 AND saha_kaydi_id IS NULL`,
    [kayitId, userId, ...photoIds],
  );
  if (updated.rowCount !== photoIds.length) {
    throw new PhotoError(409, 'Fotoğraflar başka bir kayda eklenmiş. Fotoğrafları yeniden ekleyin.');
  }
}

async function setPhotoOrder(tx: Transaction, kayitId: number, photoIds: number[]): Promise<void> {
  for (let index = 0; index < photoIds.length; index += 1) {
    await tx.query(
      'UPDATE saha_fotograflari SET sort_order = $1 WHERE id = $2 AND saha_kaydi_id = $3',
      [index, photoIds[index], kayitId],
    );
  }
}

/** Koşula uyan fotoğrafların depo adreslerini (önizlemeler dahil) silme kuyruğuna yazar. */
async function queuePhotoKeys(tx: Transaction, where: string, params: unknown[]): Promise<void> {
  await tx.query(
    `INSERT INTO r2_silme_kuyrugu (object_key)
     SELECT object_key FROM saha_fotograflari WHERE ${where}
     UNION ALL
     SELECT thumb_key FROM saha_fotograflari WHERE (${where}) AND thumb_key IS NOT NULL`,
    params,
  );
}

/** Yeni kayda fotoğraflarını bağlar (kayıt aynı transaction içinde eklenmiş olmalıdır). */
export async function attachPhotosToNewRecord(
  tx: Transaction,
  userId: number,
  kayitId: number,
  photoIds: number[],
): Promise<void> {
  await attachPendingPhotos(tx, userId, kayitId, photoIds);
  await setPhotoOrder(tx, kayitId, photoIds);
}

/** Kayda şu an bağlı OLMAYAN numaralar (yani yeni yüklenmiş olması gerekenler). */
export async function findUnattachedPhotoIds(kayitId: number, photoIds: number[]): Promise<number[]> {
  if (photoIds.length === 0) return [];
  const { rows } = await query<{ id: number }>(
    'SELECT id FROM saha_fotograflari WHERE saha_kaydi_id = $1',
    [kayitId],
  );
  const attached = new Set(rows.map((row) => row.id));
  return photoIds.filter((id) => !attached.has(id));
}

/**
 * Kaydın fotoğraf listesini `photoIds` ile değiştirir: listede olmayan eski fotoğraflar
 * silinir (depo adresleri kuyruğa yazılır), yeni yüklenenler bağlanır, sıra güncellenir.
 * Çağıran, kayıt satırını aynı transaction içinde kilitlemiş olmalıdır.
 */
export async function replaceRecordPhotos(
  tx: Transaction,
  userId: number,
  kayitId: number,
  photoIds: number[],
): Promise<void> {
  const current = await tx.query<{ id: number }>(
    'SELECT id FROM saha_fotograflari WHERE saha_kaydi_id = $1 FOR UPDATE',
    [kayitId],
  );
  const wanted = new Set(photoIds);
  const attached = new Set(current.rows.map((row) => row.id));
  const removed = current.rows.map((row) => row.id).filter((id) => !wanted.has(id));
  const added = photoIds.filter((id) => !attached.has(id));

  if (removed.length > 0) {
    const where = `saha_kaydi_id = $1 AND id IN (${placeholders(removed.length, 2)})`;
    await queuePhotoKeys(tx, where, [kayitId, ...removed]);
    await tx.query(`DELETE FROM saha_fotograflari WHERE ${where}`, [kayitId, ...removed]);
  }
  await attachPendingPhotos(tx, userId, kayitId, added);
  await setPhotoOrder(tx, kayitId, photoIds);
}

/** Silinmek üzere olan kaydın fotoğraflarını kuyruğa yazar (satırlar FK ile silinir). */
export async function queueRecordPhotos(tx: Transaction, kayitId: number): Promise<void> {
  await queuePhotoKeys(tx, 'saha_kaydi_id = $1', [kayitId]);
}

/**
 * Silinmek üzere olan saha elemanının bütün fotoğraflarını (kayıtlarına bağlı olanlar
 * ve bekleyen yüklemeleri) kuyruğa yazar; bekleyen yükleme satırlarını siler.
 */
export async function queueUserPhotos(tx: Transaction, sahaElemaniId: number): Promise<void> {
  // İki ayrı sorgu: "A OR B" koşulu index kullanamaz ve bütün tabloyu kilitleyerek tarar.
  await queuePhotoKeys(
    tx,
    'saha_kaydi_id IN (SELECT id FROM saha_kayitlari WHERE saha_elemani_id = $1)',
    [sahaElemaniId],
  );
  await queuePhotoKeys(tx, 'saha_kaydi_id IS NULL AND yukleyen_id = $1', [sahaElemaniId]);
  await tx.query(
    'DELETE FROM saha_fotograflari WHERE saha_kaydi_id IS NULL AND yukleyen_id = $1',
    [sahaElemaniId],
  );
}

/** Kaydın R2'deki fotoğrafları, imzalı görüntüleme ve indirme adresleriyle. */
export async function listRecordPhotos(kayit: {
  id: number;
  isim?: string | null;
  soyisim?: string | null;
  created_at?: Date | string | null;
}): Promise<RecordPhoto[]> {
  const { rows } = await query<PhotoRow>(
    `SELECT id, object_key, thumb_key, original_name, mime_type, size_bytes
     FROM saha_fotograflari
     WHERE saha_kaydi_id = $1
     ORDER BY sort_order, id`,
    [kayit.id],
  );
  if (rows.length === 0) return [];

  const storage = requireStorage();
  const baseName = buildRecordBaseName(kayit);
  return Promise.all(
    rows.map(async (row, index) => {
      const downloadName = buildDownloadName({
        mimeType: row.mime_type,
        baseName,
        index,
        total: rows.length,
      });
      const [url, thumbUrl, downloadUrl] = await Promise.all([
        storage.signRead(row.object_key),
        storage.signRead(row.thumb_key ?? row.object_key),
        storage.signRead(row.object_key, { downloadName }),
      ]);
      return {
        id: row.id,
        name: row.original_name,
        mime_type: row.mime_type,
        size_bytes: row.size_bytes,
        url,
        thumb_url: thumbUrl,
        download_url: downloadUrl,
        download_name: downloadName,
      };
    }),
  );
}

export interface BulkPhotoList {
  kayit_sayisi: number;
  /** Fotoğrafı henüz depoya taşınmamış (eski biçimde) olduğu için listeye girmeyen kayıt sayısı. */
  atlanan_kayit: number;
  toplam_bayt: number;
  fotolar: Array<{ kayit_id: number; name: string; url: string; size_bytes: number }>;
}

/**
 * `from` (dahil) ile `to` (hariç) arasında açılmış kayıtların bütün fotoğrafları, zip
 * içindeki adları ve imzalı indirme adresleriyle. Kayıt tarihine göre sıralıdır.
 */
export async function listPhotosInRange(
  from: Date,
  to: Date,
  sahaElemaniId: number | null,
): Promise<BulkPhotoList> {
  const filter = sahaElemaniId === null ? '' : ' AND k.saha_elemani_id = $3';
  const params = sahaElemaniId === null ? [from, to] : [from, to, sahaElemaniId];

  const { rows } = await query<{
    kayit_id: number;
    isim: string | null;
    soyisim: string | null;
    created_at: Date;
    object_key: string;
    mime_type: string;
    size_bytes: number;
  }>(
    `SELECT k.id AS kayit_id, k.isim, k.soyisim, k.created_at, f.object_key, f.mime_type, f.size_bytes
     FROM saha_fotograflari f
     JOIN saha_kayitlari k ON k.id = f.saha_kaydi_id
     WHERE k.created_at >= $1 AND k.created_at < $2${filter}
     ORDER BY k.created_at, k.id, f.sort_order, f.id`,
    params,
  );
  const skipped = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM saha_kayitlari k
     WHERE k.created_at >= $1 AND k.created_at < $2${filter} AND k.foto_data IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM saha_fotograflari f WHERE f.saha_kaydi_id = k.id)`,
    params,
  );

  const names = buildBulkPhotoNames(
    rows.map((row) => ({
      kayitId: row.kayit_id,
      isim: row.isim,
      soyisim: row.soyisim,
      created_at: row.created_at,
      mimeType: row.mime_type,
    })),
  );
  const storage = rows.length > 0 ? requireStorage() : null;
  const fotolar = await Promise.all(
    rows.map(async (row, index) => ({
      kayit_id: row.kayit_id,
      name: names[index],
      url: await (storage as PhotoStorage).signRead(row.object_key),
      size_bytes: row.size_bytes,
    })),
  );

  return {
    kayit_sayisi: new Set(rows.map((row) => row.kayit_id)).size,
    atlanan_kayit: Number(skipped.rows[0].n),
    toplam_bayt: rows.reduce((sum, row) => sum + row.size_bytes, 0),
    fotolar,
  };
}

/** Liste satırındaki önizleme adresi; depo ayarlı değilse ya da fotoğraf yoksa undefined. */
export async function signPreviewUrl(thumbKey: string | null | undefined): Promise<string | undefined> {
  const storage = getPhotoStorage();
  if (!storage || !thumbKey) return undefined;
  return storage.signRead(thumbKey);
}

export interface SweepResult {
  expired: number;
  deleted: number;
}

// Temizlikler üst üste binmez: yeni istek, çalışmakta olan bitince başlar.
let sweepQueue: Promise<unknown> = Promise.resolve();

/**
 * Depo temizliği:
 *   1. 24 saattir kayda bağlanmamış yüklemeleri silme kuyruğuna taşır.
 *   2. Kuyruktaki dosyaları depodan siler; başarılı olanları kuyruktan çıkarır.
 * Hata olursa kuyruk satırı yerinde kalır ve bir sonraki çalışmada yeniden denenir.
 */
export function sweepPhotoStorage(): Promise<SweepResult> {
  const run = sweepQueue.then(runSweep);
  sweepQueue = run.catch(() => undefined);
  return run;
}

async function runSweep(): Promise<SweepResult> {
  const storage = getPhotoStorage();
  if (!storage) return { expired: 0, deleted: 0 };

  // Adaylar KİLİTSİZ okunur. InnoDB kilitli bir taramada koşula uymayan satırları da
  // kilitler; "... FOR UPDATE" ile tarama, o sırada kaydedilmekte olan fotoğrafların
  // kilidini bekler ve o isteklerle kilitlenir (deadlock). Kilit yalnızca süresi dolan
  // satırlara, numaralarıyla alınır.
  const old = await query<{ id: number }>(
    `SELECT id FROM saha_fotograflari
     WHERE saha_kaydi_id IS NULL AND created_at < NOW(6) - INTERVAL ${PENDING_UPLOAD_TTL_HOURS} HOUR
     ORDER BY id LIMIT ${SWEEP_BATCH_SIZE}`,
  );
  const expired =
    old.rows.length === 0
      ? 0
      : await transaction(async (tx) => {
          const candidates = old.rows.map((row) => row.id);
          // Okuma ile kilit arasında kayda bağlanmış olanlar burada elenir.
          const still = await tx.query<{ id: number }>(
            `SELECT id FROM saha_fotograflari
             WHERE id IN (${placeholders(candidates.length)}) AND saha_kaydi_id IS NULL
             FOR UPDATE`,
            candidates,
          );
          if (still.rows.length === 0) return 0;
          const ids = still.rows.map((row) => row.id);
          const where = `id IN (${placeholders(ids.length)})`;
          await queuePhotoKeys(tx, where, ids);
          await tx.query(`DELETE FROM saha_fotograflari WHERE ${where}`, ids);
          return ids.length;
        });

  let deleted = 0;
  for (;;) {
    const batch = await query<{ id: number; object_key: string }>(
      `SELECT id, object_key FROM r2_silme_kuyrugu ORDER BY id LIMIT ${SWEEP_BATCH_SIZE}`,
    );
    if (batch.rows.length === 0) break;
    const keys = batch.rows.map((row) => row.object_key);

    // Son emniyet: hâlâ bir fotoğraf satırının gösterdiği dosya asla silinmez.
    const inUse = await query<{ object_key: string; thumb_key: string | null }>(
      `SELECT object_key, thumb_key FROM saha_fotograflari
       WHERE object_key IN (${placeholders(keys.length)})
          OR thumb_key IN (${placeholders(keys.length)})`,
      keys,
    );
    const protectedKeys = new Set(inUse.rows.flatMap((row) => [row.object_key, row.thumb_key]));
    const deletable = keys.filter((key) => !protectedKeys.has(key));
    if (deletable.length !== keys.length) {
      logger.error(
        `R2 temizliği: ${keys.length - deletable.length} dosya hâlâ kullanımda, silinmedi`,
      );
    }

    await storage.deleteMany(deletable);
    await query(
      `DELETE FROM r2_silme_kuyrugu WHERE id IN (${placeholders(batch.rows.length)})`,
      batch.rows.map((row) => row.id),
    );
    deleted += deletable.length;
    if (batch.rows.length < SWEEP_BATCH_SIZE) break;
  }
  return { expired, deleted };
}

/** Temizliği arka planda başlatır; hata yanıtı etkilemez, yalnızca kaydedilir. */
export function sweepPhotoStorageInBackground(): void {
  sweepPhotoStorage().catch((error) => {
    logger.error('R2 temizlik hatası:', error);
  });
}
