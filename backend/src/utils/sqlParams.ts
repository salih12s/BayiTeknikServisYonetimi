/**
 * Numaralı ($1, $2 ...) parametreli SQL'i MySQL/MariaDB'ye gönderilecek tek bir
 * metne derler.
 *
 * NEDEN mysql2'nin kendi "?" yer tutucuları kullanılmıyor:
 *   1. Route'lar aynı parametreyi birden çok kez ($1 ... $1) ve dinamik sırayla
 *      kullanıyor; numaralı yer tutucu bunu yanlış sıralama riski olmadan taşır.
 *   2. mysql2 sayıları tırnaksız, nesneleri `anahtar = değer` olarak yerleştirir.
 *      MySQL'de `username = 0` sayı olmayan BÜTÜN kullanıcı adlarıyla eşleşir ve
 *      `username = {"a": 1}` gövdesi sorguyu değiştirir. PostgreSQL'de parametre
 *      kolonun tipine uyar; bu sorun orada yoktur.
 *
 * KURAL: her değer tırnaklı metin olarak yerleştirilir (sayı '5', boolean '1'/'0',
 * nesne JSON metni). MySQL metni kolonun tipine çevirir; böylece karşılaştırma
 * PostgreSQL'deki gibi kolonun tipinde yapılır. Tek istisna LIMIT / OFFSET'tir:
 * MySQL orada tırnaklı değer kabul etmez, bu yüzden yalnızca doğrulanmış negatif
 * olmayan tam sayı tırnaksız yazılır.
 */

export type SqlParam = unknown;

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** UTC 'YYYY-MM-DD HH:MM:SS.mmm' (oturum saat dilimi UTC'dir). */
function formatDateUtc(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error('Geçersiz tarih parametresi');
  }
  return (
    `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)} ` +
    `${pad(date.getUTCHours(), 2)}:${pad(date.getUTCMinutes(), 2)}:${pad(date.getUTCSeconds(), 2)}` +
    `.${pad(date.getUTCMilliseconds(), 3)}`
  );
}

/**
 * Veritabanının yazdığı 'YYYY-MM-DD HH:MM:SS[.ffffff]' metnini UTC Date'e çevirir.
 * Milisaniyeden sonraki basamaklar atılır (node-pg de böyle yapıyordu). Yıl olduğu
 * gibi korunur: Date.UTC ve new Date(y, ...) 0-99 arasını 1900'lere kaydırır.
 */
export function parseUtcDateTime(text: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?)?$/.exec(
    text,
  );
  if (!match) return new Date(NaN);
  const [, year, month, day, hour = '0', minute = '0', second = '0', fraction = ''] = match;
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  date.setUTCHours(
    Number(hour),
    Number(minute),
    Number(second),
    Number(fraction.padEnd(3, '0').slice(0, 3)),
  );
  return date;
}

/**
 * İstemciden gelen tarih-saat metnini DATETIME kolonuna yazılabilir hale getirir.
 *
 * PostgreSQL `timestamp` kolonuna '2026-10-11T10:30:00.000Z' ya da '...+03:00' yazılırken
 * saat dilimi ekini yok sayar ve saati olduğu gibi saklar. MariaDB katı modda aynı metni
 * reddeder. Burada yalnızca ek atılır; saat çevrilmez (davranış PostgreSQL ile aynı kalır).
 * Tanınmayan değerler olduğu gibi döner: geçersizse veritabanı hata verir.
 */
export function toSqlTimestamp<T>(value: T): T | string {
  if (typeof value !== 'string') return value;
  const match =
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?)(?:Z|[+-]\d{2}(?::?\d{2})?)$/.exec(
      value,
    );
  return match ? `${match[1]} ${match[2]}` : value;
}

const ESCAPES: Record<string, string> = {
  '\0': '\\0',
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\r': '\\r',
  '\x1a': '\\Z',
  '"': '\\"',
  "'": "\\'",
  '\\': '\\\\',
};

/** Metni MySQL dize sabiti olarak kaçışlar (NO_BACKSLASH_ESCAPES kapalı varsayılır). */
export function quoteString(value: string): string {
  // eslint-disable-next-line no-control-regex
  return `'${value.replace(/[\0\b\t\n\r\x1a"'\\]/g, (ch) => ESCAPES[ch])}'`;
}

