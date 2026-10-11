import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bayiCreatedBy,
  createRateLimiter,
  generateLinkToken,
  isLinkToken,
  parseBayiKayit,
  upperTr,
} from './bayiKayitRules';

const gecerli = {
  ad_soyad: 'ali ışık',
  ilce: 'ESENLER',
  mahalle: 'FATİH',
  cadde: '',
  sokak: 'gül sokak',
  kapi_no: '12a',
  daire_no: '3',
  cep_tel: '0532 111 22 33',
  urun: 'KOMBİ',
  marka: 'DİĞER',
  sikayet: 'ısıtmıyor',
};

function messageOf(result: { ok: boolean; message?: string }): string {
  return result.ok ? '' : (result.message ?? '');
}

describe('link anahtarı', () => {
  it('43 karakterlik, adres çubuğuna uygun ve her seferinde farklı', () => {
    const tokens = new Set(Array.from({ length: 50 }, generateLinkToken));
    assert.equal(tokens.size, 50);
    for (const token of tokens) assert.ok(isLinkToken(token), token);
  });

  it('biçime uymayan değerler anahtar sayılmaz', () => {
    for (const value of ['', 'kisa', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}/`, `${'a'.repeat(42)}'`, null, 42, ['a'.repeat(43)]]) {
      assert.equal(isLinkToken(value), false, JSON.stringify(value));
    }
  });
});

describe('upperTr', () => {
  it('Türkçe büyütür: i -> İ, ı -> I', () => {
    assert.equal(upperTr('ali ışık çöğüş'), 'ALİ IŞIK ÇÖĞÜŞ');
    assert.equal(upperTr('İSTANBUL ilçesi'), 'İSTANBUL İLÇESİ');
  });
});

