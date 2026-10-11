import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_PHOTO_BYTES,
  MAX_THUMB_BYTES,
  MAX_BULK_DOWNLOAD_DAYS,
  buildBulkPhotoNames,
  buildDownloadName,
  buildRecordBaseName,
  buildObjectKeys,
  firstLegacyPhoto,
  parseDayRange,
  parsePhotoIds,
  parseUploadRequest,
  sanitizeFileName,
  turkeyDay,
  turkeyDayStart,
} from './sahaPhotoRules';

const jpeg = { mime_type: 'image/jpeg', size_bytes: 1000, thumb_size_bytes: 100 };

function messageOf(result: { ok: boolean; message?: string }): string | undefined {
  return result.ok ? undefined : result.message;
}

describe('parseUploadRequest', () => {
  it('geçerli isteği çözer; ad kırpılır, boş ad null olur', () => {
    const result = parseUploadRequest({
      fotolar: [
        { ...jpeg, name: '  IMG_1.jpg  ' },
        { mime_type: 'image/png', size_bytes: 5, name: '   ' },
      ],
    });
    assert.deepEqual(result, {
      ok: true,
      value: [
        { name: 'IMG_1.jpg', mimeType: 'image/jpeg', sizeBytes: 1000, thumbSizeBytes: 100 },
        { name: null, mimeType: 'image/png', sizeBytes: 5, thumbSizeBytes: null },
      ],
    });
  });

  it('255 karakterden uzun dosya adını keser (veritabanı kolonu 255)', () => {
    const result = parseUploadRequest({ fotolar: [{ ...jpeg, name: 'a'.repeat(300) }] });
    assert.ok(result.ok);
    assert.equal(result.value[0].name?.length, 255);
  });

  it('sınır değerler: tam sınırdaki boyut geçer, bir fazlası reddedilir', () => {
    assert.ok(parseUploadRequest({ fotolar: [{ ...jpeg, size_bytes: MAX_PHOTO_BYTES }] }).ok);
    assert.ok(!parseUploadRequest({ fotolar: [{ ...jpeg, size_bytes: MAX_PHOTO_BYTES + 1 }] }).ok);
    assert.ok(parseUploadRequest({ fotolar: [{ ...jpeg, thumb_size_bytes: MAX_THUMB_BYTES }] }).ok);
    assert.ok(
      !parseUploadRequest({ fotolar: [{ ...jpeg, thumb_size_bytes: MAX_THUMB_BYTES + 1 }] }).ok,
    );
  });

  it('fotoğraf sayısı: 0 ve 6 reddedilir, 5 geçer', () => {
    assert.ok(!parseUploadRequest({ fotolar: [] }).ok);
    assert.ok(parseUploadRequest({ fotolar: Array(5).fill(jpeg) }).ok);
    assert.match(messageOf(parseUploadRequest({ fotolar: Array(6).fill(jpeg) })) ?? '', /En fazla 5/);
  });

  it('regresyon: nesnelerin yerleşik özellik adları dosya tipi sayılmaz', () => {
    // Tipler bir nesnede aranıyor; "constructor" gibi adlar her nesnede bulunur.
    for (const mime_type of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      assert.equal(parseUploadRequest({ fotolar: [{ ...jpeg, mime_type }] }).ok, false, mime_type);
    }
  });

  it('geçersiz gövdeleri reddeder', () => {
    const invalid: unknown[] = [
      null,
      undefined,
      {},
      { fotolar: 'x' },
      { fotolar: [null] },
      { fotolar: ['data:image/jpeg;base64,AAAA'] },
      { fotolar: [{ ...jpeg, mime_type: 'image/svg+xml' }] },
      { fotolar: [{ ...jpeg, mime_type: 'text/html' }] },
      { fotolar: [{ ...jpeg, mime_type: undefined }] },
      { fotolar: [{ ...jpeg, size_bytes: 0 }] },
      { fotolar: [{ ...jpeg, size_bytes: -5 }] },
      { fotolar: [{ ...jpeg, size_bytes: 10.5 }] },
      { fotolar: [{ ...jpeg, size_bytes: '1000' }] },
      { fotolar: [{ ...jpeg, thumb_size_bytes: 0 }] },
      { fotolar: [{ ...jpeg, thumb_size_bytes: '100' }] },
      { fotolar: [{ ...jpeg, name: 42 }] },
    ];
    for (const body of invalid) {
      assert.equal(parseUploadRequest(body).ok, false, JSON.stringify(body));
    }
  });
});

