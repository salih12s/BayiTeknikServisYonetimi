/**
 * Atölye kaydı açma ucunun API testleri: HTTP kapısından, gerçek MariaDB'ye karşı.
 * Yalnızca adı "_test" ile biten veritabanında çalışır. Çalıştırma: `npm run test:db`
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';

const isTestDatabase = /_test$/.test(process.env.DB_NAME ?? '');
const options = { skip: isTestDatabase ? false : 'DB_NAME "_test" ile bitmiyor' };
const JWT_SECRET = 'itest-secret';
const USERNAME = 'itest_atolye';

describe('atölye kaydı açma (API + MariaDB)', options, () => {
  let db: typeof import('../db');
  let server: http.Server;
  let baseUrl: string;
  const token = jwt.sign({ id: 1, username: USERNAME, role: 'user' }, JWT_SECRET, { expiresIn: '1h' });

  before(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    db = await import('../db');
    const { default: atolyeRoutes } = await import('./atolye');
    const schema = fs.readFileSync(
      path.join(__dirname, '..', 'migrations', 'mysql', '001_initial_schema.sql'),
      'utf8',
    );
    for (const statement of schema.split(/;\s*$/m)) {
      const sql = statement.replace(/^\s*--.*$/gm, '').trim();
      if (sql) await db.default.query(sql);
    }
    const app = express();
    app.use(express.json());
    app.use('/api/atolye', atolyeRoutes);
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/atolye`;
  });

  const cleanup = () => db.query('DELETE FROM atolye WHERE created_by = $1', [USERNAME]);
  beforeEach(cleanup);
  after(async () => {
    await cleanup();
    await new Promise((resolve) => server.close(resolve));
    await db.default.end();
  });

  const kayit = { bayi_adi: 'itest bayi', tel_no: '05550000000', marka: 'itest marka', kod: 'M-1', sikayet: 'açmıyor', ozel_not: 'not' };

  async function create(body: unknown, withToken = true): Promise<{ status: number; body: any }> {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(withToken ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  async function rows() {
    const result = await db.query(
      'SELECT id, bayi_adi, marka, kod, seri_no, sikayet, teslim_durumu FROM atolye WHERE created_by = $1 ORDER BY id',
      [USERNAME],
    );
    return result.rows;
  }

  it('adet verilmezse tek kayıt açılır ve yanıt eskisiyle aynı biçimdedir', async () => {
    const created = await create({ ...kayit, seri_no: 'SN-1' });
    assert.equal(created.status, 201);
    assert.equal(created.body.seri_no, 'SN-1');
    assert.equal('eklenen_adet' in created.body, false);
    assert.equal((await rows()).length, 1);
  });

  it('adet 30: aynı bilgilerle 30 ayrı kayıt, sıra numaraları farklı ve ardışık', async () => {
    const created = await create({ ...kayit, adet: 30 });
    assert.equal(created.status, 201);
    assert.equal(created.body.eklenen_adet, 30);

    const all = await rows();
    assert.equal(all.length, 30);
    const ids = all.map((row: { id: number }) => row.id);
    assert.equal(new Set(ids).size, 30);
    assert.deepEqual(ids, Array.from({ length: 30 }, (_, index) => ids[0] + index));
    assert.equal(created.body.id, ids[0]);
    for (const row of all) {
      assert.deepEqual(
        { bayi_adi: row.bayi_adi, marka: row.marka, kod: row.kod, sikayet: row.sikayet, teslim_durumu: row.teslim_durumu },
        { bayi_adi: 'itest bayi', marka: 'itest marka', kod: 'M-1', sikayet: 'açmıyor', teslim_durumu: 'beklemede' },
      );
    }
  });

  it('geçersiz adet 400 döner ve hiç kayıt açılmaz', async () => {
    for (const adet of [0, -3, 101, 2.5, 'otuz', [3]]) {
      const created = await create({ ...kayit, adet });
      assert.equal(created.status, 400, JSON.stringify(adet));
    }
    assert.equal((await rows()).length, 0);
  });

  it('rollback: kayıtlardan biri yazılamazsa hiçbiri yazılmaz', async () => {
    // Marka kolonu 100 karakter; katı modda fazlası hata verir.
    const created = await create({ ...kayit, marka: 'x'.repeat(150), adet: 5 });
    assert.equal(created.status, 500);
    assert.equal((await rows()).length, 0);
  });

  it('giriş yoksa 401', async () => {
    assert.equal((await create({ ...kayit, adet: 3 }, false)).status, 401);
    assert.equal((await rows()).length, 0);
  });
});