/** Tek bir parametreyi SQL sabitine çevirir. */
export function encodeParam(value: SqlParam): string {
  if (value === null || value === undefined) return 'NULL';

  switch (typeof value) {
    case 'string':
      return quoteString(value);
    case 'number':
      // parseInt('x') gibi bir sonuç (NaN): PostgreSQL'de hiçbir değerle eşleşmiyordu.
      // NULL de hiçbir değerle eşleşmez; sorgu hata vermeden boş sonuç döner.
      if (!Number.isFinite(value)) return 'NULL';
      return quoteString(String(value));
    case 'bigint':
      return quoteString(value.toString());
    case 'boolean':
      return value ? "'1'" : "'0'";
    case 'object':
      if (value instanceof Date) return quoteString(formatDateUtc(value));
      if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
      // Nesne ve diziler tek bir metin değeri olur: SQL parçasına ya da değer
      // listesine genişlemez (ör. giriş isteğinde username olarak gönderilen dizi).
      return quoteString(JSON.stringify(value));
    default:
      throw new Error(`Desteklenmeyen parametre tipi: ${typeof value}`);
  }
}

function encodeLimit(value: SqlParam, keyword: string): string {
  const numeric = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isSafeInteger(numeric) || numeric < 0) {
    throw new Error(`${keyword} için negatif olmayan tam sayı gerekli`);
  }
  return String(numeric);
}

/**
 * `$n` yer tutucularını parametre değerleriyle değiştirir. Dize sabitleri, ters
 * tırnaklı adlar ve yorumların içindeki `$n` dizilerine dokunulmaz.
 */
export function compileQuery(text: string, params: readonly SqlParam[] = []): string {
  let out = '';
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];

    if (ch === "'" || ch === '"' || ch === '`') {
      const start = i;
      i += 1;
      while (i < n) {
        if (text[i] === '\\' && ch !== '`') {
          i += 2;
          continue;
        }
        if (text[i] === ch) {
          if (text[i + 1] === ch) {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      out += text.slice(start, i);
      continue;
    }

    if (ch === '-' && text[i + 1] === '-') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out += text.slice(i, stop);
      i = stop;
      continue;
    }

    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += text.slice(i, stop);
      i = stop;
      continue;
    }

    if (ch === '$' && /\d/.test(text[i + 1] ?? '')) {
      let j = i + 1;
      while (j < n && /\d/.test(text[j])) j += 1;
      const index = Number(text.slice(i + 1, j));
      if (index < 1 || index > params.length) {
        throw new Error(`$${index} için parametre yok (${params.length} parametre verildi)`);
      }
      const keyword = /\b(LIMIT|OFFSET)\s*$/i.exec(out)?.[1];
      out += keyword
        ? encodeLimit(params[index - 1], keyword.toUpperCase())
        : encodeParam(params[index - 1]);
      i = j;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

export interface UpdateReturningParts {
  /** RETURNING'siz UPDATE cümlesi. */
  update: string;
  /** Güncellenen satırları geri okuyan SELECT cümlesi. */
  select: string;
}

/**
 * `UPDATE t SET ... WHERE ... RETURNING kolonlar` cümlesini ikiye böler.
 * MariaDB INSERT ve DELETE için RETURNING destekler, UPDATE için desteklemez.
 *
 * SELECT aynı WHERE koşuluyla çalışır; bu yüzden WHERE, SET ile değiştirilen
 * bir kolona bağlı olmamalıdır (bu kod tabanında koşul her zaman id / sahiplik).
 */
export function splitUpdateReturning(text: string): UpdateReturningParts {
  const match =
    /^\s*UPDATE\s+([A-Za-z_][A-Za-z0-9_]*)\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+?)\s+RETURNING\s+([\s\S]+?)\s*;?\s*$/i.exec(
      text,
    );
  if (!match) {
    throw new Error(
      'updateReturning: "UPDATE tablo SET ... WHERE ... RETURNING ..." biçimi bekleniyor',
    );
  }
  const [, table, setClause, whereClause, returning] = match;
  return {
    update: `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`,
    select: `SELECT ${returning} FROM ${table} WHERE ${whereClause}`,
  };
}
