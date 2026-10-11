import mysql, { Pool, PoolOptions, PoolConnection, ResultSetHeader } from 'mysql2/promise';
import dotenv from 'dotenv';
import { compileQuery, parseUtcDateTime, splitUpdateReturning } from './utils/sqlParams';

dotenv.config();

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// Her bağlantıda oturum ayarları:
//   * time_zone UTC: NOW() / CURRENT_DATE sunucunun yerel saatine göre değil, eski
//     PostgreSQL kurulumundaki gibi UTC'ye göre hesaplanır.
//   * Katı sql_mode: fazla uzun metin ya da geçersiz değer sessizce kırpılmaz, hata
//     verir (PostgreSQL davranışı). Hostinger'ın varsayılanı katı DEĞİLDİR.
//   * collation_connection: parametreler de kolonlar gibi harfi harfine karşılaştırılır.
const SESSION_SETUP =
  "SET SESSION time_zone = '+00:00', " +
  "sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION', " +
  "collation_connection = 'utf8mb4_nopad_bin'";

function poolOptionsFromEnv(): PoolOptions {
  const base: PoolOptions = {
    charset: 'utf8mb4',
    // DATETIME değerleri UTC'dir. Okurken çeviri typeCast içinde yapılır (aşağıda).
    timezone: 'Z',
    waitForConnections: true,
    connectionLimit: numberFromEnv('DB_POOL_MAX', 10),
    idleTimeout: numberFromEnv('DB_IDLE_TIMEOUT_MS', 60000),
    connectTimeout: numberFromEnv('DB_CONNECTION_TIMEOUT_MS', 15000),
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    // BIGINT (COUNT, SUM ...) metin olarak döner: node-pg de int8'i metin veriyordu,
    // API yanıtlarındaki sayaçların tipi değişmesin.
    supportBigNumbers: true,
    bigNumberStrings: true,
    // TINYINT(1) kolonları true/false olarak döner (PostgreSQL boolean karşılığı).
    typeCast: (field, next) => {
      if (field.type === 'TINY' && field.length === 1) {
        const value = field.string();
        return value === null ? null : value === '1';
      }
      // mysql2'nin kendi tarih çevirisi 100'den küçük yılları 1900/2000'lere kaydırır
      // (canlıda yılı 0001 girilmiş kayıt var); çeviri burada elle yapılır.
      if (field.type === 'DATETIME' || field.type === 'TIMESTAMP') {
        const value = field.string();
        return value === null ? null : parseUtcDateTime(value);
      }
      return next();
    },
  };

  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    return {
      ...base,
      host: url.hostname === 'localhost' ? '127.0.0.1' : url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    };
  }

  return {
    ...base,
    // localhost IPv6'ya (::1) çözülebilir; MySQL kullanıcısının o adres için izni olmayabilir.
    host:
      !process.env.DB_HOST || process.env.DB_HOST === 'localhost'
        ? '127.0.0.1'
        : process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  };
}

const pool: Pool = mysql.createPool(poolOptionsFromEnv());

// Oturum ayarı, bağlantıdaki ilk komut olarak kuyruğa girer; sonraki sorgular
// her zaman bu ayarlarla çalışır.
pool.on('connection', (connection) => {
  // Olayla gelen nesne mysql2'nin geri çağırmalı (callback) çekirdek bağlantısıdır.
  const raw = connection as unknown as {
    query(sql: string, callback: (err: Error | null) => void): void;
  };
  raw.query(SESSION_SETUP, (err) => {
    if (err) {
      console.error('⚠️ Veritabanı oturum ayarı yapılamadı:', err.message);
    }
  });
  if (process.env.DEBUG_DB_POOL === 'true') {
    console.log('🔗 Yeni veritabanı bağlantısı açıldı');
  }
});

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

const TRANSIENT_DB_ERROR_CODES = new Set([
  'ER_LOCK_DEADLOCK',
  'ER_LOCK_WAIT_TIMEOUT',
  'ER_CON_COUNT_ERROR',
  'ER_USER_LIMIT_REACHED',
  'ER_SERVER_SHUTDOWN',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_SEQUENCE_TIMEOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
]);

function isTransientDbError(error: unknown): boolean {
  const err = error as { code?: string; message?: string };
  const message = (err.message || '').toLowerCase();

  return (
    Boolean(err.code && TRANSIENT_DB_ERROR_CODES.has(err.code)) ||
    message.includes('timeout') ||
    message.includes('connection lost') ||
    message.includes('connection is in closed state') ||
    message.includes('too many connections')
  );
}

/** Tekil (UNIQUE) kısıt ihlali mi? (PostgreSQL'deki 23505 kodunun karşılığı) */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === 'ER_DUP_ENTRY';
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toResult<T>(raw: unknown): QueryResult<T> {
  if (Array.isArray(raw)) {
    return { rows: raw as T[], rowCount: raw.length };
  }
  return { rows: [], rowCount: (raw as ResultSetHeader).affectedRows ?? 0 };
}

async function withRetry<T>(retries: number, run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (!isTransientDbError(error) || attempt === retries) {
        throw error;
      }

      const delay = 300 * (attempt + 1);
      console.warn(`Geçici veritabanı hatası, sorgu tekrar denenecek (${attempt + 1}/${retries})`, {
        delay,
        message: (error as Error).message,
      });
      await wait(delay);
    }
  }

  throw new Error('Veritabanı sorgusu tamamlanamadı');
}

/**
 * `$1, $2 ...` parametreli sorgu çalıştırır. SELECT ve `INSERT/DELETE ... RETURNING`
 * satırları `rows` içinde döner; `UPDATE ... RETURNING` için `updateReturning` kullanın.
 */
export async function query<T = any>(
  text: string,
  params?: unknown[],
  retries = 2,
): Promise<QueryResult<T>> {
  const sql = compileQuery(text, params);
  return withRetry(retries, async () => {
    const [raw] = await pool.query(sql);
    return toResult<T>(raw);
  });
}

/**
 * `UPDATE tablo SET ... WHERE ... RETURNING kolonlar` karşılığı. MariaDB UPDATE için
 * RETURNING desteklemez; güncelleme ve geri okuma aynı transaction içinde yapılır.
 * Hiçbir satır koşula uymuyorsa `rows` boş döner (PostgreSQL ile aynı).
 */
export async function updateReturning<T = any>(
  text: string,
  params?: unknown[],
  retries = 0,
): Promise<QueryResult<T>> {
  const parts = splitUpdateReturning(text);
  const updateSql = compileQuery(parts.update, params);
  const selectSql = compileQuery(parts.select, params);

  return withRetry(retries, async () => {
    const connection: PoolConnection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(updateSql);
      const [raw] = await connection.query(selectSql);
      await connection.commit();
      return toResult<T>(raw);
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  });
}

// Retry mekanizmalı bağlantı testi
async function testConnection(retries = 5, delay = 3000): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const connection = await pool.getConnection();
      console.log('✅ MySQL veritabanına başarıyla bağlanıldı');
      connection.release();
      return;
    } catch (err) {
      console.log(`⏳ Veritabanı bağlantısı deneniyor... (${i + 1}/${retries})`);
      if (i === retries - 1) {
        console.error('❌ Veritabanı bağlantı hatası:', err);
        throw err;
      }
      await wait(delay);
    }
  }
}

// İlk bağlantı testini başlat (arka planda)
testConnection().catch(() => {
  console.error('⚠️ Veritabanı bağlantısı kurulamadı, uygulama devam ediyor...');
});

export default pool;
