/**
 * Veritabanı katmanının GERÇEK bir MariaDB'ye karşı entegrasyon testleri.
 *
 * Sürücü ayarları (tip çevirileri, oturum modu, sıralama kuralı) sahte (mock) bir
 * veritabanıyla doğrulanamaz; burada sınanan şey MariaDB'nin kendi davranışıdır.
 *
 * Güvenlik: yalnızca adı "_test" ile biten bir veritabanında çalışır, aksi halde
 * bütün testler atlanır. Çalıştırma: `npm run test:db` (bkz. .env.test.local).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

const isTestDatabase = /_test$/.test(process.env.DB_NAME ?? '');
const options = { skip: isTestDatabase ? false : 'DB_NAME "_test" ile bitmiyor' };

describe('db (MariaDB entegrasyon)', options, () => {
  // db.ts içe aktarıldığı anda bağlantı havuzu açar; yalnızca test veritabanında yüklenir.
  let db: typeof import('./db');
  let orderByText: typeof import('./utils/sqlText').orderByText;

  before(async () => {
    db = await import('./db');
    ({ orderByText } = await import('./utils/sqlText'));

    const schema = fs.readFileSync(
      path.join(__dirname, 'migrations', 'mysql', '001_initial_schema.sql'),
      'utf8',
    );
    for (const statement of schema.split(/;\s*$/m)) {
      const sql = statement.replace(/^\s*--.*$/gm, '').trim();
      if (sql) await db.default.query(sql);
    }
  });

  // Her test temiz başlar ve kendi verisini "itest" önekiyle kurar; sıra değişse de
  // sonuç değişmez (isolation).
  beforeEach(async () => {
    await cleanup();
  });

  after(async () => {
    await cleanup();
    await db.default.end();
  });

  async function cleanup(): Promise<void> {
    await db.query("DELETE FROM markalar WHERE isim LIKE 'itest%'");
    await db.query("DELETE FROM bayiler WHERE isim LIKE 'itest%'");
    await db.query("DELETE FROM users WHERE username LIKE 'itest%'");
    await db.query("DELETE FROM printer_settings WHERE marka LIKE 'itest%'");
    await db.query("DELETE FROM atolye WHERE created_by = 'itest'");
    await db.query("DELETE FROM islemler WHERE created_by = 'itest'");
  }

  it('oturum UTC, katı mod ve harfi harfine karşılaştırma ile açılır', async () => {
    const { rows } = await db.query(
      'SELECT @@session.time_zone AS tz, @@session.sql_mode AS mode, @@collation_connection AS coll',
    );
    assert.equal(rows[0].tz, '+00:00');
    assert.match(rows[0].mode, /STRICT_TRANS_TABLES/);
    assert.equal(rows[0].coll, 'utf8mb4_nopad_bin');
  });

  it('boolean kolon true/false, COUNT metin, DECIMAL metin döner (node-pg ile aynı)', async () => {
    const inserted = await db.query(
      "INSERT INTO islemler (ad_soyad, ilce, mahalle, cadde, sokak, kapi_no, cep_tel, urun, marka, sikayet, tutar, created_by) VALUES ('itest', 'a', 'b', 'c', 'd', '1', '0', 'u', 'm', 's', $1, 'itest') RETURNING *",
      [1250.5],
    );
    assert.equal(inserted.rows[0].yazdirildi, false);
    assert.equal(inserted.rows[0].tutar, '1250.50');
    assert.equal(typeof inserted.rows[0].id, 'number');
    assert.ok(inserted.rows[0].full_tarih instanceof Date);

    const counted = await db.query(
      "SELECT COUNT(*) AS total FROM islemler WHERE created_by = 'itest'",
    );
    assert.equal(counted.rows[0].total, '1');
  });

  it('regresyon: yılı 0001 olan tarih 2001 olarak okunmaz', async () => {
    const inserted = await db.query(
      "INSERT INTO atolye (bayi_adi, tel_no, marka, sikayet, yapilma_tarihi, created_by) VALUES ('itest', '0', 'm', 's', $1, 'itest') RETURNING yapilma_tarihi",
      ['0001-01-01'],
    );
    assert.equal(inserted.rows[0].yapilma_tarihi.toISOString(), '0001-01-01T00:00:00.000Z');
  });

  it('tarih mikrosaniyesiyle saklanır, saat dilimi kayması olmaz', async () => {
    const inserted = await db.query(
      "INSERT INTO atolye (bayi_adi, tel_no, marka, sikayet, yapilma_tarihi, created_by) VALUES ('itest', '0', 'm', 's', $1, 'itest') RETURNING id, yapilma_tarihi",
      ['2026-02-03 04:28:27.703456'],
    );
    assert.equal(inserted.rows[0].yapilma_tarihi.toISOString(), '2026-02-03T04:28:27.703Z');
    const raw = await db.query(
      'SELECT CAST(yapilma_tarihi AS CHAR) AS t FROM atolye WHERE id = $1',
      [inserted.rows[0].id],
    );
    assert.equal(raw.rows[0].t, '2026-02-03 04:28:27.703456');
  });

  it('yazıcı ayarı: harf büyüklüğü ve birleşen noktayla ayrışan markalar ayrı satırdır', async () => {
    const big = [{ id: 'tarih', label: 'Tarih', position: { top: 45.3, left: 156 } }];
    const small = [{ id: 'eski', label: 'Eski', position: { top: 1, left: 2 } }];
    // "i" + birleşen nokta (U+0307): JS toLowerCase('İ') böyle üretir; canlı veride var.
    await db.query('INSERT INTO printer_settings (marka, config) VALUES ($1, $2)', [
      'itest Çetİntaş',
      JSON.stringify(big),
    ]);
    await db.query('INSERT INTO printer_settings (marka, config) VALUES ($1, $2)', [
      'itest çeti̇ntaş',
      JSON.stringify(small),
    ]);

    const exact = await db.query('SELECT config FROM printer_settings WHERE marka = $1', [
      'itest Çetİntaş',
    ]);
    assert.equal(exact.rows.length, 1);
    assert.deepEqual(exact.rows[0].config, big);

    const other = await db.query('SELECT config FROM printer_settings WHERE marka = $1', [
      'itest çeti̇ntaş',
    ]);
    assert.deepEqual(other.rows[0].config, small);
  });

  it('tekil kısıt ihlali isUniqueViolation ile tanınır; harf büyüklüğü farkı ihlal değildir', async () => {
    await db.query('INSERT INTO markalar (isim) VALUES ($1)', ['itest Marka']);
    await db.query('INSERT INTO markalar (isim) VALUES ($1)', ['itest marka']);
    await assert.rejects(
      db.query('INSERT INTO markalar (isim) VALUES ($1)', ['itest Marka']),
      (error: unknown) => db.isUniqueViolation(error),
    );
  });

  it('katı mod: fazla uzun metin kırpılmaz, hata verir', async () => {
    await assert.rejects(
      db.query('INSERT INTO markalar (isim) VALUES ($1)', [`itest${'x'.repeat(200)}`]),
    );
    const { rows } = await db.query(
      "SELECT COUNT(*) AS n FROM markalar WHERE isim LIKE 'itestxxx%'",
    );
    assert.equal(rows[0].n, '0');
  });

  it('updateReturning güncellenen satırı döndürür, satır yoksa boş döner', async () => {
    const inserted = await db.query('INSERT INTO markalar (isim) VALUES ($1) RETURNING id', [
      'itest eski ad',
    ]);
    const id = inserted.rows[0].id;

    const updated = await db.updateReturning(
      'UPDATE markalar SET isim = $1 WHERE id = $2 RETURNING *',
      ['itest yeni ad', id],
    );
    assert.equal(updated.rows.length, 1);
    assert.equal(updated.rows[0].isim, 'itest yeni ad');
    assert.equal(updated.rows[0].aktif, true);

    const missing = await db.updateReturning(
      'UPDATE markalar SET isim = $1 WHERE id = $2 RETURNING *',
      ['itest olmayan', 999999999],
    );
    assert.deepEqual(missing.rows, []);
  });

  it('updateReturning hata verirse değişiklik geri alınır', async () => {
    const first = await db.query('INSERT INTO markalar (isim) VALUES ($1) RETURNING id', [
      'itest A',
    ]);
    await db.query('INSERT INTO markalar (isim) VALUES ($1)', ['itest B']);

    await assert.rejects(
      db.updateReturning('UPDATE markalar SET isim = $1 WHERE id = $2 RETURNING *', [
        'itest B',
        first.rows[0].id,
      ]),
      (error: unknown) => db.isUniqueViolation(error),
    );
    const { rows } = await db.query('SELECT isim FROM markalar WHERE id = $1', [first.rows[0].id]);
    assert.equal(rows[0].isim, 'itest A');
  });

  it('transaction: hata olursa bütün adımlar geri alınır ve işlem yeniden denenmez', async () => {
    let attempts = 0;
    await assert.rejects(
      db.transaction(async (tx) => {
        attempts += 1;
        await tx.query('INSERT INTO markalar (isim) VALUES ($1)', ['itest tx 1']);
        await tx.query('INSERT INTO markalar (isim) VALUES ($1)', ['itest tx 2']);
        throw new Error('ikinci adımdan sonra hata');
      }),
      /ikinci adımdan sonra hata/,
    );
    assert.equal(attempts, 1);
    const { rows } = await db.query("SELECT COUNT(*) AS n FROM markalar WHERE isim LIKE 'itest tx%'");
    assert.equal(rows[0].n, '0');
  });

  it('transaction: adımlar birlikte kalıcı olur ve sonucu döner', async () => {
    const id = await db.transaction(async (tx) => {
      const inserted = await tx.query('INSERT INTO markalar (isim) VALUES ($1) RETURNING id', [
        'itest tx kalici',
      ]);
      const updated = await tx.query('UPDATE markalar SET kategori = $1 WHERE id = $2', [
        'k',
        inserted.rows[0].id,
      ]);
      assert.equal(updated.rowCount, 1);
      return inserted.rows[0].id;
    });
    const { rows } = await db.query('SELECT kategori FROM markalar WHERE id = $1', [id]);
    assert.equal(rows[0].kategori, 'k');
  });

  // Kilitlenme (deadlock): iki transaction birbirinin kilitlediği satırı bekler; veritabanı
  // birini kurban seçip geri alır. Kurban baştan çalıştırılmazsa kullanıcı 500 görür.
  it('transaction: kilitlenme kurbanı baştan çalıştırılır, iki işlem de tamamlanır', async () => {
    const a = (await db.query('INSERT INTO markalar (isim) VALUES ($1) RETURNING id', ['itest kilit A'])).rows[0].id;
    const b = (await db.query('INSERT INTO markalar (isim) VALUES ($1) RETURNING id', ['itest kilit B'])).rows[0].id;
    const gate = () => {
      let open!: () => void;
      const opened = new Promise<void>((resolve) => { open = resolve; });
      return { open, opened };
    };
    const firstHoldsA = gate();
    const secondHoldsB = gate();
    let attempts = 0;
    const update = 'UPDATE markalar SET kategori = $1 WHERE id = $2';

    await Promise.all([
      db.transaction(async (tx) => {
        attempts += 1;
        await tx.query(update, ['birinci', a]);
        firstHoldsA.open();
        await secondHoldsB.opened;
        await tx.query(update, ['birinci', b]);
      }),
      db.transaction(async (tx) => {
        attempts += 1;
        await tx.query(update, ['ikinci', b]);
        secondHoldsB.open();
        await firstHoldsA.opened;
        await tx.query(update, ['ikinci', a]);
      }),
    ]);

    assert.equal(attempts, 3);
    // Yarım iş kalmaz: iki satırı da en son aynı işlem yazmıştır.
    const { rows } = await db.query('SELECT kategori FROM markalar WHERE id IN ($1, $2)', [a, b]);
    assert.equal(rows[0].kategori, rows[1].kategori);
  });

  it('güvenlik: sayı, boolean, nesne ve dizi parametresi metin kolonla eşleşmez', async () => {
    await db.query("INSERT INTO users (username, password) VALUES ('itest_user', 'x')");
    for (const username of [0, 1, false, true, { $gt: '' }, ['itest_user'], "' OR '1'='1"]) {
      const { rows } = await db.query('SELECT id FROM users WHERE username = $1', [username]);
      assert.deepEqual(rows, [], `eşleşmemeliydi: ${JSON.stringify(username)}`);
    }
    const { rows } = await db.query('SELECT id FROM users WHERE username = $1', ['itest_user']);
    assert.equal(rows.length, 1);
  });

  it('Türkçe arama: LOWER(...) LIKE LOWER(...) büyük İ ve I ile eşleşir', async () => {
    await db.query(
      "INSERT INTO islemler (ad_soyad, ilce, mahalle, cadde, sokak, kapi_no, cep_tel, urun, marka, sikayet, created_by) VALUES ('ITEST FATİH IŞIK', 'a', 'b', 'c', 'd', '1', '0', 'u', 'm', 's', 'itest')",
    );
    for (const term of ['fatih', 'FATİH', 'işik', 'IŞIK', 'itest fat']) {
      const { rows } = await db.query(
        "SELECT id FROM islemler WHERE created_by = 'itest' AND LOWER(ad_soyad) LIKE LOWER($1)",
        [`%${term}%`],
      );
      assert.equal(rows.length, 1, `bulunmalıydı: ${term}`);
    }
  });

  // Beklenen sıra Türk alfabesi DEĞİL, canlıdaki PostgreSQL (en_US.utf8) sırasıdır:
  // "ç" ilk karşılaştırmada "c" sayılır, bu yüzden "Çınar" ("ı" < "u") "Cumhuriyet"ten önce gelir.
  it('orderByText: boşluk yok sayılır, harfler canlıdaki sırayla dizilir', async () => {
    for (const isim of [
      'itest ALFA TİCARET',
      'itest ALFAMODA',
      'itest Çınar',
      'itest Cumhuriyet',
      'itest Zeytin',
    ]) {
      await db.query('INSERT INTO bayiler (isim, username) VALUES ($1, $1)', [isim]);
    }
    const { rows } = await db.query(
      `SELECT isim FROM bayiler WHERE isim LIKE 'itest%' ORDER BY ${orderByText('isim')}`,
    );
    assert.deepEqual(
      rows.map((row: { isim: string }) => row.isim),
      ['itest ALFAMODA', 'itest ALFA TİCARET', 'itest Çınar', 'itest Cumhuriyet', 'itest Zeytin'],
    );
  });

  it('LIMIT / OFFSET parametreleri çalışır', async () => {
    for (const isim of ['itest 1', 'itest 2', 'itest 3']) {
      await db.query('INSERT INTO markalar (isim) VALUES ($1)', [isim]);
    }
    const { rows } = await db.query(
      "SELECT isim FROM markalar WHERE isim IN ('itest 1', 'itest 2', 'itest 3') ORDER BY id LIMIT $1 OFFSET $2",
      [2, 1],
    );
    assert.deepEqual(
      rows.map((row: { isim: string }) => row.isim),
      ['itest 2', 'itest 3'],
    );
  });
});
