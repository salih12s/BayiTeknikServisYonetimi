/**
 * Canlı güncelleme (Socket.IO) yetkisi: gerçek Socket.IO sunucusu ve istemcisiyle.
 * Veritabanı gerekmez: hesap durumu sorgusu yerine "hep aktif" diyen sahte (Fake) konur.
 *
 * Kapatılan açık: bağlantıda kimlik sorulmuyor, her işlem/atölye olayı (müşteri adı,
 * adresi, telefonu) bağlı HERKESE gidiyordu.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { io as connect, Socket } from 'socket.io-client';
import { setAccountLookupForTests } from './accountStatus';
import { emitAtolyeEvent, emitIslemEvent, roomsFor, setupSocketAuth } from './realtime';

const SECRET = 'itest-socket';

describe('roomsFor (unit)', () => {
  it('rol → oda', () => {
    assert.deepEqual(roomsFor({ role: 'admin' }), ['staff']);
    assert.deepEqual(roomsFor({ role: 'user' }), ['staff']);
    assert.deepEqual(roomsFor({ role: 'bayi', bayiIsim: 'VATAN' }), ['bayi:VATAN']);
    assert.deepEqual(roomsFor({ role: 'bayi' }), []);
    assert.deepEqual(roomsFor({ role: 'saha' }), []);
  });
});

describe('Socket.IO yetkisi (gerçek sunucu + istemci)', () => {
  let httpServer: http.Server;
  let io: Server;
  let url: string;
  const clients: Socket[] = [];

  before(async () => {
    process.env.JWT_SECRET = SECRET;
    setAccountLookupForTests(async () => true);
    httpServer = http.createServer();
    io = new Server(httpServer);
    setupSocketAuth(io);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });
  after(async () => {
    for (const client of clients) client.close();
    io.close();
    setAccountLookupForTests();
  });

  function open(token?: string): Promise<{ socket: Socket; received: string[] }> {
    return new Promise((resolve, reject) => {
      const socket = connect(url, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: false });
      clients.push(socket);
      const received: string[] = [];
      socket.onAny((event, payload) => received.push(`${event}:${JSON.stringify(payload)}`));
      socket.on('connect', () => resolve({ socket, received }));
      socket.on('connect_error', (error) => reject(error));
    });
  }
  const token = (payload: object) => jwt.sign({ id: 1, username: 'u', ...payload }, SECRET);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

  it('negative: biletsiz ve sahte biletli bağlantı reddedilir', async () => {
    await assert.rejects(open(), /Giriş gerekli/);
    await assert.rejects(open(jwt.sign({ id: 1, role: 'admin' }, 'yanlis-anahtar')), /Geçersiz giriş/);
  });

  it('işlem olayı yalnız ofise; atölye olayı ofise + yalnız sahibi bayiye', async () => {
    const staff = await open(token({ role: 'user' }));
    const vatan = await open(token({ role: 'bayi', bayiIsim: 'VATAN' }));
    const diger = await open(token({ role: 'bayi', bayiIsim: 'DİĞER' }));
    const saha = await open(token({ role: 'saha' }));

    emitIslemEvent(io, 'yeni-islem', { id: 1, ad_soyad: 'Müşteri' });
    emitAtolyeEvent(io, 'yeni-atolye', { id: 7 }, 'VATAN');
    await settle();

    assert.deepEqual(staff.received, ['yeni-islem:{"id":1,"ad_soyad":"Müşteri"}', 'yeni-atolye:{"id":7}']);
    assert.deepEqual(vatan.received, ['yeni-atolye:{"id":7}']);
    assert.deepEqual(diger.received, [], 'başka bayinin kaydı gitmemeli');
    assert.deepEqual(saha.received, [], 'saha elemanına müşteri olayı gitmemeli');
  });

  it('pasif/silinmiş hesap bağlanamaz', async () => {
    setAccountLookupForTests(async () => false);
    await assert.rejects(open(token({ role: 'user' })), /Hesap pasif/);
    setAccountLookupForTests(async () => true);
  });
});