describe('parseBayiKayit', () => {
  it('geçerli formu kabul eder: metinler büyütülür, telefon yalnız rakam kalır', () => {
    const result = parseBayiKayit(gecerli);
    assert.deepEqual(result, {
      ok: true,
      value: {
        ad_soyad: 'ALİ IŞIK',
        ilce: 'ESENLER',
        mahalle: 'FATİH',
        cadde: '',
        sokak: 'GÜL SOKAK',
        kapi_no: '12A',
        apartman_site: null,
        blok_no: null,
        daire_no: '3',
        cep_tel: '05321112233',
        yedek_tel: null,
        urun: 'KOMBİ',
        marka: 'DİĞER',
        sikayet: 'ISITMIYOR',
      },
    });
  });

  it('baştaki/sondaki boşluklar ve satır sonları temizlenir', () => {
    const result = parseBayiKayit({ ...gecerli, ad_soyad: '  ali \n ışık  ', sikayet: 'çalışmıyor\r\nacil' });
    assert.ok(result.ok);
    assert.equal(result.value.ad_soyad, 'ALİ IŞIK');
    assert.equal(result.value.sikayet, 'ÇALIŞMIYOR ACİL');
  });

  it('zorunlu alanların her biri eksikken reddedilir', () => {
    for (const key of ['ad_soyad', 'ilce', 'mahalle', 'kapi_no', 'daire_no', 'cep_tel', 'urun', 'marka', 'sikayet']) {
      for (const value of ['', '   ', undefined, null]) {
        const result = parseBayiKayit({ ...gecerli, [key]: value });
        assert.equal(result.ok, false, `${key}=${JSON.stringify(value)}`);
        assert.match(messageOf(result), /zorunludur/);
      }
    }
  });

  it('cadde ve sokaktan en az biri gerekir; hangisi olduğu fark etmez', () => {
    assert.match(messageOf(parseBayiKayit({ ...gecerli, cadde: '', sokak: '' })), /Cadde veya Sokak/);
    assert.ok(parseBayiKayit({ ...gecerli, cadde: 'atatürk caddesi', sokak: '' }).ok);
  });

  it('telefon: 11 hane olmalı; yedek telefon boş bırakılabilir', () => {
    assert.match(messageOf(parseBayiKayit({ ...gecerli, cep_tel: '532 111 22 33' })), /11 haneli/);
    assert.match(messageOf(parseBayiKayit({ ...gecerli, cep_tel: '053211122334' })), /11 haneli/);
    assert.match(messageOf(parseBayiKayit({ ...gecerli, yedek_tel: '0212 555' })), /Yedek telefon/);
    const withYedek = parseBayiKayit({ ...gecerli, yedek_tel: '(0212) 555 66 77' });
    assert.ok(withYedek.ok);
    assert.equal(withYedek.value.yedek_tel, '02125556677');
  });

  it('sınır değerler: tam sınırdaki uzunluk geçer, bir fazlası kesilmez, reddedilir', () => {
    assert.ok(parseBayiKayit({ ...gecerli, ad_soyad: 'a'.repeat(100) }).ok);
    assert.match(messageOf(parseBayiKayit({ ...gecerli, ad_soyad: 'a'.repeat(101) })), /en fazla 100/);
    assert.ok(parseBayiKayit({ ...gecerli, kapi_no: '1'.repeat(20) }).ok);
    assert.match(messageOf(parseBayiKayit({ ...gecerli, kapi_no: '1'.repeat(21) })), /en fazla 20/);
    assert.match(messageOf(parseBayiKayit({ ...gecerli, sikayet: 'x'.repeat(1001) })), /en fazla 1000/);
  });

  it('metin olmayan değerler ve geçersiz gövdeler reddedilir', () => {
    for (const body of [null, undefined, 'metin', 42, [], [gecerli]]) {
      assert.equal(parseBayiKayit(body).ok, false, JSON.stringify(body));
    }
    assert.equal(parseBayiKayit({ ...gecerli, ad_soyad: { $ne: '' } }).ok, false);
    assert.equal(parseBayiKayit({ ...gecerli, sikayet: ['a'] }).ok, false);
    assert.equal(parseBayiKayit({ ...gecerli, cep_tel: 5321112233 }).ok, false);
  });

  it('formda olmayan alanlar (durum, tutar, teknisyen) kayda geçmez', () => {
    const result = parseBayiKayit({ ...gecerli, is_durumu: 'tamamlandi', tutar: 9999, teknisyen_ismi: 'x', created_by: 'admin' });
    assert.ok(result.ok);
    assert.deepEqual(Object.keys(result.value).sort(), [
      'ad_soyad', 'apartman_site', 'blok_no', 'cadde', 'cep_tel', 'daire_no', 'ilce', 'kapi_no',
      'mahalle', 'marka', 'sikayet', 'sokak', 'urun', 'yedek_tel',
    ]);
  });
});

describe('bayiCreatedBy', () => {
  it('bayi adını taşır ve kolona (50 karakter) sığar', () => {
    assert.equal(bayiCreatedBy('ÇETİNTAŞ'), 'Bayi: ÇETİNTAŞ');
    assert.equal(bayiCreatedBy('x'.repeat(100)).length, 50);
  });
});

describe('createRateLimiter', () => {
  it('pencere içinde en çok "max" denemeye izin verir; pencere geçince yeniden açılır', () => {
    // Saat elle ilerletilir: test gerçek zamana bağlı değildir (flaky olmaz).
    let now = 1_000_000;
    const limiter = createRateLimiter(3, 60_000, () => now);
    assert.deepEqual([limiter.allow('a'), limiter.allow('a'), limiter.allow('a')], [true, true, true]);
    assert.equal(limiter.allow('a'), false);

    now += 59_999;
    assert.equal(limiter.allow('a'), false);
    now += 1; // ilk üç denemenin üstünden tam bir pencere geçti
    assert.equal(limiter.allow('a'), true);
  });

  it('anahtarlar birbirini etkilemez; reddedilen deneme sayılmaz', () => {
    let now = 0;
    const limiter = createRateLimiter(1, 1000, () => now);
    assert.equal(limiter.allow('a'), true);
    assert.equal(limiter.allow('b'), true);
    for (let i = 0; i < 5; i += 1) assert.equal(limiter.allow('a'), false);
    now = 1000;
    assert.equal(limiter.allow('a'), true);
  });
});