describe('parsePhotoIds', () => {
  it('alan yoksa null ("fotoğraflara dokunma"), boş dizi boş dizi ("hepsini kaldır")', () => {
    assert.deepEqual(parsePhotoIds(undefined), { ok: true, value: null });
    assert.deepEqual(parsePhotoIds(null), { ok: true, value: null });
    assert.deepEqual(parsePhotoIds([]), { ok: true, value: [] });
  });

  it('sırayı korur', () => {
    assert.deepEqual(parsePhotoIds([7, 3, 5]), { ok: true, value: [7, 3, 5] });
  });

  it('geçersiz listeleri reddeder', () => {
    const invalid: unknown[] = [
      '1,2',
      5,
      {},
      [1, 2, 3, 4, 5, 6],
      [1, 1],
      [0],
      [-1],
      [1.5],
      ['1'],
      [null],
      [{ id: 1 }],
      [Number.MAX_SAFE_INTEGER + 1],
    ];
    for (const value of invalid) {
      assert.equal(parsePhotoIds(value).ok, false, JSON.stringify(value));
    }
  });
});

describe('buildObjectKeys', () => {
  it('adres yıl/ay klasöründe, uzantı dosya tipinden; önizleme her zaman .jpg', () => {
    const now = new Date('2026-03-05T10:00:00Z');
    assert.deepEqual(buildObjectKeys('abc', 'image/jpeg', now), {
      objectKey: 'saha/2026/03/abc.jpg',
      thumbKey: 'saha/2026/03/abc_k.jpg',
    });
    assert.deepEqual(buildObjectKeys('abc', 'image/png', now), {
      objectKey: 'saha/2026/03/abc.png',
      thumbKey: 'saha/2026/03/abc_k.jpg',
    });
  });

  it('ay sınırı UTC ile hesaplanır (yerel saat dilimine göre değil)', () => {
    // Türkiye saatiyle 1 Şubat 01:30, UTC'de hâlâ 31 Ocak.
    const keys = buildObjectKeys('x', 'image/webp', new Date('2026-01-31T22:30:00Z'));
    assert.equal(keys.objectKey, 'saha/2026/01/x.webp');
  });

  it('desteklenmeyen tipte hata fırlatır', () => {
    assert.throws(() => buildObjectKeys('x', 'image/gif', new Date()));
  });
});

describe('buildDownloadName', () => {
  const base = { baseName: 'Ahmet Yılmaz', index: 0, total: 1 };

  it('dosya adı kayıttaki ad soyaddır; uzantı gerçek tipten gelir', () => {
    assert.equal(buildDownloadName({ ...base, mimeType: 'image/jpeg' }), 'Ahmet_Yılmaz.jpg');
    assert.equal(buildDownloadName({ ...base, mimeType: 'image/png' }), 'Ahmet_Yılmaz.png');
    assert.equal(buildDownloadName({ ...base, mimeType: 'image/heic' }), 'Ahmet_Yılmaz.heic');
  });

  it('kayıtta birden çok fotoğraf varsa sıra numarası eklenir', () => {
    assert.equal(buildDownloadName({ ...base, mimeType: 'image/jpeg', index: 0, total: 3 }), 'Ahmet_Yılmaz_1.jpg');
    assert.equal(buildDownloadName({ ...base, mimeType: 'image/jpeg', index: 2, total: 3 }), 'Ahmet_Yılmaz_3.jpg');
  });

  it('ad boşsa ya da yalnızca yasak karakterlerden oluşuyorsa "fotograf" kullanılır', () => {
    assert.equal(buildDownloadName({ ...base, baseName: '', mimeType: 'image/jpeg' }), 'fotograf.jpg');
    assert.equal(buildDownloadName({ ...base, baseName: '???', mimeType: 'image/jpeg' }), 'fotograf.jpg');
  });

  it('dosya sisteminde sorun çıkaran karakterler temizlenir', () => {
    assert.equal(buildDownloadName({ ...base, baseName: 'Ali/Veli: "Usta"', mimeType: 'image/jpeg' }), 'Ali_Veli_Usta.jpg');
  });
});

