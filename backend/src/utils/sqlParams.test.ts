import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compileQuery,
  encodeParam,
  parseUtcDateTime,
  toSqlTimestamp,
  quoteString,
  splitUpdateReturning,
} from './sqlParams';

describe('compileQuery: yer tutucular', () => {
  it('numaralı parametreleri sırasına göre yerleştirir', () => {
    assert.equal(
      compileQuery('SELECT * FROM t WHERE a = $1 AND b = $2', ['x', 'y']),
      "SELECT * FROM t WHERE a = 'x' AND b = 'y'",
    );
  });

  it('aynı parametre birden çok kez kullanılabilir', () => {
    assert.equal(
      compileQuery('WHERE cep_tel LIKE $1 OR yedek_tel LIKE $1', ['%532%']),
      "WHERE cep_tel LIKE '%532%' OR yedek_tel LIKE '%532%'",
    );
  });

  it('$10, $1 ile karışmaz', () => {
    const params = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    assert.equal(compileQuery('VALUES ($1, $10)', params), "VALUES ('a', 'j')");
  });

  it('parametresi olmayan yer tutucu hata verir', () => {
    assert.throws(() => compileQuery('WHERE id = $2', ['x']), /\$2 için parametre yok/);
  });

  it('dize sabiti, ad ve yorum içindeki $n dizilerine dokunmaz', () => {
    assert.equal(
      compileQuery('SELECT \'$1\', `$1`, "$1" /* $1 */ FROM t WHERE a = $1 -- $1', ['x']),
      "SELECT '$1', `$1`, \"$1\" /* $1 */ FROM t WHERE a = 'x' -- $1",
    );
  });

  it("çift tırnakla kaçışlanmış ('') dize sabitini doğru atlar", () => {
    assert.equal(
      compileQuery("WHERE a = 'it''s $1' AND b = $1", ['x']),
      "WHERE a = 'it''s $1' AND b = 'x'",
    );
  });
});

describe('compileQuery: değer tipleri', () => {
  it('sayı tırnaklı yazılır: metin kolonda "= 0" bütün satırlarla eşleşmesin', () => {
    assert.equal(compileQuery('WHERE username = $1', [0]), "WHERE username = '0'");
    assert.equal(compileQuery('WHERE id = $1', [42]), "WHERE id = '42'");
  });

  it("boolean '1' / '0' olur", () => {
    assert.equal(compileQuery('SET yazdirildi = $1', [true]), "SET yazdirildi = '1'");
    assert.equal(compileQuery('WHERE username = $1', [false]), "WHERE username = '0'");
  });

  it('null ve undefined NULL olur', () => {
    assert.equal(compileQuery('VALUES ($1, $2)', [null, undefined]), 'VALUES (NULL, NULL)');
  });

  it('nesne JSON metnine çevrilir, SQL parçasına dönüşmez', () => {
    assert.equal(
      compileQuery('WHERE username = $1', [{ password: 1 }]),
      'WHERE username = \'{\\"password\\":1}\'',
    );
  });

  it('dizi tek bir metin değeri olur, değer listesine genişlemez', () => {
    assert.equal(compileQuery('WHERE id = $1', [[1, 2]]), "WHERE id = '[1,2]'");
    assert.equal(
      compileQuery('WHERE username = $1', [['a', 'b']]),
      'WHERE username = \'[\\"a\\",\\"b\\"]\'',
    );
  });

  it('tarih UTC ve milisaniyeli yazılır', () => {
    assert.equal(encodeParam(new Date('2026-02-03T04:28:27.703Z')), "'2026-02-03 04:28:27.703'");
  });

  it('geçersiz tarih reddedilir', () => {
    assert.throws(() => encodeParam(new Date('yok')), /Geçersiz tarih/);
  });

  it('regresyon: NaN ve sonsuz NULL olur (ay=x filtresi 500 değil boş sonuç dönsün)', () => {
    assert.equal(
      compileQuery('WHERE EXTRACT(MONTH FROM t) = $1', [Number.NaN]),
      'WHERE EXTRACT(MONTH FROM t) = NULL',
    );
    assert.equal(encodeParam(Number.POSITIVE_INFINITY), 'NULL');
  });
});

describe('compileQuery: SQL enjeksiyonu', () => {
  it('tek tırnak ve ters bölü kaçışlanır', () => {
    assert.equal(quoteString("x' OR '1'='1"), "'x\\' OR \\'1\\'=\\'1'");
    assert.equal(quoteString('a\\'), "'a\\\\'");
  });

  it('sondaki ters bölü dizeyi açık bırakamaz', () => {
    const sql = compileQuery('WHERE a = $1 AND b = $2', ['\\', ' OR 1=1 -- ']);
    assert.equal(sql, "WHERE a = '\\\\' AND b = ' OR 1=1 -- '");
  });

  it('Türkçe karakterler olduğu gibi kalır', () => {
    assert.equal(quoteString('Çetintaş çeti̇ntaş İğne'), "'Çetintaş çeti̇ntaş İğne'");
  });
});

