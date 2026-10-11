import express, { Request, RequestHandler, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, transaction, updateReturning } from '../db';
import authenticateToken from '../middleware/auth';
import logger from '../utils/logger';
import requireIntegerParam from '../middleware/requireIntegerParam';
import {
  PhotoError,
  assertUploaded,
  attachPhotosToNewRecord,
  createPendingUploads,
  findUnattachedPhotoIds,
  listRecordPhotos,
  queueRecordPhotos,
  queueUserPhotos,
  replaceRecordPhotos,
  signPreviewUrl,
  sweepPhotoStorageInBackground,
} from '../services/sahaPhoto.service';
import { firstLegacyPhoto, parsePhotoIds, parseUploadRequest } from '../utils/sahaPhotoRules';

const router = express.Router();
router.param('id', requireIntegerParam);

// MySQL geçersiz bir tarih metnini hata vermeden yok sayar ve filtresiz sonuç döndürür
// (PostgreSQL hata veriyordu). Bu yüzden tarih filtreleri sorgudan önce doğrulanır.
const DATE_PARAM = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?Z?)?$/;

function invalidDateParam(...values: unknown[]): boolean {
  return values.some((value) => {
    if (value === undefined || value === '') return false;
    if (typeof value !== 'string' || !DATE_PARAM.test(value)) return true;
    return Number.isNaN(new Date(value.replace(' ', 'T')).getTime());
  });
}

// Kayıt satırının API'ye dönen kolonları. foto_data (eski, veritabanındaki base64
// fotoğraflar) megabaytlarca olabilir; yalnızca fotoğraf uçlarında okunur.
const KAYIT_COLUMNS =
  'id, saha_elemani_id, saha_elemani_username, isim, soyisim, foto_url, notlar, created_at, updated_at';

/**
 * Liste satırına fotoğraf bilgisini ekleyen kolonlar: kaydın ilk fotoğrafının önizleme
 * adresi (R2) ve eski biçimde (foto_data) fotoğrafı olup olmadığı.
 */
function photoColumns(table: string): string {
  return `(${table}.foto_data IS NOT NULL) AS has_legacy_photos,
             (SELECT COALESCE(f.thumb_key, f.object_key) FROM saha_fotograflari f
               WHERE f.saha_kaydi_id = ${table}.id
               ORDER BY f.sort_order, f.id LIMIT 1) AS foto_thumb_key`;
}

/** photoColumns ile okunan satırı API biçimine çevirir: has_photos + foto_preview. */
async function withPhotoInfo<
  T extends { has_legacy_photos?: unknown; foto_thumb_key?: string | null },
>(row: T) {
  const { has_legacy_photos, foto_thumb_key, ...rest } = row;
  return {
    ...rest,
    // MySQL "(foto_data IS NOT NULL)" ifadesini 1/0 döndürür; API true/false verir.
    has_photos: Boolean(foto_thumb_key) || Boolean(Number(has_legacy_photos)),
    foto_preview: await signPreviewUrl(foto_thumb_key),
  };
}

// Saha elemanı, kullanıcı, bayi ve yönetici numaraları ayrı tablolardan gelir ve
// çakışır (1 numaralı bayi ile 1 numaralı saha elemanı farklı kişilerdir). "Kendi
// kaydın" kontrolü yalnızca numaraya baktığı için bu uçlar saha rolü ister.
const requireSaha: RequestHandler = (req, res, next) => {
  if (req.user?.role !== 'saha') {
    res.status(403).json({ message: 'Bu işlem yalnızca saha elemanları içindir' });
    return;
  }
  next();
};

// Saha elemanlarını yönetmek (eklemek, silmek, açıp kapatmak) yalnızca yöneticinin işidir.
const requireAdmin: RequestHandler = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ message: 'Bu işlem için yönetici yetkisi gerekir' });
    return;
  }
  next();
};

