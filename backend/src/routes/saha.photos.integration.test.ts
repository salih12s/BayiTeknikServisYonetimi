/**
 * Saha fotoğraf uçlarının API testleri: HTTP kapısından, GERÇEK bir MariaDB'ye karşı.
 *
 * Neden mock veritabanı değil: yarış (iki istek aynı anda) ve rollback (ikinci adım
 * patlarsa ilk adımın geri alınması) satır kilitlerine ve transaction'a bağlıdır;
 * bunları yalnızca veritabanının kendisi kanıtlar.
 *
 * R2 yerine bellekte çalışan sahte depo (fake) takılır: "dosya gerçekten yüklendi mi,
 * silindi mi" sorusunu ağa çıkmadan, her seferinde aynı sonuçla cevaplar.
 *
 * Güvenlik: yalnızca adı "_test" ile biten bir veritabanında çalışır.
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
import type { PhotoStorage } from '../services/r2.service';

const isTestDatabase = /_test$/.test(process.env.DB_NAME ?? '');
const options = { skip: isTestDatabase ? false : 'DB_NAME "_test" ile bitmiyor' };

const JWT_SECRET = 'itest-secret';

/** Bellekte çalışan sahte fotoğraf deposu. */
class FakeStorage implements PhotoStorage {
  readonly objects = new Map<string, { sizeBytes: number; contentType: string }>();
  /** head çağrılmadan hemen önce çalışır: "kontrol ile işlem arasına giren istek" kurgusu için. */
  beforeHead: (() => Promise<void>) | null = null;
  failDeletes = false;

  async head(objectKey: string) {
    if (this.beforeHead) {
      const hook = this.beforeHead;
      this.beforeHead = null;
      await hook();
    }
    return this.objects.get(objectKey) ?? null;
  }

  async put(objectKey: string, body: Buffer, contentType: string) {
    this.objects.set(objectKey, { sizeBytes: body.length, contentType });
  }

  async deleteMany(objectKeys: string[]) {
    if (this.failDeletes) throw new Error('sahte depo: silme başarısız');
    for (const key of objectKeys) this.objects.delete(key);
  }

  async signUpload(objectKey: string, contentType: string, sizeBytes: number) {
    return `https://fake.r2/put/${objectKey}?type=${encodeURIComponent(contentType)}&size=${sizeBytes}`;
  }

  async signRead(objectKey: string, readOptions: { downloadName?: string } = {}) {
    const suffix = readOptions.downloadName ? `?download=${encodeURIComponent(readOptions.downloadName)}` : '';
    return `https://fake.r2/get/${objectKey}${suffix}`;
  }

  /** Tarayıcının imzalı adrese yaptığı PUT'un karşılığı. */
  upload(uploadUrl: string) {
    const url = new URL(uploadUrl);
    this.objects.set(decodeURIComponent(url.pathname.replace('/put/', '')), {
      sizeBytes: Number(url.searchParams.get('size')),
      contentType: url.searchParams.get('type') ?? '',
    });
  }

  keys(): string[] {
    return [...this.objects.keys()].sort();
  }
}

interface ApiResponse {
  status: number;
  body: any;
}

interface SahaUser {
  id: number;
  username: string;
  token: string;
}

interface Upload {
  id: number;
  upload_url: string;
  thumb_upload_url: string | null;
}

