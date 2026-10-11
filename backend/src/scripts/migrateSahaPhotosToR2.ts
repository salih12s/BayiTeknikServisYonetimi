/**
 * Eski saha fotoğraflarının (PostgreSQL'de `saha_kayitlari.foto_data` içinde base64)
 * Cloudflare R2'ye toplu taşınması.
 *
 * Kaynak veritabanına YALNIZCA okuma yapılır ve hiçbir şey silinmez. Taşıma üç adımdır:
 *
 *   upload  Kaynaktan fotoğrafları okur, küçültür, R2'ye yükler ve sonucu yerel kayıt
 *           defterine yazar. Yarıda kesilirse yeniden çalıştırıldığında kaldığı yerden
 *           devam eder; kaynağı değişen kayıtları yeniden taşır.
 *   verify  Kaynaktaki fotoğraflı kayıtları defterle karşılaştırır (eksik / hatalı /
 *           değişmiş). --check-storage ile depodaki her dosyanın boyutunu da doğrular.
 *   import  Defterdeki fotoğrafları hedef MySQL veritabanının `saha_fotograflari`
 *           tablosuna yazar (yeniden çalıştırılabilir).
 *
 * Kullanım (backend klasöründen):
 *   npx ts-node src/scripts/migrateSahaPhotosToR2.ts upload \
 *     --source-env .env.production --r2-env .env.r2.local --registry <defter.jsonl> \
 *     [--source-db <ad>] [--limit <kayıt sayısı>] [--newest] [--concurrency 3]
 *   npx ts-node src/scripts/migrateSahaPhotosToR2.ts verify \
 *     --source-env .env.production --registry <defter.jsonl> [--source-db <ad>] \
 *     [--check-storage --r2-env .env.r2.local]
 *   npx ts-node src/scripts/migrateSahaPhotosToR2.ts import \
 *     --target-env .env.hostinger.local --registry <defter.jsonl> [--target-db <ad>] [--remote]
 *
 * Kayıt defteri müşteri adlarından türeyen dosya adları içerir: depo (git) klasörünün
 * DIŞINDA tutun.
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql, { Connection, RowDataPacket } from 'mysql2/promise';
import { Client } from 'pg';
import { PhotoStorage, getPhotoStorage } from '../services/r2.service';
import {
  decodeDataUrl,
  legacyObjectKeys,
  parseLegacyPhotos,
  prepareLegacyPhoto,
  sha256,
} from './photo-migration/legacyPhotos';
import {
  RegistryEntry,
  RegistryPhoto,
  SourceRecord,
  appendRegistry,
  planMigration,
  readRegistry,
} from './photo-migration/registry';

interface Options {
  command: 'upload' | 'verify' | 'import';
  registry: string;
  sourceEnv?: string;
  sourceDb?: string;
  targetEnv?: string;
  targetDb?: string;
  r2Env?: string;
  remote: boolean;
  checkStorage: boolean;
  /** En yeni kayıtlardan başla (varsayılan: en eskiden). */
  newest: boolean;
  limit: number;
  concurrency: number;
}

