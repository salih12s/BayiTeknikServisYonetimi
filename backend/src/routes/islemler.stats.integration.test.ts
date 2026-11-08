/**
 * Ana sayfa istatistik ucunun (`GET /api/islemler/stats`) API testleri: HTTP kapısından,
 * gerçek MariaDB'ye karşı. Yalnızca adı "_test" ile biten veritabanında çalışır.
 * Çalıştırma: `npm run test:db`
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
const CREATED_BY = 'itest_stats';

describe('ana sayfa istatistikleri: toplam tutar (API + MariaDB)', options, () => {
  let db: typeof import('../db');
  let invalidateStatsCache: () => void;
  let server: http.Server;
  let baseUrl: string;
  const tokenFor = (role: string) => jwt.sign({ id: 1, username: CREATED_BY, role }, JWT_SECRET, { expiresIn: '1h' });

  before(async () => {
    // Bu test hesap durumunu sınamıyor: bilet sahibinin hesabı "aktif" sayılır (Fake).
    // Hesap durumu gerçek veritabanıyla security.integration.test.ts içinde sınanır.
    (await import('../services/accountStatus')).setAccountLookupForTests(async () => true);
    process.env.JWT_SECRET = JWT_SECRET;
    db = await import('../db');
    const routes = await import('./islemler');
    invalidateStatsCache = routes.invalidateStatsCache;
    const schema = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'mysql', '001_initial_schema.sql'), 'utf8');
    for (const statement of schema.split(/;\s*$/m)) {
      const sql = statement.replace(/^\s*--.*$/gm, '').trim();
      if (sql) await db.default.query(sql);
    }
    const app = express();
    app.use(express.json());
    app.set('io', { emit: () => undefined });
    app.use('/api/islemler', routes.default);
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/islemler`;
  });

  const cleanup = () => db.query('DELETE FROM islemler WHERE created_by = $1', [CREATED_BY]);
  beforeEach(async () => {
    await cleanup();
    invalidateStatsCache(); // her test taze sonuç okusun (15 sn'lik önbellek testleri birbirine bağlamasın)
  });
  after(async () => {
    await cleanup();
    await new Promise((resolve) => server.close(resolve));
    await db.default.end();
  });

  async function addIslem(tutar: string | null, isDurumu = 'tamamlandi'): Promise<void> {
    await db.query(
      `INSERT INTO islemler (ad_soyad, ilce, mahalle, cadde, sokak, kapi_no, cep_tel, urun, marka, sikayet, tutar, is_durumu, created_by)
       VALUES ('itest', 'ilce', 'mahalle', '', 'sokak', '1', '05550000000', 'urun', 'marka', 'sikayet', $1, $2, $3)`,
      [tutar, isDurumu, CREATED_BY],
    );
  }

  async function stats(role: string | null): Promise<{ status: number; body: any }> {
    const response = await fetch(`${baseUrl}/stats`, { headers: role ? { authorization: `Bearer ${tokenFor(role)}` } : {} });
    return { status: response.status, body: await response.json() };
  }

  async function dbTotal(): Promise<number> {
    const result = await db.query<{ s: string | null }>('SELECT SUM(tutar) AS s FROM islemler');
    return Number(result.rows[0].s ?? 0);
  }

  it('yönetici: toplam tutar BÜTÜN işlemlerin toplamıdır (yalnızca ekranda yüklü olanların değil), sayı olarak', async () => {
    await addIslem('1234.56');
    await addIslem('100.44', 'iptal');
    await addIslem(null, 'acik'); // tutarı girilmemiş iş toplamı bozmaz

    const response = await stats('admin');
    assert.equal(response.status, 200);
    assert.equal(typeof response.body.toplam_tutar, 'number');
    assert.equal(response.body.toplam_tutar, await dbTotal());
  });

  it('yeni eklenen işlemin tutarı toplama girer (kuruş kaybı yok)', async () => {
    const before = (await stats('admin')).body.toplam_tutar;
    await addIslem('1234.56');
    invalidateStatsCache();
    const afterAdd = (await stats('admin')).body.toplam_tutar;
    assert.equal(Math.round((afterAdd - before) * 100), 123456);
  });

  it('yönetici olmayan kullanıcıya toplam tutar GÖNDERİLMEZ (sayılar yine gelir)', async () => {
    await addIslem('500.00');
    for (const role of ['user', 'bayi', 'saha']) {
      const response = await stats(role);
      assert.equal(response.status, 200, role);
      assert.equal('toplam_tutar' in response.body, false, role);
      assert.ok(Number(response.body.total) >= 1, role);
    }
  });

  it('giriş yoksa 401', async () => {
    assert.equal((await stats(null)).status, 401);
  });
});
