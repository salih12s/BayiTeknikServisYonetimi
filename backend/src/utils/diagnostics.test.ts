import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createRateLimiter,
  formatClientEventLog,
  formatRequestLog,
  formatSlowQueryLog,
  MAX_CLIENT_EVENTS,
  sanitizeClientEvents,
  shouldLogRequest,
  stripQuery,
} from './diagnostics';

describe('shouldLogRequest: yalnızca sorunlu istekler yazılır', () => {
  it('başarılı ve hızlı istek yazılmaz', () => {
    assert.equal(shouldLogRequest(200, 120), false);
    assert.equal(shouldLogRequest(304, 2999), false);
  });
  it('400 ve üstü her zaman yazılır', () => {
    for (const status of [400, 401, 403, 404, 409, 413, 429, 500, 503]) assert.equal(shouldLogRequest(status, 5), true, String(status));
  });
  it('3 saniye ve üstü başarılı istek de yazılır (sınır dahil)', () => {
    assert.equal(shouldLogRequest(200, 3000), true);
  });
});

describe('formatRequestLog', () => {
  it('arama sorgusu (isim/telefon) loga girmez', () => {
    const line = formatRequestLog({ method: 'GET', url: '/api/islemler/search/phone?q=05551234567', status: 404, durationMs: 12.6 });
    assert.equal(line, '[istek] {"yontem":"GET","uc":"/api/islemler/search/phone","durum":404,"ms":13}');
  });
  it('rol ve kullanıcı numarası varsa eklenir', () => {
    const line = formatRequestLog({ method: 'PUT', url: '/api/atolye/7', status: 409, durationMs: 40, role: 'user', userId: 3 });
    assert.deepEqual(JSON.parse(line.replace('[istek] ', '')), { yontem: 'PUT', uc: '/api/atolye/7', durum: 409, ms: 40, rol: 'user', kullaniciId: 3 });
  });
});

describe('stripQuery', () => {
  it('? ve # sonrası atılır', () => {
    assert.equal(stripQuery('/a/b?x=1#y'), '/a/b');
    assert.equal(stripQuery('/a#frag'), '/a');
    assert.equal(stripQuery('/a'), '/a');
  });
});

describe('formatSlowQueryLog', () => {
  it('yer tutuculu sorgu tek satıra iner ve 120 karakterde kesilir', () => {
    const sql = `SELECT *\n   FROM islemler\n  WHERE cep_tel = $1 ${'AND x = 1 '.repeat(30)}`;
    const parsed = JSON.parse(formatSlowQueryLog(sql, 2500.4).replace('[yavaş sorgu] ', ''));
    assert.equal(parsed.ms, 2500);
    assert.equal(parsed.sorgu.length, 120);
    assert.ok(parsed.sorgu.startsWith('SELECT * FROM islemler WHERE cep_tel = $1'));
    assert.ok(!parsed.sorgu.includes('\n'));
  });
});

describe('sanitizeClientEvents', () => {
  it('geçerli olay: izinli alanlar kalır, bilinmeyenler atılır', () => {
    const result = sanitizeClientEvents({
      events: [{ tur: 'api-ag', uc: '/api/islemler/5', ms: 30012.7, cevrimici: true, sifre: 'gizli', token: 'abc', durum: 'x' }],
    });
    assert.deepEqual(result, { ok: true, value: [{ tur: 'api-ag', uc: '/api/islemler/5', ms: 30013, cevrimici: true }] });
  });

  it('adres alanlarında ? sonrası atılır, metinler 300 karakterde kesilir, satır sonu temizlenir', () => {
    const result = sanitizeClientEvents({
      events: [{ tur: 'mesaj', sayfa: '/?tab=2&ara=Ahmet', uc: '/api/x?telefon=0555', mesaj: `satır1\nsatır2${'a'.repeat(400)}` }],
    });
    assert.ok(result.ok);
    const [event] = result.value;
    assert.equal(event.sayfa, '/');
    assert.equal(event.uc, '/api/x');
    assert.equal((event.mesaj as string).length, 300);
    assert.ok(!(event.mesaj as string).includes('\n'));
  });

  it('negatif: liste yok, boş, çok uzun, bilinmeyen tür, nesne olmayan olay', () => {
    assert.equal(sanitizeClientEvents(null).ok, false);
    assert.equal(sanitizeClientEvents({ events: [] }).ok, false);
    assert.equal(sanitizeClientEvents({ events: Array(MAX_CLIENT_EVENTS + 1).fill({ tur: 'js' }) }).ok, false);
    assert.equal(sanitizeClientEvents({ events: [{ tur: 'hacker' }] }).ok, false);
    assert.equal(sanitizeClientEvents({ events: ['js'] }).ok, false);
  });

  it('sayı olmayan sayı alanları (NaN, Infinity, metin) atılır', () => {
    const result = sanitizeClientEvents({ events: [{ tur: 'r2', ms: Infinity, boyut: Number.NaN, deneme: '3' }] });
    assert.deepEqual(result, { ok: true, value: [{ tur: 'r2' }] });
  });
});

describe('formatClientEventLog', () => {
  it('olay ve ip tek satır JSON', () => {
    assert.equal(formatClientEventLog({ tur: 'js', mesaj: 'x' }, '1.2.3.4'), '[istemci] {"tur":"js","mesaj":"x","ip":"1.2.3.4"}');
  });
});

describe('createRateLimiter (saat sabitlenmiş)', () => {
  it('pencere içinde sınır aşılınca reddeder, pencere dolunca yeniden kabul eder', () => {
    let clock = 1_000_000;
    const limiter = createRateLimiter({ limit: 30, globalLimit: 1000, windowMs: 60_000, now: () => clock });
    assert.equal(limiter.take('a', 20), true);
    assert.equal(limiter.take('a', 10), true);
    assert.equal(limiter.take('a', 1), false, 'dakikada 30 doldu');
    assert.equal(limiter.take('b', 5), true, 'başka adresin hakkı ayrı');
    clock += 60_000;
    assert.equal(limiter.take('a', 30), true, 'bir dakika sonra yeniden');
  });

  it('bütün adreslerin toplam sınırı da uygulanır', () => {
    const clock = 0;
    const limiter = createRateLimiter({ limit: 30, globalLimit: 50, windowMs: 60_000, now: () => clock });
    assert.equal(limiter.take('a', 30), true);
    assert.equal(limiter.take('b', 20), true);
    assert.equal(limiter.take('c', 1), false);
  });
});
