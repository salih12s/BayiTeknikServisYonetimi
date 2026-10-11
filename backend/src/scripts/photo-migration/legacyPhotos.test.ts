import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import {
  decodeDataUrl,
  legacyObjectKeys,
  parseLegacyPhotos,
  prepareLegacyPhoto,
  sha256,
} from './legacyPhotos';

/** Fotoğraf gibi (sıkışması zor) gürültülü görüntü üretir; her çalışmada aynıdır. */
function noisePixels(width: number, height: number, channels: 3 | 4): Buffer {
  const pixels = Buffer.alloc(width * height * channels);
  let state = 12345;
  for (let i = 0; i < pixels.length; i += 1) {
    state = (state * 1664525 + 1013904223) % 4294967296;
    pixels[i] = state >>> 24;
  }
  return pixels;
}

function noiseImage(width: number, height: number) {
  return sharp(noisePixels(width, height, 3), { raw: { width, height, channels: 3 } });
}

async function sizeOf(body: Buffer): Promise<[number | undefined, number | undefined, string | undefined]> {
  const meta = await sharp(body).metadata();
  return [meta.width, meta.height, meta.format];
}

describe('parseLegacyPhotos', () => {
  it('iki sürümü de okur; ad kırpılır', () => {
    assert.deepEqual(parseLegacyPhotos('["data:a","data:b"]'), [
      { dataUrl: 'data:a', name: null },
      { dataUrl: 'data:b', name: null },
    ]);
    assert.deepEqual(parseLegacyPhotos('[{"name":" IMG.jpg ","data":"data:a"},{"data":"data:b"}]'), [
      { dataUrl: 'data:a', name: 'IMG.jpg' },
      { dataUrl: 'data:b', name: null },
    ]);
  });

  it('JSON olmayan yük tek bir data URL sayılır (arayüzle aynı)', () => {
    assert.deepEqual(parseLegacyPhotos('data:image/jpeg;base64,AAAA'), [
      { dataUrl: 'data:image/jpeg;base64,AAAA', name: null },
    ]);
    assert.deepEqual(parseLegacyPhotos('"data:x"'), [{ dataUrl: 'data:x', name: null }]);
  });

  it('çözülemeyen öğe atlanmaz, null olur: sıra numaraları kaymaz', () => {
    assert.deepEqual(parseLegacyPhotos('["data:a", 42, {"name":"x"}, "data:b"]'), [
      { dataUrl: 'data:a', name: null },
      null,
      null,
      { dataUrl: 'data:b', name: null },
    ]);
    assert.deepEqual(parseLegacyPhotos('{"a":1}'), [null]);
    assert.deepEqual(parseLegacyPhotos('[]'), []);
  });
});

describe('decodeDataUrl', () => {
  it('base64 ve düz metin yükü çözer', () => {
    assert.deepEqual(decodeDataUrl('data:image/JPEG;base64,QUJD'), {
      body: Buffer.from('ABC'),
      mimeType: 'image/jpeg',
    });
    assert.deepEqual(decodeDataUrl('data:image/svg+xml,%3Csvg%3E'), {
      body: Buffer.from('<svg>'),
      mimeType: 'image/svg+xml',
    });
  });

  it('geçersiz ya da boş yükte null döner', () => {
    for (const value of ['', 'abc', 'data:image/jpeg;base64', 'data:image/jpeg;base64,', 'data:;base64,QUJD', 'data:image/jpeg,%E0%A4%A']) {
      assert.equal(decodeDataUrl(value), null, value);
    }
  });
});

describe('legacyObjectKeys', () => {
  it('adres kayıt, sıra ve özetten oluşur; aynı girdi aynı adresi verir', () => {
    const checksum = 'ab'.repeat(32);
    assert.deepEqual(legacyObjectKeys(123, 2, checksum, 'image/jpeg'), {
      objectKey: 'saha/eski/123/2-abababababababab.jpg',
      thumbKey: 'saha/eski/123/2-abababababababab_k.jpg',
    });
    assert.equal(legacyObjectKeys(1, 0, checksum, 'image/png').objectKey, 'saha/eski/1/0-abababababababab.png');
    assert.equal(legacyObjectKeys(1, 0, checksum, 'image/heic').objectKey, 'saha/eski/1/0-abababababababab.heic');
  });
});