describe('saha fotoğraf uçları (API + MariaDB)', options, () => {
  let db: typeof import('../db');
  let photoService: typeof import('../services/sahaPhoto.service');
  let server: http.Server;
  let baseUrl: string;
  let storage: FakeStorage;

  before(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    db = await import('../db');
    photoService = await import('../services/sahaPhoto.service');
    const { default: sahaRoutes } = await import('./saha');

    for (const file of ['001_initial_schema.sql', '002_saha_fotograflari.sql']) {
      const schema = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'mysql', file), 'utf8');
      for (const statement of schema.split(/;\s*$/m)) {
        const sql = statement.replace(/^\s*--.*$/gm, '').trim();
        if (sql) await db.default.query(sql);
      }
    }

    const app = express();
    app.use(express.json());
    app.use('/api/saha', sahaRoutes);
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/saha`;
  });

  // Her test temiz veriyle ve boş bir sahte depoyla başlar (isolation).
  beforeEach(async () => {
    await photoService.sweepPhotoStorage().catch(() => undefined);
    await cleanup();
    const { setPhotoStorage } = await import('../services/r2.service');
    storage = new FakeStorage();
    setPhotoStorage(storage);
  });

  after(async () => {
    await photoService.sweepPhotoStorage().catch(() => undefined);
    await cleanup();
    await new Promise((resolve) => server.close(resolve));
    await db.default.end();
  });

  async function cleanup(): Promise<void> {
    await db.query('DELETE FROM r2_silme_kuyrugu');
    await db.query('DELETE FROM saha_fotograflari');
    await db.query("DELETE FROM saha_kayitlari WHERE saha_elemani_username LIKE 'itest%'");
    await db.query("DELETE FROM saha_elemanlari WHERE username LIKE 'itest%'");
  }

  // ---- veri kurucular (fixture)

  function tokenFor(role: string, id: number, username: string): string {
    return jwt.sign({ id, username, role }, JWT_SECRET, { expiresIn: '1h' });
  }

  async function sahaUser(name: string): Promise<SahaUser> {
    const username = `itest_${name}`;
    const inserted = await db.query<{ id: number }>(
      "INSERT INTO saha_elemanlari (username, password, ad_soyad) VALUES ($1, 'x', $1) RETURNING id",
      [username],
    );
    const id = inserted.rows[0].id;
    return { id, username, token: tokenFor('saha', id, username) };
  }

  async function api(method: string, route: string, token?: string, body?: unknown): Promise<ApiResponse> {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  /** Yükleme adresi alır ve (istenirse) dosyaları sahte depoya "yükler". */
  async function uploadPhotos(user: SahaUser, count: number, upload = true): Promise<Upload[]> {
    const response = await api('POST', '/foto-yukleme', user.token, {
      fotolar: Array.from({ length: count }, (_, index) => ({
        name: `foto ${index + 1}.jpg`,
        mime_type: 'image/jpeg',
        size_bytes: 1000 + index,
        thumb_size_bytes: 100 + index,
      })),
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const uploads: Upload[] = response.body.fotolar;
    if (upload) {
      for (const item of uploads) {
        storage.upload(item.upload_url);
        if (item.thumb_upload_url) storage.upload(item.thumb_upload_url);
      }
    }
    return uploads;
  }

  async function createKayit(user: SahaUser, fotoIds?: number[], isim = 'Ahmet'): Promise<ApiResponse> {
    return api('POST', '/kayit', user.token, { isim, soyisim: 'Yılmaz', foto_ids: fotoIds });
  }

  async function photoRows(kayitId: number) {
    const { rows } = await db.query<{ id: number; object_key: string; thumb_key: string | null; sort_order: number }>(
      'SELECT id, object_key, thumb_key, sort_order FROM saha_fotograflari WHERE saha_kaydi_id = $1 ORDER BY sort_order',
      [kayitId],
    );
    return rows;
  }

  async function kayitCount(isim: string): Promise<number> {
    const { rows } = await db.query(
      "SELECT COUNT(*) AS n FROM saha_kayitlari WHERE saha_elemani_username LIKE 'itest%' AND isim = $1",
      [isim],
    );
    return Number(rows[0].n);
  }

  async function queuedKeys(): Promise<string[]> {
    const { rows } = await db.query<{ object_key: string }>('SELECT object_key FROM r2_silme_kuyrugu ORDER BY object_key');
    return rows.map((row) => row.object_key);
  }

  // ---- happy path

  it('fotoğraflı kayıt: yükleme adresi -> yükleme -> kayıt -> listeleme -> fotoğrafları okuma', async () => {
    const user = await sahaUser('a');
    const uploads = await uploadPhotos(user, 2);
    // Sıra istekteki sıradır: ikinci yüklenen başa alınıyor.
    const created = await createKayit(user, [uploads[1].id, uploads[0].id]);

    assert.equal(created.status, 201);
    assert.equal(created.body.kayit.has_photos, true);
    assert.equal(created.body.kayit.foto_data, undefined);
    const kayitId: number = created.body.kayit.id;

    const rows = await photoRows(kayitId);
    assert.deepEqual(rows.map((row) => [row.id, row.sort_order]), [[uploads[1].id, 0], [uploads[0].id, 1]]);

    const list = await api('GET', '/kayitlar', user.token);
    assert.equal(list.status, 200);
    const listed = list.body.data.find((row: any) => row.id === kayitId);
    assert.equal(listed.has_photos, true);
    // Liste satırı ilk fotoğrafın ÖNİZLEMESİNİ verir (tam boy fotoğrafı değil).
    assert.equal(listed.foto_preview, `https://fake.r2/get/${rows[0].thumb_key}`);
    assert.equal('foto_thumb_key' in listed, false);
    assert.equal('has_legacy_photos' in listed, false);

    const photos = await api('GET', `/kayit-photos/${kayitId}`, user.token);
    assert.equal(photos.status, 200);
    assert.equal(photos.body.foto_data, null);
    assert.deepEqual(
      photos.body.fotolar.map((foto: any) => [foto.id, foto.name, foto.download_name, foto.size_bytes]),
      [
        // İndirme adı telefonun verdiği dosya adı değil, kayıttaki ad soyaddır.
        [uploads[1].id, 'foto 2.jpg', 'Ahmet_Yılmaz_1.jpg', 1001],
        [uploads[0].id, 'foto 1.jpg', 'Ahmet_Yılmaz_2.jpg', 1000],
      ],
    );
    assert.equal(photos.body.fotolar[0].url, `https://fake.r2/get/${rows[0].object_key}`);
    assert.equal(photos.body.fotolar[0].thumb_url, `https://fake.r2/get/${rows[0].thumb_key}`);
    assert.match(photos.body.fotolar[0].download_url, /\?download=Ahmet_Y%C4%B1lmaz_1\.jpg$/);

    const thumbnail = await api('GET', `/kayit-thumbnail/${kayitId}`, user.token);
    assert.deepEqual(thumbnail.body, { foto_preview: `https://fake.r2/get/${rows[0].thumb_key}` });
  });

  it('fotoğrafsız kayıt eskisi gibi çalışır', async () => {
    const user = await sahaUser('a');
    const created = await createKayit(user);
    assert.equal(created.status, 201);
    assert.equal(created.body.kayit.has_photos, false);

    const photos = await api('GET', `/kayit-photos/${created.body.kayit.id}`, user.token);
    assert.deepEqual(photos.body, { fotolar: [], foto_data: null });
    const thumbnail = await api('GET', `/kayit-thumbnail/${created.body.kayit.id}`, user.token);
    assert.equal(thumbnail.status, 404);
  });

  it('önizlemesi olmayan fotoğrafta önizleme adresi olarak fotoğrafın kendisi verilir', async () => {
    const user = await sahaUser('a');
    const response = await api('POST', '/foto-yukleme', user.token, {
      fotolar: [{ mime_type: 'image/png', size_bytes: 500 }],
    });
    assert.equal(response.body.fotolar[0].thumb_upload_url, null);
    storage.upload(response.body.fotolar[0].upload_url);
    const created = await createKayit(user, [response.body.fotolar[0].id]);
    const [row] = await photoRows(created.body.kayit.id);
    assert.match(row.object_key, /\.png$/);
    assert.equal(row.thumb_key, null);

    const photos = await api('GET', `/kayit-photos/${created.body.kayit.id}`, user.token);
    assert.equal(photos.body.fotolar[0].thumb_url, photos.body.fotolar[0].url);
    assert.match(photos.body.fotolar[0].download_name, /^Ahmet_Yılmaz\.png$/);
  });

  // ---- yetki (401 / 403 / başkasının kaydı)

  it('giriş yoksa 401', async () => {
    for (const [method, route] of [
      ['POST', '/foto-yukleme'],
      ['POST', '/kayit'],
      ['PUT', '/kayit/1'],
      ['DELETE', '/kayit/1'],
      ['GET', '/kayit-photos/1'],
      ['GET', '/kayit-thumbnail/1'],
    ]) {
      const response = await api(method, route, undefined, method === 'GET' ? undefined : {});
      assert.equal(response.status, 401, `${method} ${route}`);
    }
  });

  it('regresyon: aynı numaralı bayi/kullanıcı/yönetici saha elemanının kaydına dokunamaz (403)', async () => {
    const user = await sahaUser('a');
    const uploads = await uploadPhotos(user, 1);
    const created = await createKayit(user, [uploads[0].id]);
    const kayitId: number = created.body.kayit.id;

    for (const role of ['bayi', 'user', 'admin']) {
      // Numara saha elemanınınkiyle AYNI: eski kod yalnızca numaraya baktığı için izin veriyordu.
      const intruder = tokenFor(role, user.id, 'itest_baskasi');
      const put = await api('PUT', `/kayit/${kayitId}`, intruder, { isim: 'X', soyisim: 'Y', foto_ids: [] });
      assert.equal(put.status, 403, `${role} PUT`);
      const del = await api('DELETE', `/kayit/${kayitId}`, intruder);
      assert.equal(del.status, 403, `${role} DELETE`);
      const upload = await api('POST', '/foto-yukleme', intruder, {
        fotolar: [{ mime_type: 'image/jpeg', size_bytes: 10 }],
      });
      assert.equal(upload.status, 403, `${role} foto-yukleme`);
      const post = await api('POST', '/kayit', intruder, { isim: 'X', soyisim: 'Y' });
      assert.equal(post.status, 403, `${role} POST`);
      const list = await api('GET', '/kayitlar', intruder);
      assert.equal(list.status, 403, `${role} GET kayitlar`);
    }

    assert.equal(await kayitCount('Ahmet'), 1);
    assert.equal((await photoRows(kayitId)).length, 1);
    assert.deepEqual(await queuedKeys(), []);
  });

  it('regresyon: saha elemanı yönetimi yalnızca yöneticiye açık (eskiden her token yapabiliyordu)', async () => {
    const victim = await sahaUser('kurban');
    const other = await sahaUser('b');
    const intruders: Array<[string, string]> = [
      ['saha', other.token],
      ['bayi', tokenFor('bayi', 1, 'itest_bayi')],
      ['user', tokenFor('user', 1, 'itest_user')],
    ];

    for (const [role, token] of intruders) {
      const create = await api('POST', '/create', token, { username: `itest_yeni_${role}`, password: 'x' });
      assert.equal(create.status, 403, `${role} create`);
      assert.equal((await api('PATCH', `/users/${victim.id}/toggle`, token)).status, 403, `${role} toggle`);
      assert.equal((await api('DELETE', `/users/${victim.id}`, token)).status, 403, `${role} delete`);
    }
    // Hiçbir şey değişmedi: kurban duruyor ve hâlâ aktif, yeni eleman oluşmadı.
    const { rows } = await db.query(
      "SELECT username, is_active FROM saha_elemanlari WHERE username LIKE 'itest%' ORDER BY username",
    );
    assert.deepEqual(rows, [
      { username: 'itest_b', is_active: true },
      { username: 'itest_kurban', is_active: true },
    ]);

    // Yönetici aynı işlemleri yapabilir.
    const admin = tokenFor('admin', 1, 'itest_admin');
    assert.equal((await api('POST', '/create', admin, { username: 'itest_yeni', password: 'x' })).status, 201);
    assert.equal((await api('PATCH', `/users/${victim.id}/toggle`, admin)).body.user.is_active, false);
    assert.equal((await api('DELETE', `/users/${victim.id}`, admin)).status, 200);
  });

  it('bütün saha kayıtlarını ofis (kullanıcı, yönetici) görür; saha elemanı ve bayi 403 alır', async () => {
    const user = await sahaUser('a');
    await createKayit(user);
    for (const route of ['/users', '/all-kayitlar', `/user-kayitlar/${user.username}`]) {
      assert.equal((await api('GET', route, tokenFor('admin', 1, 'itest_admin'))).status, 200, route);
      assert.equal((await api('GET', route, tokenFor('user', 1, 'itest_user'))).status, 200, route);
      assert.equal((await api('GET', route, user.token)).status, 403, route);
      assert.equal((await api('GET', route, tokenFor('bayi', 1, 'itest_bayi'))).status, 403, route);
    }
  });

  it('fotoğrafları: sahibi ve yönetici/kullanıcı görür; başka saha elemanı 404, bayi 403 alır', async () => {
    const owner = await sahaUser('a');
    const other = await sahaUser('b');
    const uploads = await uploadPhotos(owner, 1);
    const kayitId: number = (await createKayit(owner, [uploads[0].id])).body.kayit.id;

    for (const route of [`/kayit-photos/${kayitId}`, `/kayit-thumbnail/${kayitId}`]) {
      assert.equal((await api('GET', route, owner.token)).status, 200, route);
      assert.equal((await api('GET', route, tokenFor('admin', 1, 'itest_admin'))).status, 200, route);
      assert.equal((await api('GET', route, tokenFor('user', 1, 'itest_user'))).status, 200, route);
      assert.equal((await api('GET', route, other.token)).status, 404, route);
      assert.equal((await api('GET', route, tokenFor('bayi', owner.id, 'itest_bayi'))).status, 403, route);
    }
  });

  it('başka saha elemanının kaydı güncellenemez ve silinemez; fotoğrafları yerinde kalır', async () => {
    const owner = await sahaUser('a');
    const other = await sahaUser('b');
    const uploads = await uploadPhotos(owner, 1);
    const kayitId: number = (await createKayit(owner, [uploads[0].id])).body.kayit.id;

    const put = await api('PUT', `/kayit/${kayitId}`, other.token, { isim: 'X', soyisim: 'Y', foto_ids: [] });
    assert.equal(put.status, 404);
    await api('DELETE', `/kayit/${kayitId}`, other.token);
    await photoService.sweepPhotoStorage();

    assert.equal(await kayitCount('Ahmet'), 1);
    assert.equal((await photoRows(kayitId)).length, 1);
    assert.equal(storage.keys().length, 2);
  });

  it('başka saha elemanının yüklediği fotoğraf kayda eklenemez', async () => {
    const owner = await sahaUser('a');
    const other = await sahaUser('b');
    const uploads = await uploadPhotos(owner, 1);

    const created = await createKayit(other, [uploads[0].id], 'Hirsiz');
    assert.equal(created.status, 400);
    assert.equal(await kayitCount('Hirsiz'), 0);

    // Fotoğraf hâlâ sahibinin: sahibi kendi kaydına ekleyebilir.
    assert.equal((await createKayit(owner, [uploads[0].id])).status, 201);
  });

  it('başka bir kayda bağlı fotoğraf (kendi kaydı olsa bile) ikinci bir kayda eklenemez', async () => {
    const user = await sahaUser('a');
    const uploads = await uploadPhotos(user, 1);
    const first = await createKayit(user, [uploads[0].id], 'Birinci');
    assert.equal(first.status, 201);

    const second = await createKayit(user, [uploads[0].id], 'Ikinci');
    assert.equal(second.status, 400);
    assert.equal(await kayitCount('Ikinci'), 0);
    assert.equal((await photoRows(first.body.kayit.id)).length, 1);
  });

  // ---- girdi doğrulaması (negative)

  it('yüklenmemiş fotoğrafla kayıt açılamaz', async () => {
    const user = await sahaUser('a');
    const uploads = await uploadPhotos(user, 1, false);
    const created = await createKayit(user, [uploads[0].id]);
    assert.equal(created.status, 400);
    assert.match(created.body.message, /tamamlanmamış/);
    assert.equal(await kayitCount('Ahmet'), 0);
  });

  it('önizlemesi yüklenmemiş ya da boyutu tutmayan fotoğraf reddedilir', async () => {
    const user = await sahaUser('a');
    const [onlyMain] = await uploadPhotos(user, 1, false);
    storage.upload(onlyMain.upload_url);
    assert.equal((await createKayit(user, [onlyMain.id])).status, 400);

    const [wrongSize] = await uploadPhotos(user, 1);
    const key = [...storage.objects.keys()].find((k) => wrongSize.upload_url.includes(k) && !k.endsWith('_k.jpg'));
    storage.objects.set(key as string, { sizeBytes: 999999, contentType: 'image/jpeg' });
    assert.equal((await createKayit(user, [wrongSize.id])).status, 400);
    assert.equal(await kayitCount('Ahmet'), 0);
  });

  it('geçersiz gövdeler 400 döner', async () => {
    const user = await sahaUser('a');
    const badUploads: unknown[] = [
      {},
      { fotolar: [] },
      { fotolar: Array(6).fill({ mime_type: 'image/jpeg', size_bytes: 10 }) },
      { fotolar: [{ mime_type: 'image/svg+xml', size_bytes: 10 }] },
      { fotolar: [{ mime_type: 'image/jpeg', size_bytes: 13 * 1024 * 1024 }] },
    ];
    for (const body of badUploads) {
      assert.equal((await api('POST', '/foto-yukleme', user.token, body)).status, 400, JSON.stringify(body));
    }

    for (const fotoIds of [[1, 2, 3, 4, 5, 6], ['1'], [1, 1], 'x', [999999999]]) {
      const response = await api('POST', '/kayit', user.token, { isim: 'A', soyisim: 'B', foto_ids: fotoIds });
      assert.equal(response.status, 400, JSON.stringify(fotoIds));
    }
    assert.equal(await kayitCount('A'), 0);
  });

  it('eski arayüzün base64 gövdesi (foto_data) sessizce yok sayılmaz, 400 döner', async () => {
    const user = await sahaUser('a');
    const created = await api('POST', '/kayit', user.token, {
      isim: 'Eski',
      soyisim: 'Arayuz',
      foto_data: '["data:image/jpeg;base64,AAAA"]',
    });
    assert.equal(created.status, 400);
    assert.match(created.body.message, /sayfayı yenile/);
    assert.equal(await kayitCount('Eski'), 0);
  });

  it('bekleyen yükleme sınırı aşılırsa 429', async () => {
    const user = await sahaUser('a');
    for (let index = 0; index < photoService.MAX_PENDING_UPLOADS_PER_USER / 5; index += 1) {
      await uploadPhotos(user, 5, false);
    }
    const response = await api('POST', '/foto-yukleme', user.token, {
      fotolar: [{ mime_type: 'image/jpeg', size_bytes: 10 }],
    });
    assert.equal(response.status, 429);
  });

  it('depo ayarlı değilse yükleme 503 döner, fotoğrafsız kayıt çalışmaya devam eder', async () => {
    const { setPhotoStorage } = await import('../services/r2.service');
    setPhotoStorage(null);
    const user = await sahaUser('a');
    const response = await api('POST', '/foto-yukleme', user.token, {
      fotolar: [{ mime_type: 'image/jpeg', size_bytes: 10 }],
    });
    assert.equal(response.status, 503);
    assert.equal((await createKayit(user)).status, 201);
    assert.equal((await api('GET', '/kayitlar', user.token)).status, 200);
  });

  // ---- transaction rollback

  it('rollback: fotoğraf bağlanamazsa kayıt da eklenmez', async () => {
    const user = await sahaUser('a');
    const uploads = await uploadPhotos(user, 2);
    const blocker = await createKayit(user, [], 'Engel');

    // Kontrol (depoda var mı?) ile transaction arasına başka bir istek giriyor ve
    // fotoğraflardan birini başka kayda bağlıyor: kayıt eklenir (1. adım), fotoğraf
    // bağlama (2. adım) başarısız olur.
    storage.beforeHead = async () => {
      await db.query('UPDATE saha_fotograflari SET saha_kaydi_id = $1 WHERE id = $2', [
        blocker.body.kayit.id,
        uploads[1].id,
      ]);
    };
    const created = await createKayit(user, [uploads[0].id, uploads[1].id], 'GeriAlinacak');

    assert.equal(created.status, 409);
    assert.equal(await kayitCount('GeriAlinacak'), 0);
    // İlk fotoğraf da bağlanmadı: hâlâ bekleyen yükleme, yeniden kullanılabilir.
    const { rows } = await db.query('SELECT saha_kaydi_id FROM saha_fotograflari WHERE id = $1', [uploads[0].id]);
    assert.equal(rows[0].saha_kaydi_id, null);
    assert.equal((await createKayit(user, [uploads[0].id], 'Sonra')).status, 201);
  });

  it('rollback: güncelleme yarıda kalırsa isim, eski fotoğraflar ve silme kuyruğu değişmez', async () => {
    const user = await sahaUser('a');
    const [kept] = await uploadPhotos(user, 1);
    const kayitId: number = (await createKayit(user, [kept.id])).body.kayit.id;
    const [added] = await uploadPhotos(user, 1);
    const blocker = await createKayit(user, [], 'Engel');

    storage.beforeHead = async () => {
      await db.query('UPDATE saha_fotograflari SET saha_kaydi_id = $1 WHERE id = $2', [
        blocker.body.kayit.id,
        added.id,
      ]);
    };
    // Eski fotoğraf listeden çıkarılıyor, yenisi ekleniyor; yenisi bağlanamayacak.
    const put = await api('PUT', `/kayit/${kayitId}`, user.token, {
      isim: 'Degisti',
      soyisim: 'Yılmaz',
      foto_ids: [added.id],
    });

    assert.equal(put.status, 409);
    assert.equal(await kayitCount('Degisti'), 0);
    assert.deepEqual((await photoRows(kayitId)).map((row) => row.id), [kept.id]);
    assert.deepEqual(await queuedKeys(), []);
  });

  // ---- eşzamanlılık (race)

  it('race: aynı fotoğraflarla aynı anda gelen iki kayıt isteğinden yalnızca biri başarılı olur', async () => {
    const user = await sahaUser('a');
    for (let round = 0; round < 8; round += 1) {
      const uploads = await uploadPhotos(user, 2);
      const ids = uploads.map((item) => item.id);
      const isim = `Yaris${round}`;
      const results = await Promise.all([createKayit(user, ids, isim), createKayit(user, ids, isim)]);

      const statuses = results.map((result) => result.status).sort();
      assert.equal(statuses[0], 201, `tur ${round}: ${statuses}`);
      assert.ok([400, 409].includes(statuses[1]), `tur ${round}: ${statuses}`);
      assert.equal(await kayitCount(isim), 1, `tur ${round}`);

      const winner = results.find((result) => result.status === 201) as ApiResponse;
      assert.deepEqual((await photoRows(winner.body.kayit.id)).map((row) => row.id), ids, `tur ${round}`);
    }
  });

  it('race: aynı kayda aynı anda gelen iki güncelleme sonunda dosya ne kaybolur ne sahipsiz kalır', async () => {
    const user = await sahaUser('a');
    for (let round = 0; round < 6; round += 1) {
      const [original] = await uploadPhotos(user, 1);
      const kayitId: number = (await createKayit(user, [original.id], `Guncel${round}`)).body.kayit.id;
      const [first] = await uploadPhotos(user, 1);
      const [second] = await uploadPhotos(user, 1);

      const results = await Promise.all([
        api('PUT', `/kayit/${kayitId}`, user.token, { isim: `Guncel${round}`, soyisim: 'A', foto_ids: [first.id] }),
        api('PUT', `/kayit/${kayitId}`, user.token, { isim: `Guncel${round}`, soyisim: 'B', foto_ids: [second.id] }),
      ]);
      assert.deepEqual(results.map((result) => result.status), [200, 200], `tur ${round}`);
      await photoService.sweepPhotoStorage();

      // Değişmez kural: kayıtta tam bir fotoğraf kalır ve depoda yalnızca veritabanının
      // gösterdiği dosyalar bulunur.
      const { rows } = await db.query<{ object_key: string; thumb_key: string }>(
        'SELECT object_key, thumb_key FROM saha_fotograflari',
      );
      const referenced = rows.flatMap((row) => [row.object_key, row.thumb_key]).sort();
      assert.equal((await photoRows(kayitId)).length, 1, `tur ${round}`);
      assert.deepEqual(storage.keys(), referenced, `tur ${round}`);
      assert.deepEqual(await queuedKeys(), [], `tur ${round}`);
    }
  });

  // ---- güncelleme

  it('güncelleme: fotoğraf çıkarma, ekleme ve yeniden sıralama', async () => {
    const user = await sahaUser('a');
    const [a, b, c] = await uploadPhotos(user, 3);
    const kayitId: number = (await createKayit(user, [a.id, b.id, c.id])).body.kayit.id;
    const before = await photoRows(kayitId);
    const [d] = await uploadPhotos(user, 1);

    const put = await api('PUT', `/kayit/${kayitId}`, user.token, {
      isim: 'Ahmet',
      soyisim: 'Yılmaz',
      notlar: 'not',
      foto_ids: [d.id, c.id, a.id],
    });
    assert.equal(put.status, 200);
    assert.equal(put.body.kayit.has_photos, true);
    assert.equal(put.body.kayit.notlar, 'not');
    assert.deepEqual((await photoRows(kayitId)).map((row) => row.id), [d.id, c.id, a.id]);

    // Çıkarılan fotoğrafın (b) hem kendisi hem önizlemesi depodan silinir; diğerleri durur.
    await photoService.sweepPhotoStorage();
    const removed = before.find((row) => row.id === b.id) as { object_key: string; thumb_key: string };
    assert.equal(storage.objects.has(removed.object_key), false);
    assert.equal(storage.objects.has(removed.thumb_key), false);
    assert.equal(storage.keys().length, 6);
    assert.deepEqual(await queuedKeys(), []);
  });

  it('güncelleme: foto_ids gönderilmezse fotoğraflara dokunulmaz; boş dizi hepsini kaldırır', async () => {
    const user = await sahaUser('a');
    const uploads = await uploadPhotos(user, 2);
    const kayitId: number = (await createKayit(user, uploads.map((item) => item.id))).body.kayit.id;

    const rename = await api('PUT', `/kayit/${kayitId}`, user.token, { isim: 'Mehmet', soyisim: 'Yılmaz' });
    assert.equal(rename.status, 200);
    assert.equal(rename.body.kayit.isim, 'Mehmet');
    assert.equal((await photoRows(kayitId)).length, 2);

    const clear = await api('PUT', `/kayit/${kayitId}`, user.token, { isim: 'Mehmet', soyisim: 'Yılmaz', foto_ids: [] });
    assert.equal(clear.body.kayit.has_photos, false);
    await photoService.sweepPhotoStorage();
    assert.equal((await photoRows(kayitId)).length, 0);
    assert.deepEqual(storage.keys(), []);
  });

  it('güncelleme: olmayan kayıt 404; isim eksikse 400', async () => {
    const user = await sahaUser('a');
    assert.equal((await api('PUT', '/kayit/999999999', user.token, { isim: 'A', soyisim: 'B' })).status, 404);
    const kayitId: number = (await createKayit(user)).body.kayit.id;
    assert.equal((await api('PUT', `/kayit/${kayitId}`, user.token, { soyisim: 'B' })).status, 400);
    assert.equal((await api('PUT', '/kayit/12abc', user.token, { isim: 'A', soyisim: 'B' })).status, 400);
  });

  // ---- silme ve depo temizliği

  it('kayıt silinince fotoğrafları ve önizlemeleri depodan da silinir; başka kayıtlarınki durur', async () => {
    const user = await sahaUser('a');
    const doomed = await uploadPhotos(user, 2);
    const kept = await uploadPhotos(user, 1);
    const doomedId: number = (await createKayit(user, doomed.map((item) => item.id), 'Silinecek')).body.kayit.id;
    const keptId: number = (await createKayit(user, [kept[0].id], 'Kalacak')).body.kayit.id;
    assert.equal(storage.keys().length, 6);

    const deleted = await api('DELETE', `/kayit/${doomedId}`, user.token);
    assert.equal(deleted.status, 200);
    await photoService.sweepPhotoStorage();

    assert.equal(await kayitCount('Silinecek'), 0);
    const remaining = await photoRows(keptId);
    assert.deepEqual(storage.keys(), [remaining[0].object_key, remaining[0].thumb_key].sort());
    assert.deepEqual(await queuedKeys(), []);
  });

  it('depo silmesi başarısız olursa kuyruk satırı kalır ve sonraki temizlikte yeniden denenir', async () => {
    const user = await sahaUser('a');
    const uploads = await uploadPhotos(user, 1);
    const kayitId: number = (await createKayit(user, [uploads[0].id])).body.kayit.id;

    storage.failDeletes = true;
    // Kayıt silme yanıtı depo hatasından etkilenmez.
    assert.equal((await api('DELETE', `/kayit/${kayitId}`, user.token)).status, 200);
    await assert.rejects(photoService.sweepPhotoStorage());
    assert.equal(await kayitCount('Ahmet'), 0);
    assert.equal((await queuedKeys()).length, 2);
    assert.equal(storage.keys().length, 2);

    storage.failDeletes = false;
    const result = await photoService.sweepPhotoStorage();
    assert.equal(result.deleted, 2);
    assert.deepEqual(await queuedKeys(), []);
    assert.deepEqual(storage.keys(), []);
  });

  it('saha elemanı silinince kayıtlarının fotoğrafları ve bekleyen yüklemeleri depodan silinir', async () => {
    const doomed = await sahaUser('a');
    const other = await sahaUser('b');
    const attached = await uploadPhotos(doomed, 2);
    await createKayit(doomed, attached.map((item) => item.id), 'Silinecek');
    await uploadPhotos(doomed, 1); // bekleyen yükleme
    const otherUploads = await uploadPhotos(other, 1);
    const otherKayit: number = (await createKayit(other, [otherUploads[0].id], 'Kalacak')).body.kayit.id;
    assert.equal(storage.keys().length, 8);

    const deleted = await api('DELETE', `/users/${doomed.id}`, tokenFor('admin', 1, 'itest_admin'));
    assert.equal(deleted.status, 200);
    await photoService.sweepPhotoStorage();

    assert.equal(await kayitCount('Silinecek'), 0);
    const { rows } = await db.query('SELECT COUNT(*) AS n FROM saha_fotograflari');
    assert.equal(Number(rows[0].n), 1);
    const remaining = await photoRows(otherKayit);
    assert.deepEqual(storage.keys(), [remaining[0].object_key, remaining[0].thumb_key].sort());
  });

  it('temizlik: 24 saati geçen bekleyen yükleme silinir; yenisi ve kayda bağlı olan kalır', async () => {
    const user = await sahaUser('a');
    const [expired] = await uploadPhotos(user, 1);
    const [fresh] = await uploadPhotos(user, 1);
    const [attached] = await uploadPhotos(user, 1);
    const kayitId: number = (await createKayit(user, [attached.id])).body.kayit.id;
    // Kayda bağlı fotoğraf ne kadar eski olursa olsun temizlenmez.
    await db.query(
      'UPDATE saha_fotograflari SET created_at = NOW(6) - INTERVAL 25 HOUR WHERE id IN ($1, $2)',
      [expired.id, attached.id],
    );
    await db.query('UPDATE saha_fotograflari SET created_at = NOW(6) - INTERVAL 23 HOUR WHERE id = $1', [fresh.id]);

    const result = await photoService.sweepPhotoStorage();
    assert.deepEqual(result, { expired: 1, deleted: 2 });

    const { rows } = await db.query<{ id: number }>('SELECT id FROM saha_fotograflari ORDER BY id');
    assert.deepEqual(rows.map((row) => row.id), [fresh.id, attached.id].sort((x, y) => x - y));
    assert.equal(storage.keys().length, 4);
    assert.equal((await photoRows(kayitId)).length, 1);

    // Süresi dolan yükleme artık kayda eklenemez.
    assert.equal((await createKayit(user, [expired.id], 'Gec')).status, 400);
  });

  it('regresyon: temizlik, o sırada kaydedilmekte olan fotoğrafın kilidini beklemez', async () => {
    const user = await sahaUser('a');
    const [expired] = await uploadPhotos(user, 1);
    const [inFlight] = await uploadPhotos(user, 1);
    const kayitId: number = (await createKayit(user, [], 'Bekleyen')).body.kayit.id;
    await db.query('UPDATE saha_fotograflari SET created_at = NOW(6) - INTERVAL 25 HOUR WHERE id = $1', [expired.id]);

    // Bir kaydetme isteği fotoğrafı bağlamış ama transaction'ı henüz bitmemiş.
    let finishSave!: () => void;
    const saveMayFinish = new Promise<void>((resolve) => { finishSave = resolve; });
    let markLocked!: () => void;
    const rowLocked = new Promise<void>((resolve) => { markLocked = resolve; });
    const save = db.transaction(async (tx) => {
      await tx.query('UPDATE saha_fotograflari SET saha_kaydi_id = $1 WHERE id = $2', [kayitId, inFlight.id]);
      markLocked();
      await saveMayFinish;
    });
    await rowLocked;

    // Eski sorgu taradığı her satırı kilitlemeye çalıştığı için burada takılıyor ve
    // eşzamanlı isteklerle kilitlenme (deadlock) yaşıyordu.
    const sweep = photoService.sweepPhotoStorage();
    const outcome = await Promise.race([
      sweep,
      new Promise<'takildi'>((resolve) => setTimeout(() => resolve('takildi'), 3000)),
    ]);
    finishSave();
    await save;
    await sweep.catch(() => undefined);

    assert.deepEqual(outcome, { expired: 1, deleted: 2 });
    assert.deepEqual((await photoRows(kayitId)).map((row) => row.id), [inFlight.id]);
  });

  it('emniyet: kuyruğa yanlışlıkla girmiş, hâlâ kullanılan dosya depodan silinmez', async () => {
    const user = await sahaUser('a');
    const uploads = await uploadPhotos(user, 1);
    const kayitId: number = (await createKayit(user, [uploads[0].id])).body.kayit.id;
    const [row] = await photoRows(kayitId);
    await db.query('INSERT INTO r2_silme_kuyrugu (object_key) VALUES ($1), ($2), ($3)', [
      row.object_key,
      row.thumb_key,
      'saha/2020/01/sahipsiz.jpg',
    ]);
    storage.objects.set('saha/2020/01/sahipsiz.jpg', { sizeBytes: 1, contentType: 'image/jpeg' });

    const result = await photoService.sweepPhotoStorage();

    assert.equal(result.deleted, 1);
    assert.deepEqual(storage.keys(), [row.object_key, row.thumb_key as string].sort());
    assert.deepEqual(await queuedKeys(), []);
  });

  // ---- eski biçim (veritabanındaki base64 fotoğraflar)

  it('eski biçimdeki kayıt okunmaya devam eder', async () => {
    const user = await sahaUser('a');
    const legacy = JSON.stringify([{ name: 'eski.jpg', data: 'data:image/jpeg;base64,AAAA' }, 'data:image/png;base64,BBBB']);
    const inserted = await db.query<{ id: number }>(
      "INSERT INTO saha_kayitlari (saha_elemani_id, saha_elemani_username, isim, soyisim, foto_data) VALUES ($1, $2, 'Eski', 'Kayit', $3) RETURNING id",
      [user.id, user.username, legacy],
    );
    const kayitId = inserted.rows[0].id;

    const list = await api('GET', '/all-kayitlar', tokenFor('admin', 1, 'itest_admin'));
    const listed = list.body.data.find((item: any) => item.id === kayitId);
    assert.equal(listed.has_photos, true);
    assert.equal(listed.foto_preview, undefined);

    const photos = await api('GET', `/kayit-photos/${kayitId}`, user.token);
    assert.deepEqual(photos.body, { fotolar: [], foto_data: legacy });
    const thumbnail = await api('GET', `/kayit-thumbnail/${kayitId}`, user.token);
    assert.deepEqual(thumbnail.body, { foto_preview: 'data:image/jpeg;base64,AAAA' });
  });

  it('eski biçimdeki kayıt: yalnız isim değişirse fotoğraflar durur; fotoğraf listesi gönderilirse R2 geçerli olur', async () => {
    const user = await sahaUser('a');
    const legacy = '["data:image/jpeg;base64,AAAA"]';
    const inserted = await db.query<{ id: number }>(
      "INSERT INTO saha_kayitlari (saha_elemani_id, saha_elemani_username, isim, soyisim, foto_data) VALUES ($1, $2, 'Eski', 'Kayit', $3) RETURNING id",
      [user.id, user.username, legacy],
    );
    const kayitId = inserted.rows[0].id;

    const rename = await api('PUT', `/kayit/${kayitId}`, user.token, { isim: 'Eski', soyisim: 'Yeni' });
    assert.equal(rename.body.kayit.has_photos, true);
    assert.equal((await api('GET', `/kayit-photos/${kayitId}`, user.token)).body.foto_data, legacy);

    const [uploaded] = await uploadPhotos(user, 1);
    const put = await api('PUT', `/kayit/${kayitId}`, user.token, { isim: 'Eski', soyisim: 'Yeni', foto_ids: [uploaded.id] });
    assert.equal(put.status, 200);
    const photos = await api('GET', `/kayit-photos/${kayitId}`, user.token);
    assert.equal(photos.body.foto_data, null);
    assert.deepEqual(photos.body.fotolar.map((foto: any) => foto.id), [uploaded.id]);
  });

  it('yönetici listeleri (all-kayitlar, user-kayitlar) önizleme adresini verir', async () => {
    const user = await sahaUser('a');
    const uploads = await uploadPhotos(user, 1);
    const kayitId: number = (await createKayit(user, [uploads[0].id])).body.kayit.id;
    const [row] = await photoRows(kayitId);
    const admin = tokenFor('admin', 1, 'itest_admin');

    const all = await api('GET', `/all-kayitlar?sahaElemaniId=${user.id}`, admin);
    assert.equal(all.body.data[0].foto_preview, `https://fake.r2/get/${row.thumb_key}`);
    assert.equal(all.body.data[0].has_photos, true);

    const byUser = await api('GET', `/user-kayitlar/${user.username}`, admin);
    assert.equal(byUser.body[0].foto_preview, `https://fake.r2/get/${row.thumb_key}`);
    assert.equal(byUser.body[0].has_photos, true);
  });
});