describe('sanitizeFileName', () => {
  it('yol ayırıcıları ve yasak karakterleri temizler', () => {
    assert.equal(sanitizeFileName('..\\..\\etc/passwd'), '.._.._etc_passwd');
    assert.equal(sanitizeFileName(' a  b:c*d?"<>| '), 'a_b_c_d');
    assert.equal(sanitizeFileName('satır\nsonu'), 'satır_sonu');
    assert.equal(sanitizeFileName('x'.repeat(500)).length, 120);
  });
});

describe('buildRecordBaseName', () => {
  const kayit = { isim: 'Ahmet', soyisim: 'Yılmaz', created_at: new Date('2026-07-28T21:30:00Z') };

  it('ad soyaddan üretilir; tarih yalnızca istenirse eklenir', () => {
    assert.equal(buildRecordBaseName(kayit), 'Ahmet_Yılmaz');
    // Tarih Türkiye saatine göredir: 28 Temmuz 21:30 UTC, Türkiye'de 29 Temmuz 00:30'dur.
    assert.equal(buildRecordBaseName(kayit, { withDate: true }), 'Ahmet_Yılmaz_2026-07-29');
    assert.equal(
      buildRecordBaseName({ ...kayit, created_at: '2026-07-28T10:00:00.000Z' }, { withDate: true }),
      'Ahmet_Yılmaz_2026-07-28',
    );
  });

  it('eksik bilgiyle de çalışır', () => {
    assert.equal(buildRecordBaseName({ isim: 'Ahmet' }), 'Ahmet');
    assert.equal(buildRecordBaseName({}), 'fotograf');
    assert.equal(buildRecordBaseName({ isim: null, soyisim: null, created_at: null }, { withDate: true }), 'fotograf');
  });
});

describe('Türkiye saatine göre gün', () => {
  it('turkeyDay: gece yarısından sonraki ilk üç saat UTC\'de önceki gündür', () => {
    assert.equal(turkeyDay(new Date('2026-10-09T20:59:59Z')), '2026-10-09');
    assert.equal(turkeyDay(new Date('2026-10-09T21:00:00Z')), '2026-10-10');
    assert.equal(turkeyDay('2026-10-10T12:00:00.000Z'), '2026-10-10');
    assert.equal(turkeyDay(null), '');
    assert.equal(turkeyDay('tarih değil'), '');
  });

  it('turkeyDayStart: günün başı Türkiye saatiyle 00:00\'dır; olmayan gün reddedilir', () => {
    assert.equal(turkeyDayStart('2026-10-10')?.toISOString(), '2026-10-09T21:00:00.000Z');
    for (const value of ['2026-02-30', '2026-13-01', '2026-10-10T00:00:00', '10.10.2026', '', null, 20261010]) {
      assert.equal(turkeyDayStart(value), null, JSON.stringify(value));
    }
  });
});