describe('prepareLegacyPhoto (sharp)', () => {
  it('büyük fotoğraf en uzun kenarı 2000 px JPEG olur, 400 px önizleme üretilir', async () => {
    const original = await noiseImage(3000, 2000).jpeg({ quality: 95 }).toBuffer();
    const prepared = await prepareLegacyPhoto(original, 'image/jpeg');

    assert.equal(prepared.outcome, 'resized');
    assert.equal(prepared.mimeType, 'image/jpeg');
    assert.deepEqual(await sizeOf(prepared.body), [2000, 1333, 'jpeg']);
    assert.deepEqual(await sizeOf(prepared.thumb as Buffer), [400, 267, 'jpeg']);
    assert.ok(prepared.body.length < original.length);
  });

  it('dik fotoğrafta sınır uzun kenara uygulanır', async () => {
    const original = await noiseImage(1500, 3000).jpeg({ quality: 95 }).toBuffer();
    const prepared = await prepareLegacyPhoto(original, 'image/jpeg');
    assert.deepEqual(await sizeOf(prepared.body), [1000, 2000, 'jpeg']);
    assert.deepEqual(await sizeOf(prepared.thumb as Buffer), [200, 400, 'jpeg']);
  });

  it('küçültülmüş hali büyük çıkarsa orijinal bayt bayt saklanır', async () => {
    const original = await noiseImage(300, 200).jpeg({ quality: 20 }).toBuffer();
    const prepared = await prepareLegacyPhoto(original, 'image/jpeg');

    assert.equal(prepared.outcome, 'original');
    assert.ok(prepared.body.equals(original));
    assert.equal(prepared.mimeType, 'image/jpeg');
    // Küçük görüntü büyütülmez.
    assert.deepEqual(await sizeOf(prepared.thumb as Buffer), [300, 200, 'jpeg']);
  });

  it('telefonun yön (EXIF) bilgisi uygulanır', async () => {
    const original = await noiseImage(2400, 1200).jpeg({ quality: 95 }).withMetadata({ orientation: 6 }).toBuffer();
    const prepared = await prepareLegacyPhoto(original, 'image/jpeg');
    assert.equal(prepared.outcome, 'resized');
    // Yön 6: görüntü 90 derece dönük gösterilir -> 1200x2400 -> 1000x2000.
    assert.deepEqual(await sizeOf(prepared.body), [1000, 2000, 'jpeg']);
    assert.equal((await sharp(prepared.body).metadata()).orientation, undefined);
  });

  it('saydam PNG JPEG olurken arka plan beyaz olur (siyah değil)', async () => {
    const pixels = noisePixels(2200, 1100, 4);
    // Sol üst köşe tamamen saydam.
    for (let y = 0; y < 200; y += 1) {
      for (let x = 0; x < 200; x += 1) pixels[(y * 2200 + x) * 4 + 3] = 0;
    }
    const original = await sharp(pixels, { raw: { width: 2200, height: 1100, channels: 4 } }).png().toBuffer();
    const prepared = await prepareLegacyPhoto(original, 'image/png');

    assert.equal(prepared.outcome, 'resized');
    assert.equal(prepared.mimeType, 'image/jpeg');
    const corner = await sharp(prepared.body).extract({ left: 20, top: 20, width: 10, height: 10 }).raw().toBuffer();
    assert.ok(corner.every((value) => value > 240), 'saydam bölge beyaz olmalı');
  });

  it('tarayıcının gösteremediği tip (TIFF) küçük olsa da JPEG\'e çevrilir', async () => {
    const original = await noiseImage(100, 80).tiff({ compression: 'lzw' }).toBuffer();
    const prepared = await prepareLegacyPhoto(original, 'image/tiff');
    assert.equal(prepared.outcome, 'resized');
    assert.deepEqual(await sizeOf(prepared.body), [100, 80, 'jpeg']);
  });

  it('açılamayan veri atılmaz: olduğu gibi, önizlemesiz saklanır', async () => {
    const garbage = Buffer.from('bu bir fotoğraf değil');
    const prepared = await prepareLegacyPhoto(garbage, 'image/heic');
    assert.equal(prepared.outcome, 'unreadable');
    assert.ok(prepared.body.equals(garbage));
    assert.equal(prepared.mimeType, 'image/heic');
    assert.equal(prepared.thumb, null);
  });

  it('yarıda kesilmiş JPEG bozuk bir görüntüye çevrilmez, olduğu gibi saklanır', async () => {
    const full = await noiseImage(800, 600).jpeg({ quality: 90 }).toBuffer();
    const truncated = full.subarray(0, Math.floor(full.length / 2));
    const prepared = await prepareLegacyPhoto(truncated, 'image/jpeg');
    assert.equal(prepared.outcome, 'unreadable');
    assert.ok(prepared.body.equals(truncated));
  });
});

describe('sha256', () => {
  it('bilinen özet', () => {
    assert.equal(sha256(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
