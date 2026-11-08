import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ADMIN, isAllowed, READ_STAFF_WRITE_ADMIN, STAFF } from './requireRole';

describe('isAllowed: izin tablosu kararı', () => {
  const islemler = { GET: STAFF, POST: STAFF, PUT: STAFF, PATCH: STAFF, DELETE: ADMIN };

  it('işlemler: ofis okur/yazar, yalnız yönetici siler; bayi ve saha hiçbirini yapamaz', () => {
    const table: Array<[string, string, boolean]> = [
      ['GET', 'user', true], ['PUT', 'user', true], ['DELETE', 'user', false], ['DELETE', 'admin', true],
      ['GET', 'bayi', false], ['GET', 'saha', false], ['POST', 'bayi', false],
    ];
    for (const [method, role, expected] of table) assert.equal(isAllowed(islemler, method, role), expected, `${method} ${role}`);
  });

  it('tanımlamalar: ofis okur, yalnız yönetici değiştirir', () => {
    assert.equal(isAllowed(READ_STAFF_WRITE_ADMIN, 'GET', 'user'), true);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.equal(isAllowed(READ_STAFF_WRITE_ADMIN, method, 'user'), false, method);
      assert.equal(isAllowed(READ_STAFF_WRITE_ADMIN, method, 'admin'), true, method);
    }
  });

  it('edge: rolsüz bilet, bilinmeyen rol, tabloda olmayan yöntem → kapalı; HEAD = GET; küçük harf yöntem', () => {
    assert.equal(isAllowed(islemler, 'GET', undefined), false);
    assert.equal(isAllowed(islemler, 'GET', 'superadmin'), false);
    assert.equal(isAllowed({ GET: STAFF }, 'DELETE', 'admin'), false);
    assert.equal(isAllowed({ GET: STAFF }, 'HEAD', 'user'), true);
    assert.equal(isAllowed({ GET: STAFF }, 'get', 'user'), true);
  });
});
