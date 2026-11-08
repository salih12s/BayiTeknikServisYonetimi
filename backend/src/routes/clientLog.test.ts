/**
 * Teşhis loglarının API testleri: `POST /api/client-log` ve istek kaydı ara katmanı.
 * Veritabanı gerekmez. `console.warn` yerine sahtesi (mock) konur ve "doğru satırla
 * çağrıldı mı" kontrol edilir.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import express from 'express';
import { createClientLogRouter } from './clientLog';
import { requestLogger } from '../middleware/requestLogger';
import '../middleware/auth'; // req.user tip tanımı
import { createRateLimiter } from '../utils/diagnostics';

let warn: ReturnType<typeof mock.method>;
const warnLines = () => warn.mock.calls.map((call) => String(call.arguments[0]));

function listen(app: express.Express): Promise<{ server: http.Server; base: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
  });
}

beforeEach(() => {
  warn = mock.method(console, 'warn', () => undefined);
});
afterEach(() => mock.restoreAll());

describe('POST /api/client-log', () => {
  let server: http.Server;
  let base: string;
  let clock = 0;

  before(async () => {
    const app = express();
    app.use('/api/client-log', createClientLogRouter(createRateLimiter({ limit: 30, globalLimit: 600, windowMs: 60_000, now: () => clock })));
    ({ server, base } = await listen(app));
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => { clock += 120_000; }); // her test temiz bir hız penceresiyle başlar

  const send = (body: string, ip = '10.0.0.1') =>
    fetch(`${base}/api/client-log`, { method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8', 'x-forwarded-for': `${ip}, 172.16.0.1` }, body });

  it('happy path: sendBeacon biçiminde (text/plain JSON) olaylar 204 ile kabul edilir, her biri tek satır yazılır', async () => {
    const response = await send(JSON.stringify({ events: [
      { tur: 'api-ag', uc: '/api/islemler/5?x=1', ms: 30000, protokol: 'h3', cevrimici: true },
      { tur: 'mesaj', mesaj: 'Kayıt kaydedilirken hata oluştu!', sayfa: '/' },
    ] }));
    assert.equal(response.status, 204);
    assert.deepEqual(warnLines(), [
      '[istemci] {"tur":"api-ag","uc":"/api/islemler/5","protokol":"h3","ms":30000,"cevrimici":true,"ip":"10.0.0.1"}',
      '[istemci] {"tur":"mesaj","sayfa":"/","mesaj":"Kayıt kaydedilirken hata oluştu!","ip":"10.0.0.1"}',
    ]);
  });

  it('negative: bozuk JSON ve geçersiz olay 400, hiçbir şey yazılmaz', async () => {
    assert.equal((await send('{bozuk')).status, 400);
    assert.equal((await send(JSON.stringify({ events: [{ tur: 'bilinmeyen' }] }))).status, 400);
    assert.equal(warn.mock.callCount(), 0);
  });

  it('negative: 8 kB üstü gövde 413, log ucunun kendi hatası loga yazılmaz', async () => {
    const response = await send(JSON.stringify({ events: [{ tur: 'js', mesaj: 'x'.repeat(10_000) }] }));
    assert.equal(response.status, 413);
    assert.equal(warn.mock.callCount(), 0);
  });

  it('hız sınırı: aynı adresten dakikada 30 olaydan fazlası 429; başka adres etkilenmez', async () => {
    const twenty = JSON.stringify({ events: Array.from({ length: 20 }, () => ({ tur: 'js' })) });
    assert.equal((await send(twenty)).status, 204);
    assert.equal((await send(twenty)).status, 429);
    assert.equal((await send(twenty, '10.0.0.2')).status, 204);
    assert.equal(warn.mock.callCount(), 40);
  });
});

describe('istek kaydı ara katmanı (requestLogger)', () => {
  let server: http.Server;
  let base: string;

  before(async () => {
    const app = express();
    app.use('/api', requestLogger({ skip: (path) => path.startsWith('/api/client-log') }));
    app.use((req, _res, next) => { req.user = { id: 7, username: 'u', role: 'user' }; next(); });
    app.get('/api/tamam', (_req, res) => { res.json({ ok: true }); });
    app.get('/api/yok', (_req, res) => { res.status(404).json({ message: 'yok' }); });
    app.get('/api/yavas', (_req, res) => { setTimeout(() => res.json({ ok: true }), 3100); });
    app.post('/api/client-log', (_req, res) => { res.status(429).end(); });
    ({ server, base } = await listen(app));
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const settle = () => new Promise((resolve) => setTimeout(resolve, 50)); // 'finish' olayı cevaptan hemen sonra

  it('başarılı ve hızlı istek yazılmaz', async () => {
    await fetch(`${base}/api/tamam`);
    await settle();
    assert.equal(warn.mock.callCount(), 0);
  });

  it('404 yazılır: rol ve kullanıcı numarası var, arama sorgusu yok', async () => {
    await fetch(`${base}/api/yok?telefon=05551234567`);
    await settle();
    assert.equal(warn.mock.callCount(), 1);
    const line = JSON.parse(warnLines()[0].replace('[istek] ', ''));
    assert.deepEqual({ ...line, ms: 0 }, { yontem: 'GET', uc: '/api/yok', durum: 404, ms: 0, rol: 'user', kullaniciId: 7 });
  });

  it('3 saniyeyi aşan başarılı istek yazılır', async () => {
    await fetch(`${base}/api/yavas`);
    await settle();
    const line = JSON.parse(warnLines()[0].replace('[istek] ', ''));
    assert.equal(line.durum, 200);
    assert.ok(line.ms >= 3000, String(line.ms));
  });

  it('log ucunun kendisi (ör. 429) yazılmaz: kendini besleyen döngü olmasın', async () => {
    await fetch(`${base}/api/client-log`, { method: 'POST' });
    await settle();
    assert.equal(warn.mock.callCount(), 0);
  });
});