describe('compileQuery: LIMIT / OFFSET', () => {
  it('tam sayılar tırnaksız yazılır', () => {
    assert.equal(
      compileQuery('SELECT * FROM t ORDER BY id DESC LIMIT $1 OFFSET $2', [50, 100]),
      'SELECT * FROM t ORDER BY id DESC LIMIT 50 OFFSET 100',
    );
  });

  it('rakamlardan oluşan metin kabul edilir', () => {
    assert.equal(compileQuery('LIMIT $1', ['25']), 'LIMIT 25');
  });

  it('sayı olmayan, negatif ya da kesirli değer reddedilir', () => {
    assert.throws(() => compileQuery('LIMIT $1', ['1; DROP TABLE users']), /LIMIT için/);
    assert.throws(() => compileQuery('LIMIT $1', [-1]), /LIMIT için/);
    assert.throws(() => compileQuery('LIMIT 10 OFFSET $1', [1.5]), /OFFSET için/);
    assert.throws(() => compileQuery('LIMIT $1', [null]), /LIMIT için/);
  });

  it('LIMIT ile bitmeyen bir kelimeden sonra gelen parametre normal işlenir', () => {
    assert.equal(compileQuery('WHERE daire_limit = $1', [5]), "WHERE daire_limit = '5'");
  });
});

describe('parseUtcDateTime', () => {
  it('mikrosaniyeli değeri UTC olarak ve milisaniyeye kırparak çevirir', () => {
    assert.equal(
      parseUtcDateTime('2026-02-03 04:28:27.703999').toISOString(),
      '2026-02-03T04:28:27.703Z',
    );
  });

  it('kesirsiz değeri çevirir', () => {
    assert.equal(parseUtcDateTime('2026-10-11 17:32:57').toISOString(), '2026-10-11T17:32:57.000Z');
  });

  it('regresyon: 0001 yılı 1901 ya da 2001 olmaz', () => {
    assert.equal(
      parseUtcDateTime('0001-01-01 00:00:00.000000').toISOString(),
      '0001-01-01T00:00:00.000Z',
    );
    assert.equal(
      parseUtcDateTime('0099-12-31 23:59:59.999999').toISOString(),
      '0099-12-31T23:59:59.999Z',
    );
  });

  it('tanınmayan metin geçersiz tarih döndürür', () => {
    assert.ok(Number.isNaN(parseUtcDateTime('yok').getTime()));
  });
});

describe('toSqlTimestamp', () => {
  it('regresyon: Z ekli ISO metninde ek atılır, saat değişmez', () => {
    assert.equal(toSqlTimestamp('2026-10-11T10:30:00.000Z'), '2026-10-11 10:30:00.000');
  });

  it('saat dilimi farkı da atılır (PostgreSQL timestamp davranışı)', () => {
    assert.equal(toSqlTimestamp('2026-10-11T10:30:00+03:00'), '2026-10-11 10:30:00');
    assert.equal(toSqlTimestamp('2026-10-11 10:30-0300'), '2026-10-11 10:30');
  });

  it('eki olmayan değerlere dokunmaz', () => {
    assert.equal(toSqlTimestamp('2026-10-11'), '2026-10-11');
    assert.equal(toSqlTimestamp('2026-10-11T10:30:00'), '2026-10-11T10:30:00');
    assert.equal(toSqlTimestamp('0001-01-01'), '0001-01-01');
  });

  it('metin olmayan ve tanınmayan değerleri olduğu gibi döndürür', () => {
    assert.equal(toSqlTimestamp(null), null);
    assert.equal(toSqlTimestamp(undefined), undefined);
    assert.equal(toSqlTimestamp('31.12.2026'), '31.12.2026');
    assert.equal(toSqlTimestamp(''), '');
  });
});

describe('splitUpdateReturning', () => {
  it('UPDATE ve geri okuma SELECT cümlesini üretir', () => {
    assert.deepEqual(
      splitUpdateReturning('UPDATE markalar SET isim = $1 WHERE id = $2 RETURNING *'),
      {
        update: 'UPDATE markalar SET isim = $1 WHERE id = $2',
        select: 'SELECT * FROM markalar WHERE id = $2',
      },
    );
  });

  it('çok satırlı cümleyi ve kolon listesini işler', () => {
    const parts = splitUpdateReturning(`
      UPDATE saha_kayitlari
       SET isim = $1, soyisim = $2, updated_at = NOW(6)
       WHERE id = $3 AND saha_elemani_id = $4
       RETURNING id, isim
    `);
    assert.equal(
      parts.select,
      'SELECT id, isim FROM saha_kayitlari WHERE id = $3 AND saha_elemani_id = $4',
    );
    assert.match(
      parts.update,
      /^UPDATE saha_kayitlari SET isim = \$1, soyisim = \$2, updated_at = NOW\(6\) WHERE id = \$3/,
    );
  });

  it('beklenen biçimde olmayan cümleyi reddeder', () => {
    assert.throws(
      () => splitUpdateReturning('UPDATE t SET a = 1 RETURNING *'),
      /biçimi bekleniyor/,
    );
    assert.throws(
      () => splitUpdateReturning('DELETE FROM t WHERE id = $1 RETURNING *'),
      /biçimi bekleniyor/,
    );
  });
});