describe('parseDayRange', () => {
  it('iki gün de dahildir: bitiş gününün sonuna kadar', () => {
    const range = parseDayRange('2026-10-01', '2026-10-03');
    assert.ok(range.ok);
    assert.equal(range.value.from.toISOString(), '2026-09-30T21:00:00.000Z');
    assert.equal(range.value.to.toISOString(), '2026-10-03T21:00:00.000Z');
  });

  it('tek gün seçilebilir', () => {
    const range = parseDayRange('2026-10-10', '2026-10-10');
    assert.ok(range.ok);
    assert.equal(range.value.to.getTime() - range.value.from.getTime(), 24 * 60 * 60 * 1000);
  });

  it('sınır: en uzun aralık geçer, bir gün fazlası geçmez', () => {
    assert.equal(MAX_BULK_DOWNLOAD_DAYS, 31);
    assert.ok(parseDayRange('2026-10-01', '2026-10-31').ok);
    assert.ok(!parseDayRange('2026-10-01', '2026-11-01').ok);
  });

  it('eksik, geçersiz ya da ters aralık reddedilir', () => {
    assert.ok(!parseDayRange(undefined, '2026-10-10').ok);
    assert.ok(!parseDayRange('2026-10-10', undefined).ok);
    assert.ok(!parseDayRange('2026-10-10', '2026-10-09').ok);
    assert.ok(!parseDayRange('2026-02-30', '2026-03-01').ok);
    assert.ok(!parseDayRange(['2026-10-01'], '2026-10-02').ok);
  });
});

describe('buildBulkPhotoNames', () => {
  const photo = (kayitId: number, isim: string, mimeType = 'image/jpeg', created = '2026-07-28T10:00:00Z') => ({
    kayitId,
    isim,
    soyisim: 'Yılmaz',
    created_at: new Date(created),
    mimeType,
  });

  it('ad soyad + tarih; kayıtta birden çok fotoğraf varsa sıra numarası', () => {
    assert.deepEqual(buildBulkPhotoNames([photo(1, 'Ahmet'), photo(2, 'Ayşe'), photo(2, 'Ayşe', 'image/png')]), [
      'Ahmet_Yılmaz_2026-07-28.jpg',
      'Ayşe_Yılmaz_2026-07-28_1.jpg',
      'Ayşe_Yılmaz_2026-07-28_2.png',
    ]);
  });

  it('aynı gün aynı adla iki ayrı kayıt: adlar çakışmaz', () => {
    const names = buildBulkPhotoNames([photo(1, 'Ahmet'), photo(2, 'Ahmet'), photo(2, 'Ahmet'), photo(3, 'Ahmet')]);
    assert.deepEqual(names, [
      'Ahmet_Yılmaz_2026-07-28.jpg',
      'Ahmet_Yılmaz_2026-07-28_(2)_1.jpg',
      'Ahmet_Yılmaz_2026-07-28_(2)_2.jpg',
      'Ahmet_Yılmaz_2026-07-28_(3).jpg',
    ]);
    assert.equal(new Set(names).size, names.length);
  });

  it('aynı ad farklı günlerde çakışma sayılmaz; boş liste boş döner', () => {
    assert.deepEqual(
      buildBulkPhotoNames([photo(1, 'Ahmet'), photo(2, 'Ahmet', 'image/jpeg', '2026-07-29T10:00:00Z')]),
      ['Ahmet_Yılmaz_2026-07-28.jpg', 'Ahmet_Yılmaz_2026-07-29.jpg'],
    );
    assert.deepEqual(buildBulkPhotoNames([]), []);
  });
});

describe('firstLegacyPhoto', () => {
  it('iki eski biçimi de okur', () => {
    assert.equal(firstLegacyPhoto('["data:image/jpeg;base64,AA","data:b"]'), 'data:image/jpeg;base64,AA');
    assert.equal(firstLegacyPhoto('[{"name":"a.jpg","data":"data:image/png;base64,BB"}]'), 'data:image/png;base64,BB');
  });

  it('fotoğraf yoksa null döner', () => {
    assert.equal(firstLegacyPhoto('[]'), null);
    assert.equal(firstLegacyPhoto('{}'), null);
    assert.equal(firstLegacyPhoto('[42]'), null);
    assert.equal(firstLegacyPhoto('[{"name":"a.jpg"}]'), null);
  });

  it('JSON değilse hata fırlatır', () => {
    assert.throws(() => firstLegacyPhoto('data:image/jpeg;base64,AA'));
  });
});
