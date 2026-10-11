import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_ATOLYE_ADET, parseAdet } from './atolyeRules';

describe('parseAdet', () => {
  it('alan gönderilmediyse 1', () => {
    for (const value of [undefined, null, '']) assert.equal(parseAdet(value), 1);
  });

  it('sayı ve rakamlardan oluşan metin kabul edilir', () => {
    assert.equal(parseAdet(1), 1);
    assert.equal(parseAdet(30), 30);
    assert.equal(parseAdet('30'), 30);
    assert.equal(parseAdet(' 7 '), 7);
  });

  it('sınır değerler: 1 ve en büyük değer geçer; 0 ve bir fazlası geçmez', () => {
    assert.equal(parseAdet(MAX_ATOLYE_ADET), MAX_ATOLYE_ADET);
    assert.equal(parseAdet(MAX_ATOLYE_ADET + 1), null);
    assert.equal(parseAdet(0), null);
  });

  it('geçersiz değerler null döner', () => {
    for (const value of [-1, 2.5, '2.5', 'otuz', '3 adet', '1e2', true, [3], { adet: 3 }, NaN, Infinity]) {
      assert.equal(parseAdet(value), null, JSON.stringify(value));
    }
  });
});
