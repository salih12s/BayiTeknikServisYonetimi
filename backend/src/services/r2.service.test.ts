import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  contentDispositionAttachment,
  getPhotoStorage,
  isR2Configured,
  setPhotoStorage,
} from './r2.service';

const ENV_NAMES = ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];

describe('contentDispositionAttachment', () => {
  it('düz ASCII ad', () => {
    assert.equal(
      contentDispositionAttachment('IMG_1.jpg'),
      "attachment; filename=\"IMG_1.jpg\"; filename*=UTF-8''IMG_1.jpg",
    );
  });

  it('Türkçe karakterler: ASCII yedeği + UTF-8 kodlu asıl ad', () => {
    const header = contentDispositionAttachment('Şükrü_Çağrı_ığİ.jpg');
    assert.match(header, /filename="Sukru_Cagri_igI\.jpg"/);
    assert.match(header, /filename\*=UTF-8''%C5%9E%C3%BCkr%C3%BC_%C3%87a%C4%9Fr%C4%B1_%C4%B1%C4%9F%C4%B0\.jpg$/);
  });

  it('başlığı bozabilecek karakterler etkisizleştirilir', () => {
    const header = contentDispositionAttachment('a"b\\c\r\nX-Kotu: 1.jpg');
    // Başlık tek satır kalmalı ve tırnak kapanmamalı.
    assert.doesNotMatch(header, /[\r\n]/);
    assert.match(header, /^attachment; filename="[^"\\]*"; filename\*=UTF-8''[A-Za-z0-9%._~!$&+-]*$/);
  });
});

describe('getPhotoStorage (tembel yapılandırma)', () => {
  const saved = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));

  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    setPhotoStorage(undefined);
  });

  it('ortam değişkenleri eksikse depo yoktur', () => {
    for (const name of ENV_NAMES) delete process.env[name];
    setPhotoStorage(undefined);
    assert.equal(getPhotoStorage(), null);
    assert.equal(isR2Configured(), false);
  });

  it('değişkenler modül yüklendikten SONRA tanımlansa da okunur', () => {
    for (const name of ENV_NAMES) delete process.env[name];
    setPhotoStorage(undefined);
    process.env.R2_ENDPOINT = 'https://ornek.r2.cloudflarestorage.com';
    process.env.R2_BUCKET = 'ornek';
    process.env.R2_ACCESS_KEY_ID = 'anahtar';
    process.env.R2_SECRET_ACCESS_KEY = 'gizli';
    assert.equal(isR2Configured(), true);
  });

  it('tek değişken eksikse depo yoktur', () => {
    process.env.R2_ENDPOINT = 'https://ornek.r2.cloudflarestorage.com';
    process.env.R2_BUCKET = 'ornek';
    process.env.R2_ACCESS_KEY_ID = 'anahtar';
    delete process.env.R2_SECRET_ACCESS_KEY;
    setPhotoStorage(undefined);
    assert.equal(isR2Configured(), false);
  });

  it('imzalı adresler ağ isteği yapmadan üretilir; okuma adresi aynı zaman diliminde sabittir', async (t) => {
    // Saat sabitlenir: test gerçek saate bağlı olsaydı 30 dakikalık dilimin sınırına
    // denk geldiğinde arada bir kalırdı (flaky).
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-01-01T10:10:00Z') });
    process.env.R2_ENDPOINT = 'https://ornek.r2.cloudflarestorage.com';
    process.env.R2_BUCKET = 'ornek';
    process.env.R2_ACCESS_KEY_ID = 'anahtar';
    process.env.R2_SECRET_ACCESS_KEY = 'gizli';
    setPhotoStorage(undefined);
    const storage = getPhotoStorage();
    assert.ok(storage);

    const upload = new URL(await storage.signUpload('saha/2026/01/a.jpg', 'image/jpeg', 1234));
    assert.equal(upload.pathname, '/ornek/saha/2026/01/a.jpg');
    // Boyut ve tip imzaya dahil: farklı dosya gönderilirse R2 reddeder.
    assert.equal(upload.searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host');

    const first = await storage.signRead('saha/2026/01/a.jpg');
    t.mock.timers.tick(15 * 60 * 1000); // 10:25 - aynı dilim (10:00-10:30)
    assert.equal(await storage.signRead('saha/2026/01/a.jpg'), first);
    t.mock.timers.tick(10 * 60 * 1000); // 10:35 - yeni dilim
    assert.notEqual(await storage.signRead('saha/2026/01/a.jpg'), first);

    const download = new URL(await storage.signRead('saha/2026/01/a.jpg', { downloadName: 'Çatı.jpg' }));
    assert.match(download.searchParams.get('response-content-disposition') ?? '', /^attachment; /);
  });
});
