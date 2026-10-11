/**
 * Bayi kayıt linkinin API testleri: HTTP kapısından, gerçek MariaDB'ye karşı.
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

describe('bayi kayıt linki (API + MariaDB)', options, () => {
  let db: typeof import('../db');
  let limit: number;
  let server: http.Server;
  let baseUrl: string;
  const emitted: Array<{ event: string; payload: any }> = [];
  const tokenFor = (role: string): string => jwt.sign({ id: 1, username: `itest_${role}`, role }, JWT_SECRET, { expiresIn: '1h' });

  before(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    db = await import('../db');
    const module = await import('./bayiKayit');
    limit = module.BAYI_KAYIT_LIMIT;
    for (const file of ['001_initial_schema.sql', '003_bayi_kayit_linkleri.sql']) {
      const schema = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'mysql', file), 'utf8');
      for (const statement of schema.split(/;\s*$/m)) {
        const sql = statement.replace(/^\s*--.*$/gm, '').trim();
        if (sql) await db.default.query(sql);
      }
    }
    const app = express();
    // Socket yerine sahte (mock): yayınlanan olaylar kaydedilir ve doğrulanır.
    app.set('io', { emit: (event: string, payload: unknown) => emitted.push({ event, payload }) });
    app.use(express.json());
    app.use('/api/bayi-kayit', module.default);
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/bayi-kayit`;
  });

  async function cleanup(): Promise<void> {
    await db.query("DELETE FROM islemler WHERE created_by LIKE 'Bayi: itest%'");
    await db.query("DELETE FROM bayiler WHERE isim LIKE 'itest%'"); // linkler FK ile silinir
    await db.query("DELETE FROM ilceler WHERE isim LIKE 'itest%'");
    await db.query("DELETE FROM mahalleler WHERE isim LIKE 'itest%'");
    await db.query("DELETE FROM urunler WHERE TRIM(isim) LIKE 'itest%'");
    await db.query("DELETE FROM markalar WHERE isim LIKE 'itest%'");
    emitted.length = 0;
  }
  beforeEach(async () => {
    await cleanup();
    await db.query("INSERT INTO ilceler (ilce_id, isim) VALUES (990001, 'itest ILCE')");
    await db.query("INSERT INTO mahalleler (mahalle_id, ilce_id, isim) VALUES (990001, 990001, 'itest MAHALLE')");
    // Gerçek veride adı yalnızca boşluk olan bir ürün var; 'itest' önekiyle benzeri kurulur.
    await db.query("INSERT INTO urunler (isim) VALUES ('itest URUN'), ('  itest BOSLUKLU URUN  ')");
    await db.query("INSERT INTO markalar (isim, aktif) VALUES ('itest MARKA', 1), ('itest PASIF MARKA', 0)");
  });
  after(async () => {
    await cleanup();
    await new Promise((resolve) => server.close(resolve));
    await db.default.end();
  });

  let bayiCounter = 0;
  async function bayi(): Promise<{ id: number; isim: string }> {
    bayiCounter += 1;
    const isim = `itest bayi ${bayiCounter}`;
    const inserted = await db.query<{ id: number }>('INSERT INTO bayiler (isim, username) VALUES ($1, $1) RETURNING id', [isim]);
    return { id: inserted.rows[0].id, isim };
  }

  async function api(method: string, route: string, token?: string, body?: unknown): Promise<{ status: number; body: any }> {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  async function createLink(bayiId: number): Promise<string> {
    const created = await api('POST', `/linkler/${bayiId}`, tokenFor('admin'));
    assert.equal(created.status, 201);
    return created.body.token;
  }

  const form = {
    ad_soyad: 'ali ışık', ilce: 'itest ILCE', mahalle: 'itest MAHALLE', sokak: 'gül', kapi_no: '1', daire_no: '2',
    cep_tel: '0532 111 22 33', urun: 'itest URUN', marka: 'itest MARKA', sikayet: 'çalışmıyor',
  };

  async function kayitlar(bayiIsim: string) {
    const { rows } = await db.query('SELECT * FROM islemler WHERE created_by = $1 ORDER BY id', [`Bayi: ${bayiIsim}`]);
    return rows;
  }

  // ---- happy path

  it('link -> form -> kayıt: kayıt listeye bayi adıyla, açık durumda düşer ve ekranlara yayınlanır', async () => {
    const b = await bayi();
    const token = await createLink(b.id);

    const opened = await api('GET', `/form/${token}`);
    assert.equal(opened.status, 200);
    assert.equal(opened.body.bayi, b.isim);
    assert.ok(opened.body.ilceler.some((ilce: any) => ilce.isim === 'itest ILCE' && ilce.ilce_id === 990001));
    assert.ok(opened.body.urunler.includes('itest URUN'));
    assert.ok(opened.body.markalar.includes('itest MARKA'));
    assert.equal(opened.body.markalar.includes('itest PASIF MARKA'), false);
    // Adlar boşlukları atılmış gelir; adı boş olan seçenek hiç gelmez.
    assert.ok(opened.body.urunler.includes('itest BOSLUKLU URUN'));
    assert.ok(opened.body.urunler.every((isim: string) => isim.trim() === isim && isim !== ''));
    const spaced = await api('POST', `/form/${token}`, undefined, { ...form, urun: 'itest BOSLUKLU URUN' });
    assert.equal(spaced.status, 201);
    await db.query("DELETE FROM islemler WHERE urun = 'itest BOSLUKLU URUN'");
    emitted.length = 0;

    const sent = await api('POST', `/form/${token}`, undefined, form);
    assert.equal(sent.status, 201);
    const [row] = await kayitlar(b.isim);
    assert.equal(sent.body.sira_no, row.id);
    assert.deepEqual(
      { ad_soyad: row.ad_soyad, sokak: row.sokak, cadde: row.cadde, cep_tel: row.cep_tel, sikayet: row.sikayet, is_durumu: row.is_durumu, teknisyen_ismi: row.teknisyen_ismi, tutar: row.tutar },
      { ad_soyad: 'ALİ IŞIK', sokak: 'GÜL', cadde: '', cep_tel: '05321112233', sikayet: 'ÇALIŞMIYOR', is_durumu: 'acik', teknisyen_ismi: null, tutar: null },
    );
    assert.deepEqual(emitted.map((item) => [item.event, item.payload.id]), [['yeni-islem', row.id]]);
  });

  // ---- yetki

  it('link yönetimi yalnız yöneticide: girişsiz 401, diğer roller 403', async () => {
    const b = await bayi();
    for (const [method, route] of [['GET', '/linkler'], ['POST', `/linkler/${b.id}`], ['DELETE', `/linkler/${b.id}`]]) {
      assert.equal((await api(method, route)).status, 401, `${method} ${route}`);
      for (const role of ['user', 'bayi', 'saha']) {
        assert.equal((await api(method, route, tokenFor(role))).status, 403, `${role} ${method} ${route}`);
      }
    }
    assert.deepEqual((await api('GET', '/linkler', tokenFor('admin'))).body.filter((link: any) => link.bayi_id === b.id), []);
  });

  it('herkese açık form yalnızca kayıt ekler: durum, tutar, teknisyen ve "kim açtı" dışarıdan verilemez', async () => {
    const b = await bayi();
    const token = await createLink(b.id);
    const sent = await api('POST', `/form/${token}`, undefined, {
      ...form, is_durumu: 'tamamlandi', tutar: 5000, teknisyen_ismi: 'sahte', created_by: 'admin', id: 1, yazdirildi: true,
    });
    assert.equal(sent.status, 201);
    const [row] = await kayitlar(b.isim);
    assert.deepEqual(
      { is_durumu: row.is_durumu, tutar: row.tutar, teknisyen_ismi: row.teknisyen_ismi, created_by: row.created_by, yazdirildi: row.yazdirildi },
      { is_durumu: 'acik', tutar: null, teknisyen_ismi: null, created_by: `Bayi: ${b.isim}`, yazdirildi: false },
    );
    assert.notEqual(row.id, 1);
  });

  // ---- link yaşam döngüsü

  it('geçersiz, iptal edilmiş ve yenilenmiş (eski) link 404 döner; kayıt açılmaz', async () => {
    const b = await bayi();
    const first = await createLink(b.id);
    const second = await createLink(b.id); // yenileme: ilki artık geçersiz
    assert.notEqual(first, second);
    assert.equal((await api('GET', `/form/${first}`)).status, 404);
    assert.equal((await api('POST', `/form/${first}`, undefined, form)).status, 404);
    assert.equal((await api('GET', `/form/${second}`)).status, 200);

    assert.equal((await api('DELETE', `/linkler/${b.id}`, tokenFor('admin'))).status, 200);
    assert.equal((await api('GET', `/form/${second}`)).status, 404);
    assert.equal((await api('POST', `/form/${second}`, undefined, form)).status, 404);

    for (const bad of ['yok', 'a'.repeat(43), "x' OR '1'='1", '..%2F..%2Fetc']) {
      assert.equal((await api('GET', `/form/${encodeURIComponent(bad)}`)).status, 404, bad);
    }
    assert.equal((await kayitlar(b.isim)).length, 0);
  });

  it('bayi silinince linki de ölür', async () => {
    const b = await bayi();
    const token = await createLink(b.id);
    await db.query('DELETE FROM bayiler WHERE id = $1', [b.id]);
    assert.equal((await api('GET', `/form/${token}`)).status, 404);
  });

  it('olmayan bayiye link oluşturulamaz (404); linkler listesi bayinin linkini gösterir', async () => {
    assert.equal((await api('POST', '/linkler/999999999', tokenFor('admin'))).status, 404);
    assert.equal((await api('POST', '/linkler/12abc', tokenFor('admin'))).status, 400);
    const b = await bayi();
    const token = await createLink(b.id);
    const list = await api('GET', '/linkler', tokenFor('admin'));
    assert.equal(list.body.find((link: any) => link.bayi_id === b.id).token, token);
  });

  it('bir bayinin linki başka bayi adına kayıt açamaz', async () => {
    const first = await bayi();
    const second = await bayi();
    const token = await createLink(first.id);
    await createLink(second.id);
    await api('POST', `/form/${token}`, undefined, form);
    assert.equal((await kayitlar(first.isim)).length, 1);
    assert.equal((await kayitlar(second.isim)).length, 0);
  });

  // ---- girdi doğrulaması

  it('eksik ya da listede olmayan değerler 400 döner ve kayıt açılmaz', async () => {
    const b = await bayi();
    const token = await createLink(b.id);
    const invalid: Array<Record<string, unknown>> = [
      { ...form, ad_soyad: '' },
      { ...form, cep_tel: '123' },
      { ...form, sokak: '', cadde: '' },
      { ...form, ilce: 'OLMAYAN ILCE' },
      { ...form, mahalle: 'OLMAYAN MAHALLE' },
      { ...form, urun: 'OLMAYAN URUN' },
      { ...form, marka: 'itest PASIF MARKA' },
      { ...form, ad_soyad: 'x'.repeat(101) },
      { ...form, sikayet: { $gt: '' } },
    ];
    for (const body of invalid) {
      const sent = await api('POST', `/form/${token}`, undefined, body);
      assert.equal(sent.status, 400, JSON.stringify(body).slice(0, 80));
      assert.ok(sent.body.message);
    }
    assert.equal((await kayitlar(b.isim)).length, 0);
    assert.equal(emitted.length, 0);
  });

  // ---- hız sınırı

  it('bir linkten sınırdan fazla kayıt gelirse 429; hatalı formlar hakkı tüketmez, başka bayi etkilenmez', async () => {
    const b = await bayi();
    const other = await bayi();
    const token = await createLink(b.id);
    const otherToken = await createLink(other.id);

    for (let i = 0; i < 5; i += 1) await api('POST', `/form/${token}`, undefined, { ...form, ad_soyad: '' });
    for (let i = 0; i < limit; i += 1) {
      assert.equal((await api('POST', `/form/${token}`, undefined, form)).status, 201, `kayıt ${i + 1}`);
    }
    assert.equal((await api('POST', `/form/${token}`, undefined, form)).status, 429);
    assert.equal((await kayitlar(b.isim)).length, limit);
    assert.equal((await api('POST', `/form/${otherToken}`, undefined, form)).status, 201);
  });
});
