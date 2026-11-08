/**
 * Yavaş sorgu kaydı: gerçek MariaDB'ye karşı. Yalnızca adı "_test" ile biten veritabanında
 * çalışır. Çalıştırma: `npm run test:db`
 */
import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, it, mock } from 'node:test';

const isTestDatabase = /_test$/.test(process.env.DB_NAME ?? '');
const options = { skip: isTestDatabase ? false : 'DB_NAME "_test" ile bitmiyor' };

describe('yavaş sorgu kaydı (MariaDB)', options, () => {
  let warn: ReturnType<typeof mock.method>;
  const slowLines = () =>
    warn.mock.calls.map((call) => String(call.arguments[0])).filter((line) => line.startsWith('[yavaş sorgu]'));

  beforeEach(() => { warn = mock.method(console, 'warn', () => undefined); });
  afterEach(() => mock.restoreAll());
  after(async () => { (await import('./db')).default.end(); });

  it('hızlı sorgu yazılmaz', async () => {
    const db = await import('./db');
    await db.query('SELECT $1 AS x', [1]);
    assert.deepEqual(slowLines(), []);
  });

  it('2 saniyeyi aşan sorgu yazılır; loga DEĞER değil yer tutuculu ham metin gider', async () => {
    const db = await import('./db');
    await db.query("SELECT SLEEP($1) AS s, $2 AS telefon", [2.1, '05551234567']);
    const lines = slowLines();
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0].replace('[yavaş sorgu] ', ''));
    assert.ok(parsed.ms >= 2000, String(parsed.ms));
    assert.equal(parsed.sorgu, 'SELECT SLEEP($1) AS s, $2 AS telefon');
    assert.ok(!lines[0].includes('05551234567'), 'müşteri telefonu loga sızmamalı');
  });
});
