/**
 * Güvenlik regresyon testleri (2026-11-08 incelemesi): bütün API, gerçek izin tablosu
 * (mountApiRoutes) ve gerçek MariaDB ile. Yalnızca adı "_test" ile biten veritabanında
 * çalışır. Çalıştırma: `npm run test:db`
 *
 * Kapatılan açıklar: girişsiz hesap açma, pasif hesabın girişi, rol kontrolü olmayan
 * uçlar (bayi bütün müşterileri görüyordu, herkes silebiliyordu), bayi şifrelerinin
 * düz metin saklanması.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';
import express from 'express';
import jwt from 'jsonwebtoken';

const isTestDatabase = /_test$/.test(process.env.DB_NAME ?? '');
const options = { skip: isTestDatabase ? false : 'DB_NAME "_test" ile bitmiyor' };
const JWT_SECRET = 'itest-secret';
const P = 'itest_sec';
const OWN_BAYI = 'ITEST SEC BAYİ';
const OTHER_BAYI = 'ITEST SEC DİĞER';

describe('güvenlik: yetki, pasif hesap, bayi şifresi (API + MariaDB)', options, () => {
  let db: typeof import('../db');
  let hashPlaintextBayiPasswords: () => Promise<number>;
  let server: http.Server;
  let base: string;
  const ids = { admin: 0, user: 0, bayi: 0, otherBayi: 0, ownAtolye: [] as number[], otherAtolye: 0, islem: 0 };
  const token = (role: string, id: number, extra: object = {}) =>
    jwt.sign({ id, username: `${P}_${role}`, role, ...extra }, JWT_SECRET, { expiresIn: '1h' });
  const adminToken = () => token('admin', ids.admin);
  const userToken = () => token('user', ids.user);
  const bayiToken = () => token('bayi', ids.bayi, { bayiIsim: OWN_BAYI });

  async function call(method: string, url: string, tok?: string, body?: unknown) {
    const response = await fetch(`${base}${url}`, {
      method,
      headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* boş gövde */ }
    return { status: response.status, body: json };
  }

  async function cleanup() {
    await db.query(`DELETE FROM atolye WHERE created_by = $1`, [P]);
    await db.query(`DELETE FROM islemler WHERE created_by = $1`, [P]);
    await db.query(`DELETE FROM users WHERE username LIKE $1`, [`${P}%`]);
    await db.query(`DELETE FROM admins WHERE username LIKE $1`, [`${P}%`]);
    await db.query(`DELETE FROM bayiler WHERE username LIKE $1 OR isim IN ($2, $3)`, [`${P}%`, OWN_BAYI, OTHER_BAYI]);
  }

  before(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    db = await import('../db');
    ({ hashPlaintextBayiPasswords } = await import('../services/bayiPasswords'));
    const { mountApiRoutes } = await import('./index');
    const schema = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'mysql', '001_initial_schema.sql'), 'utf8');
    for (const statement of schema.split(/;\s*$/m)) {
      const sql = statement.replace(/^\s*--.*$/gm, '').trim();
      if (sql) await db.default.query(sql);
    }
    await cleanup();

    const hash = await bcrypt.hash('Parola-1', 4);
    ids.admin = (await db.query(`INSERT INTO admins (username, password) VALUES ($1, $2) RETURNING id`, [`${P}_admin`, hash])).rows[0].id;
    ids.user = (await db.query(`INSERT INTO users (username, password, is_active) VALUES ($1, $2, 1) RETURNING id`, [`${P}_user`, hash])).rows[0].id;
    // Eski biçim: bayi şifresi düz metin "123456" (canlıda 79 bayinin hepsi böyleydi).
    ids.bayi = (await db.query(`INSERT INTO bayiler (isim, username, password) VALUES ($1, $2, '123456') RETURNING id`, [OWN_BAYI, `${P}_bayi`])).rows[0].id;
    ids.otherBayi = (await db.query(`INSERT INTO bayiler (isim, username, password) VALUES ($1, $2, '123456') RETURNING id`, [OTHER_BAYI, `${P}_bayi2`])).rows[0].id;
    for (const bayi of [OWN_BAYI, OWN_BAYI, OTHER_BAYI]) {
      const row = (await db.query(
        `INSERT INTO atolye (bayi_adi, tel_no, marka, sikayet, created_by) VALUES ($1, '', 'itest', 'itest', $2) RETURNING id`, [bayi, P])).rows[0];
      if (bayi === OWN_BAYI) ids.ownAtolye.push(row.id); else ids.otherAtolye = row.id;
    }
    ids.islem = (await db.query(
      `INSERT INTO islemler (ad_soyad, ilce, mahalle, cadde, sokak, kapi_no, cep_tel, urun, marka, sikayet, created_by)
       VALUES ('itest', 'i', 'm', '', 's', '1', '05550000000', 'u', 'm', 's', $1) RETURNING id`, [P])).rows[0].id;

    const app = express();
    app.use(express.json());
    app.set('io', { emit: () => undefined });
    mountApiRoutes(app);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await cleanup();
    await new Promise((resolve) => server.close(resolve));
    await db.default.end();
  });

  it('girişsiz hesap açma ucu YOK (404)', async () => {
    assert.equal((await call('POST', '/api/auth/register', undefined, { username: `${P}_dis`, password: 'x' })).status, 404);
    const rows = await db.query('SELECT 1 FROM users WHERE username = $1', [`${P}_dis`]);
    assert.equal(rows.rows.length, 0);
  });

  // Regresyon (2026-11-08, yayından önce paket kontrolünde yakalandı): izin tablosu ilçe
  // ve mahalle listesini yalnız ofise açınca bayiye gönderilen GİRİŞSİZ kayıt formunda
  // mahalle seçilemiyor, bayi kayıt gönderemiyordu. Bu liste herkese açık adres verisidir.
  it('ilçe ve mahalle listesi girişsiz okunur (bayi kayıt formu kullanır)', async () => {
    for (const url of ['/api/ilceler', '/api/ilceler/1/mahalleler', '/api/locations/ilceler/1/mahalleler']) {
      const res = await call('GET', url);
      assert.equal(res.status, 200, url);
      assert.ok(Array.isArray(res.body), url);
    }
  });

  it('yönetici uçları yalnız yöneticiye: kullanıcı ve bayi 403, yönetici 200', async () => {
    for (const tok of [userToken(), bayiToken()]) {
      assert.equal((await call('GET', '/api/admin/users', tok)).status, 403);
      assert.equal((await call('POST', '/api/admin/create-user', tok, { username: `${P}_x`, password: 'Parola-1' })).status, 403);
      assert.equal((await call('DELETE', `/api/admin/users/${ids.user}`, tok)).status, 403);
    }
    assert.equal((await call('GET', '/api/admin/users', adminToken())).status, 200);
  });

  it('bayi: yalnız KENDİ atölye kayıtları (liste, sayfalı liste, sayılar, tek kayıt)', async () => {
    const all = await call('GET', '/api/atolye?all=true', bayiToken());
    assert.equal(all.status, 200);
    assert.ok(all.body.length >= 2);
    assert.ok(all.body.every((row: any) => row.bayi_adi === OWN_BAYI), 'başka bayinin kaydı geldi');

    const paged = await call('GET', '/api/atolye?page=1&limit=50', bayiToken());
    assert.ok(paged.body.data.every((row: any) => row.bayi_adi === OWN_BAYI));
    assert.equal(paged.body.pagination.totalCount, all.body.length);

    const counts = await call('GET', '/api/atolye/status-counts', bayiToken());
    assert.equal(Number(counts.body.total), all.body.length);

    assert.equal((await call('GET', `/api/atolye/${ids.otherAtolye}`, bayiToken())).status, 404);
    assert.equal((await call('GET', `/api/atolye/${ids.ownAtolye[0]}`, bayiToken())).status, 200);
  });

  it('bayi: işlemler, yazma, silme ve sıra numarası kapalı (403)', async () => {
    assert.equal((await call('GET', '/api/islemler', bayiToken())).status, 403);
    assert.equal((await call('GET', '/api/atolye/next-id', bayiToken())).status, 403);
    assert.equal((await call('POST', '/api/atolye', bayiToken(), { bayi_adi: OWN_BAYI, marka: 'x', sikayet: 'x' })).status, 403);
    assert.equal((await call('DELETE', `/api/islemler/${ids.islem}`, bayiToken())).status, 403);
  });

  it('kullanıcı: silme ve tanımlama değiştirme yalnız yöneticide; okuma serbest', async () => {
    assert.equal((await call('DELETE', `/api/islemler/${ids.islem}`, userToken())).status, 403);
    assert.equal((await call('DELETE', `/api/atolye/${ids.ownAtolye[0]}`, userToken())).status, 403);
    assert.equal((await call('POST', '/api/markalar', userToken(), { isim: `${P}_marka` })).status, 403);
    assert.equal((await call('GET', '/api/markalar', userToken())).status, 200);
    assert.equal((await call('GET', '/api/islemler/stats', userToken())).status, 200);
    // yönetici silebilir
    assert.equal((await call('DELETE', `/api/islemler/${ids.islem}`, adminToken())).status, 200);
  });

  it('pasif yapılan kullanıcı: giriş yapamaz ve elindeki bilet de hemen reddedilir', async () => {
    const tok = userToken();
    assert.equal((await call('GET', '/api/islemler/stats', tok)).status, 200); // önce çalışıyor (önbelleğe de girdi)
    assert.equal((await call('POST', '/api/auth/login', undefined, { username: `${P}_user`, password: 'Parola-1' })).status, 200);

    assert.equal((await call('PATCH', `/api/admin/users/${ids.user}/toggle`, adminToken())).status, 200);

    assert.equal((await call('POST', '/api/auth/login', undefined, { username: `${P}_user`, password: 'Parola-1' })).status, 403);
    assert.equal((await call('GET', '/api/islemler/stats', tok)).status, 401, 'pasif hesabın bileti önbellek yüzünden geçmemeli');
  });

  it('bayi şifresi: 123456 ile giriş çalışır, veritabanında düz metin KALMAZ', async () => {
    assert.equal((await call('POST', '/api/auth/bayi-login', undefined, { username: `${P}_bayi`, password: 'yanlis' })).status, 401);
    const login = await call('POST', '/api/auth/bayi-login', undefined, { username: `${P}_bayi`, password: '123456' });
    assert.equal(login.status, 200);
    const own = (await db.query('SELECT password FROM bayiler WHERE id = $1', [ids.bayi])).rows[0].password;
    assert.ok(own.startsWith('$2'), 'giriş yapan bayinin şifresi bcrypt olmalı');

    // Hiç giriş yapmamış bayiler açılıştaki toplu dönüşümle şifrelenir; ikinci çalıştırma bir şey yapmaz.
    assert.ok((await hashPlaintextBayiPasswords()) >= 1);
    assert.equal(await hashPlaintextBayiPasswords(), 0);
    const other = (await db.query('SELECT password FROM bayiler WHERE id = $1', [ids.otherBayi])).rows[0].password;
    assert.ok(other.startsWith('$2'));
    assert.equal((await call('POST', '/api/auth/bayi-login', undefined, { username: `${P}_bayi2`, password: '123456' })).status, 200);
  });

  it('bayi listesi ve yeni bayi cevabında şifre alanı YOK; yeni bayinin şifresi bcrypt', async () => {
    const list = await call('GET', '/api/bayiler', adminToken());
    assert.equal(list.status, 200);
    assert.ok(list.body.every((row: any) => !('password' in row)));
    const created = await call('POST', '/api/bayiler', adminToken(), { isim: `${P}_yeni` });
    assert.equal(created.status, 201);
    assert.equal('password' in created.body, false);
    const stored = (await db.query('SELECT password FROM bayiler WHERE username = $1', [`${P}_yeni`])).rows[0].password;
    assert.ok(stored.startsWith('$2'));
    assert.ok(await bcrypt.compare('123456', stored));
  });
});