function parseArgs(argv: string[]): Options {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const command = argv[0];
  if (command !== 'upload' && command !== 'verify' && command !== 'import') {
    throw new Error('İlk argüman upload, verify ya da import olmalı');
  }
  const registry = value('--registry');
  if (!registry) throw new Error('--registry zorunlu');

  const count = (flag: string, fallback: number): number => {
    const raw = value(flag);
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${flag} pozitif tam sayı olmalı`);
    return parsed;
  };

  return {
    command,
    registry: path.resolve(registry),
    sourceEnv: value('--source-env'),
    sourceDb: value('--source-db'),
    targetEnv: value('--target-env'),
    targetDb: value('--target-db'),
    r2Env: value('--r2-env'),
    remote: argv.includes('--remote'),
    checkStorage: argv.includes('--check-storage'),
    newest: argv.includes('--newest'),
    limit: count('--limit', Number.MAX_SAFE_INTEGER),
    concurrency: Math.min(count('--concurrency', 3), 8),
  };
}

function readEnv(file: string): Record<string, string> {
  return dotenv.parse(fs.readFileSync(path.resolve(file)));
}

function required<T>(value: T | undefined, flag: string): T {
  if (value === undefined) throw new Error(`${flag} zorunlu`);
  return value;
}

/**
 * Kaynağa salt okunur oturumla bağlanır. Bilerek uzun bir transaction AÇILMAZ: taşıma
 * saatler sürer ve açık duran bir transaction canlı veritabanının temizliğini engeller.
 */
async function connectSource(env: Record<string, string>, database?: string): Promise<Client> {
  const local = /^(localhost|127\.0\.0\.1)$/.test(env.DB_HOST ?? '');
  const client = new Client(
    env.DATABASE_URL && !database
      ? { connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
      : {
          host: env.DB_HOST,
          port: Number(env.DB_PORT || 5432),
          database: database ?? env.DB_NAME,
          user: env.DB_USER,
          password: env.DB_PASSWORD,
          ssl: local ? false : { rejectUnauthorized: false },
        },
  );
  await client.connect();
  await client.query('SET default_transaction_read_only = on');
  return client;
}

/** Kaynaktaki fotoğraflı kayıtlar. Parmak izi fotoğraf yükünü OKUMADAN hesaplanır. */
async function listSource(source: Client): Promise<SourceRecord[]> {
  const result = await source.query<{ id: number; fingerprint: string }>(
    `SELECT id, octet_length(foto_data) || ':' || COALESCE(updated_at::text, '') AS fingerprint
     FROM saha_kayitlari
     WHERE foto_data IS NOT NULL
     ORDER BY id`,
  );
  return result.rows.map((row) => ({ id: Number(row.id), fingerprint: row.fingerprint }));
}

function useR2(envFile: string | undefined): PhotoStorage {
  if (envFile) Object.assign(process.env, readEnv(envFile));
  const storage = getPhotoStorage();
  if (!storage) throw new Error('R2 ayarları eksik (--r2-env ile R2_* değişkenlerini verin)');
  return storage;
}

/** Dosyayı depoya yazar; aynı boyutta zaten duruyorsa yeniden yüklemez. Sonra doğrular. */
async function ensureStored(
  storage: PhotoStorage,
  objectKey: string,
  body: Buffer,
  mimeType: string,
): Promise<void> {
  const existing = await storage.head(objectKey);
  if (!existing || existing.sizeBytes !== body.length) {
    await storage.put(objectKey, body, mimeType);
    const stored = await storage.head(objectKey);
    if (!stored || stored.sizeBytes !== body.length) {
      throw new Error(`yükleme doğrulanamadı: ${objectKey}`);
    }
  }
}

async function migrateRecord(
  storage: PhotoStorage,
  record: SourceRecord,
  fotoData: string,
): Promise<RegistryEntry> {
  const photos: RegistryPhoto[] = [];
  const failed: RegistryEntry['failed'] = [];
  const items = parseLegacyPhotos(fotoData);

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const decoded = item ? decodeDataUrl(item.dataUrl) : null;
    if (!item || !decoded) {
      failed.push({ sort_order: index, reason: 'fotoğraf verisi çözülemedi' });
      continue;
    }
    try {
      const prepared = await prepareLegacyPhoto(decoded.body, decoded.mimeType);
      const keys = legacyObjectKeys(record.id, index, sha256(decoded.body), prepared.mimeType);
      await ensureStored(storage, keys.objectKey, prepared.body, prepared.mimeType);
      if (prepared.thumb) await ensureStored(storage, keys.thumbKey, prepared.thumb, 'image/jpeg');
      photos.push({
        sort_order: index,
        object_key: keys.objectKey,
        thumb_key: prepared.thumb ? keys.thumbKey : null,
        original_name: item.name,
        mime_type: prepared.mimeType,
        size_bytes: prepared.body.length,
        thumb_size_bytes: prepared.thumb ? prepared.thumb.length : null,
        checksum_sha256: sha256(prepared.body),
        original_bytes: decoded.body.length,
        outcome: prepared.outcome,
      });
    } catch (error) {
      failed.push({ sort_order: index, reason: (error as Error).message.slice(0, 300) });
    }
  }

  return {
    kayit_id: record.id,
    fingerprint: record.fingerprint,
    migrated_at: new Date().toISOString(),
    photos,
    failed,
  };
}

const megabytes = (bytes: number): string => (bytes / 1048576).toFixed(1);

async function upload(options: Options): Promise<boolean> {
  const storage = useR2(options.r2Env);
  const sourceEnv = readEnv(required(options.sourceEnv, '--source-env'));
  let source = await connectSource(sourceEnv, options.sourceDb);

  // Bağlantı saatler süren taşımada kopabilir: yeniden bağlanıp aynı kaydı tekrar okur.
  const readFotoData = async (id: number): Promise<string | null> => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const result = await source.query<{ foto_data: string | null }>(
          'SELECT foto_data FROM saha_kayitlari WHERE id = $1',
          [id],
        );
        return result.rows[0]?.foto_data ?? null;
      } catch (error) {
        if (attempt >= 5) throw error;
        console.warn(`Kaynak okuma hatası (kayıt ${id}), yeniden bağlanılıyor: ${(error as Error).message}`);
        await source.end().catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
        source = await connectSource(sourceEnv, options.sourceDb);
      }
    }
  };

  try {
    const plan = planMigration(await listSource(source), readRegistry(options.registry));
    const todo = (options.newest ? [...plan.todo].reverse() : plan.todo).slice(0, options.limit);
    console.log(
      `Kaynakta fotoğraflı kayıt: ${plan.done + plan.todo.length} · daha önce taşınmış: ${plan.done} · ` +
        `taşınacak: ${plan.todo.length}${todo.length < plan.todo.length ? ` (bu çalışmada ${todo.length})` : ''}`,
    );

    const totals = { records: 0, photos: 0, failed: 0, originalBytes: 0, storedBytes: 0 };
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const record = todo[next];
        next += 1;
        if (!record) return;

        const fotoData = await readFotoData(record.id);
        // Liste ile okuma arasında kaydın fotoğrafı silinmiş olabilir.
        if (fotoData === null) continue;
        const entry = await migrateRecord(storage, record, fotoData);
        appendRegistry(options.registry, entry);

        totals.records += 1;
        totals.photos += entry.photos.length;
        totals.failed += entry.failed.length;
        for (const photo of entry.photos) {
          totals.originalBytes += photo.original_bytes;
          totals.storedBytes += photo.size_bytes + (photo.thumb_size_bytes ?? 0);
        }
        for (const failure of entry.failed) {
          console.error(`HATA kayıt ${record.id} sıra ${failure.sort_order}: ${failure.reason}`);
        }
        if (totals.records % 50 === 0 || totals.records === todo.length) {
          console.log(
            `${totals.records}/${todo.length} kayıt · ${totals.photos} fotoğraf · ` +
              `${megabytes(totals.originalBytes)} MB -> ${megabytes(totals.storedBytes)} MB · hata ${totals.failed}`,
          );
        }
      }
    };
    await Promise.all(Array.from({ length: options.concurrency }, worker));

    console.log(
      `\nYükleme bitti: ${totals.records} kayıt, ${totals.photos} fotoğraf, ${totals.failed} hata. ` +
        'Sonucu "verify" ile doğrulayın.',
    );
    return totals.failed === 0;
  } finally {
    await source.end().catch(() => undefined);
  }
}

async function verify(options: Options): Promise<boolean> {
  const source = await connectSource(readEnv(required(options.sourceEnv, '--source-env')), options.sourceDb);
  let records: SourceRecord[];
  try {
    records = await listSource(source);
  } finally {
    await source.end().catch(() => undefined);
  }

  const registry = readRegistry(options.registry);
  const missing: number[] = [];
  const changed: number[] = [];
  const withFailures: number[] = [];
  let complete = 0;
  let photos = 0;
  let unreadable = 0;
  for (const record of records) {
    const entry = registry.get(record.id);
    if (!entry) missing.push(record.id);
    else if (entry.fingerprint !== record.fingerprint) changed.push(record.id);
    else if (entry.failed.length > 0) withFailures.push(record.id);
    else {
      complete += 1;
      photos += entry.photos.length;
      unreadable += entry.photos.filter((photo) => photo.outcome === 'unreadable').length;
    }
  }
  const { gone } = planMigration(records, registry);
  const sample = (ids: number[]): string => (ids.length ? ` (ör. ${ids.slice(0, 10).join(', ')})` : '');

  console.log(`Kaynakta fotoğraflı kayıt : ${records.length}`);
  console.log(`Eksiksiz taşınmış         : ${complete} kayıt, ${photos} fotoğraf`);
  console.log(`Hiç taşınmamış            : ${missing.length}${sample(missing)}`);
  console.log(`Taşındıktan sonra değişmiş: ${changed.length}${sample(changed)}`);
  console.log(`Hatalı fotoğrafı olan     : ${withFailures.length}${sample(withFailures)}`);
  console.log(`Açılamadığı için olduğu gibi saklanan fotoğraf: ${unreadable}`);
  console.log(`Defterde olup kaynakta artık olmayan kayıt   : ${gone.length}${sample(gone)}`);

  let storageOk = true;
  if (options.checkStorage) {
    const storage = useR2(options.r2Env);
    const expected = [...registry.values()].flatMap((entry) =>
      entry.photos.flatMap((photo) =>
        photo.thumb_key
          ? [
              { key: photo.object_key, size: photo.size_bytes },
              { key: photo.thumb_key, size: photo.thumb_size_bytes },
            ]
          : [{ key: photo.object_key, size: photo.size_bytes }],
      ),
    );
    let bad = 0;
    for (let start = 0; start < expected.length; start += 20) {
      const chunk = expected.slice(start, start + 20);
      const heads = await Promise.all(chunk.map((item) => storage.head(item.key)));
      heads.forEach((head, index) => {
        if (!head || head.sizeBytes !== chunk[index].size) {
          bad += 1;
          if (bad <= 10) console.error(`DEPODA EKSİK/FARKLI: ${chunk[index].key}`);
        }
      });
    }
    console.log(`Depo kontrolü: ${expected.length} dosyadan ${bad} tanesi eksik ya da farklı boyutta`);
    storageOk = bad === 0;
  }

  const ok = missing.length === 0 && changed.length === 0 && withFailures.length === 0 && storageOk;
  console.log(`\nDoğrulama: ${ok ? 'TAMAM' : 'EKSİK VAR'}`);
  return ok;
}

async function importRegistry(options: Options): Promise<boolean> {
  const env = readEnv(required(options.targetEnv, '--target-env'));
  const host = options.remote ? env.DB_REMOTE_HOST : env.DB_HOST;
  if (!host) throw new Error('Hedef sunucu adresi yok (DB_HOST / DB_REMOTE_HOST)');
  const target: Connection = await mysql.createConnection({
    host: host === 'localhost' ? '127.0.0.1' : host,
    port: Number(env.DB_PORT || 3306),
    database: options.targetDb ?? env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    charset: 'utf8mb4',
    timezone: 'Z',
  });

  try {
    await target.query(
      "SET SESSION time_zone = '+00:00', " +
        "sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'",
    );
    const registry = readRegistry(options.registry);
    const [kayitlar] = await target.query<RowDataPacket[]>('SELECT id FROM saha_kayitlari');
    const existing = new Set(kayitlar.map((row) => Number(row.id)));

    const rows: unknown[][] = [];
    let records = 0;
    let absent = 0;
    for (const entry of registry.values()) {
      if (!existing.has(entry.kayit_id)) {
        absent += 1;
        continue;
      }
      records += 1;
      for (const photo of entry.photos) {
        rows.push([
          entry.kayit_id,
          photo.object_key,
          photo.thumb_key,
          photo.original_name,
          photo.mime_type,
          photo.size_bytes,
          photo.thumb_size_bytes,
          photo.checksum_sha256,
          photo.sort_order,
          'legacy',
          entry.migrated_at.replace('T', ' ').replace('Z', ''),
        ]);
      }
    }

    await target.beginTransaction();
    try {
      // Taşınmış (legacy) satırlar bütünüyle defterden yeniden kurulur: yeniden
      // çalıştırmak güvenlidir ve veri yeniden kopyalandıktan sonra da doğru sonucu verir.
      await target.query("DELETE FROM saha_fotograflari WHERE source = 'legacy'");
      for (let start = 0; start < rows.length; start += 500) {
        await target.query(
          `INSERT INTO saha_fotograflari
             (saha_kaydi_id, object_key, thumb_key, original_name, mime_type, size_bytes,
              thumb_size_bytes, checksum_sha256, sort_order, source, migrated_at)
           VALUES ?`,
          [rows.slice(start, start + 500)],
        );
      }
      await target.commit();
    } catch (error) {
      await target.rollback();
      throw error;
    }

    const [counted] = await target.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM saha_fotograflari WHERE source = 'legacy'",
    );
    const ok = Number(counted[0].n) === rows.length;
    console.log(`Hedefe yazılan: ${records} kayıt, ${rows.length} fotoğraf (tabloda ${counted[0].n})`);
    console.log(`Hedefte kaydı bulunmadığı için atlanan defter kaydı: ${absent}`);
    console.log(`\nİçe aktarma: ${ok ? 'TAMAM' : 'SAYILAR TUTMUYOR'}`);
    return ok;
  } finally {
    await target.end();
  }
}

async function main(): Promise<boolean> {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'upload') return upload(options);
  if (options.command === 'verify') return verify(options);
  return importRegistry(options);
}

main()
  .then((ok) => {
    process.exitCode = ok ? 0 : 1;
  })
  .catch((error: Error) => {
    console.error('Taşıma durdu:', error.message);
    process.exitCode = 1;
  });