// Bütün saha kayıtlarını görmek ofis çalışanlarının (kullanıcı ve yönetici) işidir;
// saha elemanı yalnızca kendi kayıtlarını görür, bayi hiçbirini.
const requireStaff: RequestHandler = (req, res, next) => {
  if (req.user?.role === 'saha' || req.user?.role === 'bayi') {
    res.status(403).json({ message: 'Bu işlem için yetkiniz yok' });
    return;
  }
  next();
};

// Eski arayüz fotoğrafları base64 olarak kayıt gövdesinde gönderiyordu. Sessizce yok
// saymak fotoğrafların kaybolmasına yol açar; açık bir hata döner.
function hasLegacyPhotoPayload(body: { foto_data?: unknown }): boolean {
  return typeof body?.foto_data === 'string' && body.foto_data.length > 0;
}

const LEGACY_PAYLOAD_MESSAGE = 'Uygulama güncellendi. Lütfen sayfayı yenileyip tekrar deneyin.';

function sendError(res: Response, error: unknown, label: string): void {
  if (error instanceof PhotoError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  logger.error(label, error);
  res.status(500).json({ message: 'Sunucu hatası' });
}

// Fotoğrafları kim görebilir: saha elemanı yalnızca kendi kayıtlarınınkini; kullanıcı
// ve yönetici (Saha Kayıtları ekranı) hepsini; bayi hiçbirini.
function canViewPhotos(role: string | undefined): boolean {
  return role !== 'bayi';
}

function ownsOrMayViewAll(
  user: { id: number; role?: string },
  kayit: { saha_elemani_id: number | null },
): boolean {
  return user.role !== 'saha' || kayit.saha_elemani_id === user.id;
}

// Saha Elemanı Girişi
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;

    // Saha elemanını bul
    const sahaElemani = await query(
      'SELECT * FROM saha_elemanlari WHERE username = $1',
      [username]
    );

    if (sahaElemani.rows.length === 0) {
      res.status(401).json({ message: 'Kullanıcı adı veya şifre hatalı' });
      return;
    }

    const user = sahaElemani.rows[0];

    // Aktiflik kontrolü
    if (!user.is_active) {
      res.status(401).json({ message: 'Hesabınız pasif durumdadır' });
      return;
    }

    // Şifreyi kontrol et
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      res.status(401).json({ message: 'Kullanıcı adı veya şifre hatalı' });
      return;
    }

    // Token oluştur
    const token = jwt.sign(
      { id: user.id, username: user.username, role: 'saha' },
      process.env.JWT_SECRET || '',
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Saha girişi başarılı',
      token,
      user: {
        id: user.id,
        username: user.username,
        ad_soyad: user.ad_soyad,
        role: 'saha'
      }
    });
  } catch (error) {
    logger.error('Saha giriş hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Yeni Saha Elemanı Oluştur (Sadece Admin)
router.post('/create', authenticateToken, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password, ad_soyad } = req.body;

    // Kullanıcı var mı kontrol et
    const userCheck = await query(
      'SELECT * FROM saha_elemanlari WHERE username = $1',
      [username]
    );

    if (userCheck.rows.length > 0) {
      res.status(400).json({ message: 'Bu kullanıcı adı zaten kullanılıyor' });
      return;
    }

    // Şifreyi hashle
    const hashedPassword = await bcrypt.hash(password, 10);

    // Saha elemanını kaydet
    const newUser = await query(
      'INSERT INTO saha_elemanlari (username, password, ad_soyad, created_at, is_active) VALUES ($1, $2, $3, NOW(6), TRUE) RETURNING id, username, ad_soyad, created_at, is_active',
      [username, hashedPassword, ad_soyad || null]
    );

    res.status(201).json({
      message: 'Saha elemanı başarıyla oluşturuldu',
      user: newUser.rows[0]
    });
  } catch (error) {
    logger.error('Saha elemanı oluşturma hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Tüm Saha Elemanlarını Listele (Admin)
router.get('/users', authenticateToken, requireStaff, async (_req: Request, res: Response): Promise<void> => {
  try {
    const users = await query(
      `SELECT 
        se.id, 
        se.username, 
        se.ad_soyad,
        se.created_at,
        se.is_active,
        COUNT(sk.id) as total_records
      FROM saha_elemanlari se
      LEFT JOIN saha_kayitlari sk ON sk.saha_elemani_id = se.id
      GROUP BY se.id, se.username, se.ad_soyad, se.created_at, se.is_active
      ORDER BY se.created_at DESC`
    );

    res.json(users.rows);
  } catch (error) {
    logger.error('Saha elemanları listeleme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Saha Elemanını Aktif/Pasif Yap
router.patch('/users/:id/toggle', authenticateToken, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const result = await updateReturning(
      'UPDATE saha_elemanlari SET is_active = NOT is_active, updated_at = NOW(6) WHERE id = $1 RETURNING id, username, is_active',
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Saha elemanı bulunamadı' });
      return;
    }

    res.json({ 
      message: result.rows[0].is_active ? 'Saha elemanı aktif edildi' : 'Saha elemanı pasif edildi',
      user: result.rows[0]
    });
  } catch (error) {
    logger.error('Saha elemanı durumu değiştirme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Saha Elemanını Sil
router.delete('/users/:id', authenticateToken, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Elemanın kayıtları ve fotoğraf satırları FK ile birlikte silinir; R2'deki
    // dosyaların adresleri aynı transaction'da silme kuyruğuna yazılır.
    await transaction(async (tx) => {
      await tx.query('SELECT id FROM saha_elemanlari WHERE id = $1 FOR UPDATE', [id]);
      await queueUserPhotos(tx, Number(id));
      await tx.query('DELETE FROM saha_elemanlari WHERE id = $1', [id]);
    });
    sweepPhotoStorageInBackground();

    res.json({ message: 'Saha elemanı başarıyla silindi' });
  } catch (error) {
    logger.error('Saha elemanı silme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Fotoğraf yükleme adresi al (Saha Elemanı). Tarayıcı her fotoğrafı dönen imzalı
// adrese doğrudan yükler, sonra numaralarını kayıt gövdesinde foto_ids ile gönderir.
router.post('/foto-yukleme', authenticateToken, requireSaha, async (req: Request, res: Response): Promise<void> => {
  try {
    const photos = parseUploadRequest(req.body);
    if (!photos.ok) {
      res.status(400).json({ message: photos.message });
      return;
    }

    const fotolar = await createPendingUploads(req.user!.id, photos.value);
    res.status(201).json({ fotolar });
  } catch (error) {
    sendError(res, error, 'Fotoğraf yükleme adresi hatası:');
  }
});

// Yeni Kayıt Ekle (Saha Elemanı)
router.post('/kayit', authenticateToken, requireSaha, async (req: Request, res: Response): Promise<void> => {
  try {
    const { isim, soyisim, notlar } = req.body;
    const user = req.user!;

    if (!isim || !soyisim) {
      res.status(400).json({ message: 'İsim ve soyisim zorunludur' });
      return;
    }
    if (hasLegacyPhotoPayload(req.body)) {
      res.status(400).json({ message: LEGACY_PAYLOAD_MESSAGE });
      return;
    }
    const photoIds = parsePhotoIds(req.body.foto_ids);
    if (!photoIds.ok) {
      res.status(400).json({ message: photoIds.message });
      return;
    }
    const ids = photoIds.value ?? [];

    await assertUploaded(user.id, ids);

    // Kayıt ve fotoğraflarının bağlanması tek transaction'dır: fotoğraf bağlanamazsa
    // kayıt da eklenmez.
    const kayit = await transaction(async (tx) => {
      const inserted = await tx.query(
        `INSERT INTO saha_kayitlari
          (saha_elemani_id, saha_elemani_username, isim, soyisim, notlar, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW(6), NOW(6))
        RETURNING ${KAYIT_COLUMNS}`,
        [user.id, user.username, isim, soyisim, notlar || null]
      );
      await attachPhotosToNewRecord(tx, user.id, inserted.rows[0].id, ids);
      return inserted.rows[0];
    });

    res.status(201).json({
      message: 'Kayıt başarıyla eklendi',
      kayit: { ...kayit, has_photos: ids.length > 0 }
    });
  } catch (error) {
    sendError(res, error, 'Kayıt ekleme hatası:');
  }
});

// Kendi Kayıtlarını Getir (Saha Elemanı) - paginated + search + today
router.get('/kayitlar', authenticateToken, requireSaha, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const { search, startDate, endDate, today, page, limit } = req.query;

    if (invalidDateParam(startDate, endDate)) {
      res.status(400).json({ message: 'Geçersiz tarih' });
      return;
    }

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string) || 50));
    const offset = (pageNum - 1) * limitNum;

    // Ortak WHERE parçası
    let whereSql = ' WHERE saha_elemani_id = $1';
    const params: any[] = [user.id];
    let paramIndex = 2;

    // Arama filtresi - sadece mevcut kolonlarda ara (isim, soyisim, notlar)
    if (search) {
      const searchLower = (search as string).toLocaleLowerCase('tr-TR');
      whereSql += ` AND (
        LOWER(isim) LIKE $${paramIndex} OR
        LOWER(soyisim) LIKE $${paramIndex} OR
        LOWER(COALESCE(notlar, '')) LIKE $${paramIndex} OR
        LOWER(CONCAT(isim, ' ', soyisim)) LIKE $${paramIndex}
      )`;
      params.push(`%${searchLower}%`);
      paramIndex++;
    }

    // Bugün filtresi (saha elemanının kendi yerel gününe göre değil, server gününe göre)
    if (today === 'true' || today === '1') {
      whereSql += ` AND created_at >= CURRENT_DATE AND created_at < CURRENT_DATE + INTERVAL 1 DAY`;
    }

    if (startDate) {
      whereSql += ` AND created_at >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      whereSql += ` AND created_at <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    const countQuery = `SELECT COUNT(*) as total FROM saha_kayitlari${whereSql}`;
    const dataQuery = `
      SELECT id, saha_elemani_id, saha_elemani_username, isim, soyisim, notlar, created_at, updated_at,
             ${photoColumns('saha_kayitlari')}
      FROM saha_kayitlari${whereSql}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const dataParams = [...params, limitNum, offset];

    // Paralel çalıştır: count + data + stats. Birini bekletmek diğerini bekletmesin.
    const [countResult, records, statsResult] = await Promise.all([
      query(countQuery, params),
      query(dataQuery, dataParams),
      query(
        `SELECT
           COUNT(*) AS toplam,
           COUNT(CASE WHEN created_at >= CURRENT_DATE AND created_at < CURRENT_DATE + INTERVAL 1 DAY THEN 1 END) AS bugun
         FROM saha_kayitlari
         WHERE saha_elemani_id = $1`,
        [user.id]
      ),
    ]);

    const total = parseInt(countResult.rows[0].total);

    res.json({
      data: await Promise.all(records.rows.map(withPhotoInfo)),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1
      },
      stats: {
        toplam: Number(statsResult.rows[0].toplam),
        bugun: Number(statsResult.rows[0].bugun)
      }
    });
  } catch (error) {
    logger.error('Kayıtları getirme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Tek Kayıt Getir
router.get('/kayit/:id', authenticateToken, requireSaha, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const record = await query(
      'SELECT * FROM saha_kayitlari WHERE id = $1 AND saha_elemani_id = $2',
      [id, user.id]
    );

    if (record.rows.length === 0) {
      res.status(404).json({ message: 'Kayıt bulunamadı' });
      return;
    }

    res.json(record.rows[0]);
  } catch (error) {
    logger.error('Kayıt getirme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Kayıt Güncelle
//
// foto_ids kaydın YENİ fotoğraf listesidir (sırasıyla): kayıtta kalan fotoğrafların ve
// yeni yüklenenlerin numaraları. Alan hiç gönderilmezse fotoğraflara dokunulmaz;
// boş dizi bütün fotoğrafları kaldırır.
router.put('/kayit/:id', authenticateToken, requireSaha, async (req: Request, res: Response): Promise<void> => {
  try {
    const kayitId = Number(req.params.id);
    const { isim, soyisim, notlar } = req.body;
    const user = req.user!;

    if (!isim || !soyisim) {
      res.status(400).json({ message: 'İsim ve soyisim zorunludur' });
      return;
    }
    if (hasLegacyPhotoPayload(req.body)) {
      res.status(400).json({ message: LEGACY_PAYLOAD_MESSAGE });
      return;
    }
    const photoIds = parsePhotoIds(req.body.foto_ids);
    if (!photoIds.ok) {
      res.status(400).json({ message: photoIds.message });
      return;
    }
    const ids = photoIds.value;

    if (ids) {
      await assertUploaded(user.id, await findUnattachedPhotoIds(kayitId, ids));
    }

    const kayit = await transaction(async (tx) => {
      // Satır kilidi: aynı kayda gelen iki güncelleme sırayla çalışır.
      const locked = await tx.query(
        'SELECT id FROM saha_kayitlari WHERE id = $1 AND saha_elemani_id = $2 FOR UPDATE',
        [kayitId, user.id]
      );
      if (locked.rows.length === 0) return null;

      // Fotoğraf listesi gönderildiyse eski biçimdeki (foto_data) fotoğraflar da kalkar:
      // arayüz kalanları R2'ye yükleyip numaralarını listeye eklemiştir.
      await tx.query(
        `UPDATE saha_kayitlari
         SET isim = $1, soyisim = $2, notlar = $3, updated_at = NOW(6)${ids ? ', foto_data = NULL' : ''}
         WHERE id = $4`,
        [isim, soyisim, notlar, kayitId]
      );
      if (ids) await replaceRecordPhotos(tx, user.id, kayitId, ids);

      const updated = await tx.query(
        `SELECT ${KAYIT_COLUMNS}, ${photoColumns('saha_kayitlari')} FROM saha_kayitlari WHERE id = $1`,
        [kayitId]
      );
      return updated.rows[0];
    });

    if (!kayit) {
      res.status(404).json({ message: 'Kayıt bulunamadı' });
      return;
    }
    sweepPhotoStorageInBackground();

    res.json({
      message: 'Kayıt başarıyla güncellendi',
      kayit: await withPhotoInfo(kayit)
    });
  } catch (error) {
    sendError(res, error, 'Kayıt güncelleme hatası:');
  }
});

// Kayıt Sil
router.delete('/kayit/:id', authenticateToken, requireSaha, async (req: Request, res: Response): Promise<void> => {
  try {
    const kayitId = Number(req.params.id);
    const user = req.user!;

    // Fotoğraf satırları FK ile birlikte silinir; R2'deki dosyaların adresleri aynı
    // transaction'da silme kuyruğuna yazılır ve dosyalar işlemden sonra silinir.
    await transaction(async (tx) => {
      const locked = await tx.query(
        'SELECT id FROM saha_kayitlari WHERE id = $1 AND saha_elemani_id = $2 FOR UPDATE',
        [kayitId, user.id]
      );
      if (locked.rows.length === 0) return;
      await queueRecordPhotos(tx, kayitId);
      await tx.query('DELETE FROM saha_kayitlari WHERE id = $1', [kayitId]);
    });
    sweepPhotoStorageInBackground();

    res.json({ message: 'Kayıt başarıyla silindi' });
  } catch (error) {
    logger.error('Kayıt silme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Tek Kayıdın Sadece İlk Fotoğrafını Getir (Önizleme - liste için)
router.get('/kayit-thumbnail/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user!;
    if (!canViewPhotos(user.role)) {
      res.status(403).json({ message: 'Bu işlem için yetkiniz yok' });
      return;
    }

    const kayit = await query(
      `SELECT saha_elemani_id, ${photoColumns('saha_kayitlari')} FROM saha_kayitlari WHERE id = $1`,
      [id]
    );
    if (kayit.rows.length === 0 || !ownsOrMayViewAll(user, kayit.rows[0])) {
      res.status(404).json({ message: 'Kayıt veya fotoğraf bulunamadı' });
      return;
    }

    // R2'deki fotoğraf: imzalı önizleme adresi.
    if (kayit.rows[0].foto_thumb_key) {
      const preview = await signPreviewUrl(kayit.rows[0].foto_thumb_key);
      if (!preview) throw new PhotoError(503, 'Fotoğraf deposu yapılandırılmamış');
      res.json({ foto_preview: preview });
      return;
    }

    // Eski biçim: fotoğraflar veritabanında (foto_data) base64 olarak duruyor.
    const record = await query(
      'SELECT foto_data FROM saha_kayitlari WHERE id = $1',
      [id]
    );

    if (record.rows.length === 0 || !record.rows[0].foto_data) {
      res.status(404).json({ message: 'Kayıt veya fotoğraf bulunamadı' });
      return;
    }

    // Yalnızca ilk fotoğrafın data URL'ini döndür (bandwidth tasarrufu için)
    try {
      const firstPhoto = firstLegacyPhoto(record.rows[0].foto_data);

      if (!firstPhoto) {
        res.status(404).json({ message: 'Fotoğraf bulunamadı' });
        return;
      }
      res.json({ foto_preview: firstPhoto });
    } catch {
      res.status(500).json({ message: 'Fotoğraf verisi okunamadı' });
    }
  } catch (error) {
    sendError(res, error, 'Thumbnail getirme hatası:');
  }
});

// Tek Kayıdın Fotoğraflarını Getir
//
// Yanıt: { fotolar, foto_data }. "fotolar" R2'deki fotoğraflardır (imzalı görüntüleme
// ve indirme adresleriyle). Kaydın fotoğrafları henüz R2'ye taşınmamışsa "fotolar" boş,
// "foto_data" eski biçimdeki base64 yüktür.
router.get('/kayit-photos/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user!;
    if (!canViewPhotos(user.role)) {
      res.status(403).json({ message: 'Bu işlem için yetkiniz yok' });
      return;
    }

    const kayit = await query(
      'SELECT id, saha_elemani_id, isim, soyisim, created_at FROM saha_kayitlari WHERE id = $1',
      [id]
    );
    if (kayit.rows.length === 0 || !ownsOrMayViewAll(user, kayit.rows[0])) {
      res.status(404).json({ message: 'Kayıt bulunamadı' });
      return;
    }

    const fotolar = await listRecordPhotos(kayit.rows[0]);
    let fotoData: string | null = null;
    if (fotolar.length === 0) {
      const legacy = await query('SELECT foto_data FROM saha_kayitlari WHERE id = $1', [id]);
      fotoData = legacy.rows[0]?.foto_data ?? null;
    }

    res.json({ fotolar, foto_data: fotoData });
  } catch (error) {
    sendError(res, error, 'Fotoğraf getirme hatası:');
  }
});

// Tüm Saha Kayıtlarını Getir (Admin için) - foto_data hariç (performans)
router.get('/all-kayitlar', authenticateToken, requireStaff, async (req: Request, res: Response): Promise<void> => {
  try {
    const { search, startDate, endDate, sahaElemaniId, today, page, limit } = req.query;

    if (invalidDateParam(startDate, endDate)) {
      res.status(400).json({ message: 'Geçersiz tarih' });
      return;
    }

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string) || 50));
    const offset = (pageNum - 1) * limitNum;

    // COUNT için JOIN'e gerek yok (se kolonu filtre/ORDER'da kullanılmıyor).
    // JOIN'siz COUNT çok daha hızlı çalışır.
    let countQuery = `SELECT COUNT(*) as total FROM saha_kayitlari sk WHERE 1=1`;

    let sql = `
      SELECT sk.id, sk.saha_elemani_id, sk.saha_elemani_username, sk.isim, sk.soyisim, 
             sk.notlar, sk.created_at, sk.updated_at,
             ${photoColumns('sk')},
             se.ad_soyad as saha_elemani_ad_soyad 
      FROM saha_kayitlari sk
      LEFT JOIN saha_elemanlari se ON sk.saha_elemani_id = se.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    // Saha elemanı filtresi
    if (sahaElemaniId) {
      const filter = ` AND sk.saha_elemani_id = $${paramIndex}`;
      sql += filter;
      countQuery += filter;
      params.push(sahaElemaniId);
      paramIndex++;
    }

    // Arama filtresi - isim, soyisim, notlar alanlarında ara (case-insensitive with Turkish support)
    if (search) {
      const searchLower = (search as string).toLocaleLowerCase('tr-TR');
      const filter = ` AND (
        LOWER(sk.isim) LIKE $${paramIndex} OR 
        LOWER(sk.soyisim) LIKE $${paramIndex} OR 
        LOWER(sk.notlar) LIKE $${paramIndex} OR
        LOWER(CONCAT(sk.isim, ' ', sk.soyisim)) LIKE $${paramIndex}
      )`;
      sql += filter;
      countQuery += filter;
      params.push(`%${searchLower}%`);
      paramIndex++;
    }

    // Tarih filtreleri
    if (startDate) {
      const filter = ` AND sk.created_at >= $${paramIndex}`;
      sql += filter;
      countQuery += filter;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      const filter = ` AND sk.created_at <= $${paramIndex}`;
      sql += filter;
      countQuery += filter;
      params.push(endDate);
      paramIndex++;
    }

    // Bugün filtresi
    if (today === 'true' || today === '1') {
      const filter = ` AND sk.created_at >= CURRENT_DATE AND sk.created_at < CURRENT_DATE + INTERVAL 1 DAY`;
      sql += filter;
      countQuery += filter;
    }

    sql += ` ORDER BY sk.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;

    const dataParams = [...params, limitNum, offset];

    // Paralel çalıştır: count + data + global stats
    const [countResult, records, statsResult] = await Promise.all([
      query(countQuery, params),
      query(sql, dataParams),
      query(
        `SELECT
           COUNT(*) AS toplam,
           COUNT(CASE WHEN created_at >= CURRENT_DATE AND created_at < CURRENT_DATE + INTERVAL 1 DAY THEN 1 END) AS bugun
         FROM saha_kayitlari`
      ),
    ]);

    const total = parseInt(countResult.rows[0].total);

    res.json({
      data: await Promise.all(records.rows.map(withPhotoInfo)),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      },
      stats: {
        toplam: Number(statsResult.rows[0].toplam),
        bugun: Number(statsResult.rows[0].bugun)
      }
    });
  } catch (error) {
    logger.error('Tüm saha kayıtlarını getirme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Saha Elemanının Kayıtlarını Getir (Admin için)
router.get('/user-kayitlar/:username', authenticateToken, requireStaff, async (req: Request, res: Response): Promise<void> => {
  try {
    const { username } = req.params;

    const records = await query(
      `SELECT id, saha_elemani_id, saha_elemani_username, isim, soyisim, notlar, created_at, updated_at,
              ${photoColumns('saha_kayitlari')}
       FROM saha_kayitlari  
       WHERE saha_elemani_username = $1 
       ORDER BY created_at DESC`,
      [username]
    );

    res.json(await Promise.all(records.rows.map(withPhotoInfo)));
  } catch (error) {
    logger.error('Kullanıcı saha kayıtları getirme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

export default router;