/**
 * PostgreSQL -> MySQL/MariaDB veri kopyası ve satır satır doğrulama.
 *
 * Kaynak veritabanına YALNIZCA okuma yapılır (salt okunur oturum, tek anlık görüntü).
 * Hedef şema önceden `migrations/mysql/001_initial_schema.sql` ile kurulmuş olmalıdır.
 *
 * Kullanım (backend klasöründen):
 *   npx ts-node src/scripts/mysql-migration/copyPostgresToMysql.ts \
 *     --source-env .env.production --target-env .env.hostinger.local [seçenekler]
 *
 * Seçenekler:
 *   --source-db <ad>   Kaynak veritabanı adını ortam dosyasındakinin yerine kullan
 *   --target-db <ad>   Hedef veritabanı adını ortam dosyasındakinin yerine kullan
 *   --remote           Hedefe DB_REMOTE_HOST üzerinden bağlan (Hostinger'a dışarıdan)
 *   --photos copy|skip foto_data: "copy" olduğu gibi kopyalar, "skip" (varsayılan) hiç okumaz
 *   --replace          Hedef tablolar doluysa önce boşalt (yoksa dolu hedefte durur)
 *   --verify-only      Kopyalama yapma, yalnızca iki tarafı karşılaştır
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql, { Connection, RowDataPacket } from 'mysql2/promise';
import { Client, types } from 'pg';

// Tarihler JS Date'e ÇEVRİLMEZ: Date yerel saat dilimine kayar (bu yüzden 3 saatlik
// kayma olur) ve mikrosaniyeyi kırpar. JSON da sayı hassasiyeti bozulmasın diye ham
// metin olarak taşınır.
for (const oid of [1114, 1184, 1082, 114, 3802]) {
  types.setTypeParser(oid, (value: string) => value);
}

// Yabancı anahtar sırası: saha_elemanlari, saha_kayitlari'ndan önce gelir.
const TABLES = [
  'admins',
  'aksesuarlar',
  'atolye',
  'bayiler',
  'ilceler',
  'islemler',
  'karaliste',
  'mahalleler',
  'markalar',
  'montajlar',
  'printer_settings',
  'saha_elemanlari',
  'saha_kayitlari',
  'teknisyenler',
  'urunler',
  'users',
] as const;

const BATCH_SIZE = 200;

type Row = Record<string, unknown>;

interface ColumnInfo {
  name: string;
  dataType: string;
}

interface Options {
  sourceEnv: string;
  targetEnv: string;
  sourceDb?: string;
  targetDb?: string;
  remote: boolean;
  photos: 'copy' | 'skip';
  replace: boolean;
  verifyOnly: boolean;
}

function parseArgs(argv: string[]): Options {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const sourceEnv = value('--source-env');
  const targetEnv = value('--target-env');
  if (!sourceEnv || !targetEnv) {
    throw new Error('--source-env ve --target-env zorunlu');
  }
  const photos = value('--photos') ?? 'skip';
  if (photos !== 'copy' && photos !== 'skip') {
    throw new Error('--photos copy ya da skip olmalı');
  }
  return {
    sourceEnv,
    targetEnv,
    sourceDb: value('--source-db'),
    targetDb: value('--target-db'),
    remote: argv.includes('--remote'),
    photos,
    replace: argv.includes('--replace'),
    verifyOnly: argv.includes('--verify-only'),
  };
}

function readEnv(file: string): Record<string, string> {
  return dotenv.parse(fs.readFileSync(path.resolve(file)));
}

const quotePg = (name: string): string => `"${name.replace(/"/g, '""')}"`;
const quoteMy = (name: string): string => `\`${name.replace(/`/g, '``')}\``;

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
  // Bütün tablolar aynı andaki görüntüden okunsun.
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  return client;
}

async function connectTarget(
  env: Record<string, string>,
  remote: boolean,
  database?: string,
): Promise<Connection> {
  const host = remote ? env.DB_REMOTE_HOST : env.DB_HOST;
  if (!host) throw new Error('Hedef sunucu adresi yok (DB_HOST / DB_REMOTE_HOST)');
  const connection = await mysql.createConnection({
    host: host === 'localhost' ? '127.0.0.1' : host,
    port: Number(env.DB_PORT || 3306),
    database: database ?? env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    charset: 'utf8mb4',
    timezone: 'Z',
    // Doğrulamada her değer veritabanının yazdığı metinle karşılaştırılır.
    typeCast: (field, next) => (field.type === 'JSON' ? field.string('utf8') : next()),
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  await connection.query(
    "SET SESSION time_zone = '+00:00', " +
      "sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'",
  );
  return connection;
}

async function sourceColumns(source: Client, table: string): Promise<ColumnInfo[]> {
  const result = await source.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  return result.rows.map((row) => ({ name: row.column_name, dataType: row.data_type }));
}

async function targetColumns(target: Connection, table: string): Promise<string[]> {
  const [rows] = await target.query<RowDataPacket[]>(
    `SELECT column_name AS name FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((row) => String(row.name));
}

function skipsPhotoData(table: string, column: string, options: Options): boolean {
  return table === 'saha_kayitlari' && column === 'foto_data' && options.photos === 'skip';
}

async function readSource(
  source: Client,
  table: string,
  columns: ColumnInfo[],
  options: Options,
): Promise<Row[]> {
  const selectList = columns
    .map((column) =>
      skipsPhotoData(table, column.name, options)
        ? `NULL::text AS ${quotePg(column.name)}`
        : quotePg(column.name),
    )
    .join(', ');
  const result = await source.query<Row>(`SELECT ${selectList} FROM ${quotePg(table)} ORDER BY id`);
  return result.rows;
}

/** Aynı değerin iki veritabanındaki yazımını tek biçime indirir. */
function canonical(value: unknown, dataType: string): string | null {
  if (value === null || value === undefined) return null;
  switch (dataType) {
    case 'boolean':
      return value === true || value === 1 || value === '1' ? '1' : '0';
    case 'timestamp without time zone': {
      const [whole, fraction = ''] = String(value).split('.');
      return `${whole}.${fraction.padEnd(6, '0')}`;
    }
    case 'jsonb':
    case 'json':
      // PostgreSQL ham metin verir; mysql2, MariaDB JSON kolonunu çözülmüş nesne verir.
      return canonicalJson(typeof value === 'string' ? JSON.parse(value) : value);
    default:
      return String(value);
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : 1,
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function toMysqlValue(value: unknown, dataType: string): unknown {
  if (value === null || value === undefined) return null;
  if (dataType === 'boolean') return value ? 1 : 0;
  return value;
}

async function copyTable(
  target: Connection,
  table: string,
  columns: ColumnInfo[],
  rows: Row[],
): Promise<void> {
  const columnList = columns.map((column) => quoteMy(column.name)).join(', ');
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows
      .slice(offset, offset + BATCH_SIZE)
      .map((row) => columns.map((column) => toMysqlValue(row[column.name], column.dataType)));
    await target.query(`INSERT INTO ${quoteMy(table)} (${columnList}) VALUES ?`, [batch]);
  }
}

async function nextSequenceValue(source: Client, table: string): Promise<number> {
  const result = await source.query<{ last_value: string | null }>(
    `SELECT s.last_value
     FROM pg_sequences s
     WHERE s.schemaname = 'public'
       AND format('%I.%I', s.schemaname, s.sequencename) = pg_get_serial_sequence($1, 'id')`,
    [`public.${table}`],
  );
  const last = result.rows[0]?.last_value;
  return last === null || last === undefined ? 1 : Number(last) + 1;
}

interface TableReport {
  table: string;
  sourceRows: number;
  targetRows: number;
  differences: string[];
}

async function verifyTable(
  target: Connection,
  table: string,
  columns: ColumnInfo[],
  sourceRows: Row[],
  options: Options,
): Promise<TableReport> {
  const compared = columns.filter((column) => !skipsPhotoData(table, column.name, options));
  const columnList = compared.map((column) => quoteMy(column.name)).join(', ');
  const [targetRows] = await target.query<RowDataPacket[]>(
    `SELECT ${columnList} FROM ${quoteMy(table)} ORDER BY id`,
  );

  const differences: string[] = [];
  const targetById = new Map(targetRows.map((row) => [String(row.id), row]));

  for (const sourceRow of sourceRows) {
    const id = String(sourceRow.id);
    const targetRow = targetById.get(id);
    if (!targetRow) {
      differences.push(`id=${id}: hedefte yok`);
      continue;
    }
    targetById.delete(id);
    for (const column of compared) {
      const expected = canonical(sourceRow[column.name], column.dataType);
      const actual = canonical(targetRow[column.name], column.dataType);
      if (expected !== actual) {
        differences.push(
          `id=${id} ${column.name}: kaynak=${JSON.stringify(expected)?.slice(0, 80)} hedef=${JSON.stringify(actual)?.slice(0, 80)}`,
        );
      }
    }
  }
  for (const id of targetById.keys()) {
    differences.push(`id=${id}: hedefte fazladan satır`);
  }

  return { table, sourceRows: sourceRows.length, targetRows: targetRows.length, differences };
}

async function run(): Promise<boolean> {
  const options = parseArgs(process.argv.slice(2));
  const source = await connectSource(readEnv(options.sourceEnv), options.sourceDb);
  const target = await connectTarget(readEnv(options.targetEnv), options.remote, options.targetDb);

  try {
    const plan: { table: string; columns: ColumnInfo[]; rows: Row[] }[] = [];
    for (const table of TABLES) {
      const columns = await sourceColumns(source, table);
      const existing = await targetColumns(target, table);
      const expected = columns.map((column) => column.name);
      if (existing.join(',') !== expected.join(',')) {
        throw new Error(
          `${table}: kolonlar uyuşmuyor\n  kaynak: ${expected.join(', ')}\n  hedef:  ${existing.join(', ')}`,
        );
      }
      plan.push({ table, columns, rows: await readSource(source, table, columns, options) });
    }

    if (!options.verifyOnly) {
      for (const { table } of plan) {
        const [rows] = await target.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS n FROM ${quoteMy(table)}`,
        );
        if (Number(rows[0].n) > 0 && !options.replace) {
          throw new Error(`Hedefte ${table} tablosu dolu. Üzerine yazmak için --replace verin.`);
        }
      }

      await target.query('SET FOREIGN_KEY_CHECKS = 0');
      await target.beginTransaction();
      try {
        for (const { table } of [...plan].reverse()) {
          await target.query(`DELETE FROM ${quoteMy(table)}`);
        }
        for (const { table, columns, rows } of plan) {
          await copyTable(target, table, columns, rows);
        }
        await target.commit();
      } catch (error) {
        await target.rollback();
        throw error;
      } finally {
        await target.query('SET FOREIGN_KEY_CHECKS = 1');
      }

      // PostgreSQL sayacı silinmiş son satırlar yüzünden MAX(id)'den ileride olabilir;
      // aynı numara yeniden verilmesin diye sayaç oradan devam ettirilir.
      for (const { table } of plan) {
        const next = await nextSequenceValue(source, table);
        await target.query(`ALTER TABLE ${quoteMy(table)} AUTO_INCREMENT = ${next}`);
      }
    }

    let allEqual = true;
    for (const { table, columns, rows } of plan) {
      const report = await verifyTable(target, table, columns, rows, options);
      const equal = report.differences.length === 0 && report.sourceRows === report.targetRows;
      if (!equal) allEqual = false;
      console.log(
        `${equal ? 'AYNI  ' : 'FARKLI'} ${table.padEnd(18)} kaynak=${report.sourceRows} hedef=${report.targetRows}` +
          (equal ? '' : ` fark=${report.differences.length}`),
      );
      for (const difference of report.differences.slice(0, 5)) {
        console.log(`         ${difference}`);
      }
    }
    console.log(
      `\n${options.verifyOnly ? 'Doğrulama' : 'Kopya + doğrulama'}: ${allEqual ? 'BİREBİR AYNI' : 'FARK VAR'}` +
        (options.photos === 'skip' ? ' (foto_data kapsam dışı)' : ''),
    );
    return allEqual;
  } finally {
    await source.query('ROLLBACK').catch(() => undefined);
    await source.end();
    await target.end();
  }
}

run()
  .then((equal) => {
    process.exitCode = equal ? 0 : 1;
  })
  .catch((error: Error) => {
    console.error('Kopyalama durdu:', error.message);
    process.exitCode = 1;
  });
