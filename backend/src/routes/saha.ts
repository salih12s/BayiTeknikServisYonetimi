import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, updateReturning } from '../db';
import authenticateToken from '../middleware/auth';
import logger from '../utils/logger';
import requireIntegerParam from '../middleware/requireIntegerParam';

const router = express.Router();
router.param('id', requireIntegerParam);

// MySQL "(foto_data IS NOT NULL)" ifadesini 1/0 döndürür; API eskisi gibi true/false verir.
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

function withPhotoFlag<T extends { has_photos?: unknown }>(row: T): T {
  return { ...row, has_photos: Boolean(Number(row.has_photos)) };
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
      process.env.JWT_SECRET || 'secret',
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
router.post('/create', authenticateToken, async (req: Request, res: Response): Promise<void> => {
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
router.get('/users', authenticateToken, async (_req: Request, res: Response): Promise<void> => {
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
router.patch('/users/:id/toggle', authenticateToken, async (req: Request, res: Response): Promise<void> => {
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
router.delete('/users/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    await query('DELETE FROM saha_elemanlari WHERE id = $1', [id]);

    res.json({ message: 'Saha elemanı başarıyla silindi' });
  } catch (error) {
    logger.error('Saha elemanı silme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Yeni Kayıt Ekle (Saha Elemanı)
router.post('/kayit', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { isim, soyisim, foto_data, notlar } = req.body;
    const user = req.user!;

    if (!isim || !soyisim) {
      res.status(400).json({ message: 'İsim ve soyisim zorunludur' });
      return;
    }

    const newRecord = await query(
      `INSERT INTO saha_kayitlari 
        (saha_elemani_id, saha_elemani_username, isim, soyisim, foto_data, notlar, created_at, updated_at) 
      VALUES ($1, $2, $3, $4, $5, $6, NOW(6), NOW(6)) 
      RETURNING *`,
      [user.id, user.username, isim, soyisim, foto_data || null, notlar || null]
    );

    res.status(201).json({
      message: 'Kayıt başarıyla eklendi',
      kayit: newRecord.rows[0]
    });
  } catch (error) {
    logger.error('Kayıt ekleme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Kendi Kayıtlarını Getir (Saha Elemanı) - paginated + search + today
router.get('/kayitlar', authenticateToken, async (req: Request, res: Response): Promise<void> => {
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
             (foto_data IS NOT NULL) as has_photos
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
      data: records.rows.map(withPhotoFlag),
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
router.get('/kayit/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
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
router.put('/kayit/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { isim, soyisim, foto_data, notlar } = req.body;
    const user = req.user!;

    const result = await updateReturning(
      `UPDATE saha_kayitlari 
       SET isim = $1, soyisim = $2, foto_data = $3, notlar = $4, updated_at = NOW(6)
       WHERE id = $5 AND saha_elemani_id = $6
       RETURNING *`,
      [isim, soyisim, foto_data, notlar, id, user.id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Kayıt bulunamadı' });
      return;
    }

    res.json({
      message: 'Kayıt başarıyla güncellendi',
      kayit: result.rows[0]
    });
  } catch (error) {
    logger.error('Kayıt güncelleme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Kayıt Sil
router.delete('/kayit/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user!;

    await query(
      'DELETE FROM saha_kayitlari WHERE id = $1 AND saha_elemani_id = $2',
      [id, user.id]
    );

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
    const record = await query(
      'SELECT foto_data FROM saha_kayitlari WHERE id = $1',
      [id]
    );

    if (record.rows.length === 0 || !record.rows[0].foto_data) {
      res.status(404).json({ message: 'Kayıt veya fotoğraf bulunamadı' });
      return;
    }

    // foto_data JSON string olarak saklanıyor. İki biçim desteklenir:
    //   ESKİ: ["data:image/...", ...]
    //   YENİ: [{ name: "IMG_2034.jpg", data: "data:image/..." }, ...]
    // Yalnızca ilk fotoğrafın data URL'ini döndür (bandwidth tasarrufu için)
    try {
      const parsed = JSON.parse(record.rows[0].foto_data);
      const first = Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : null;
      const firstPhoto =
        typeof first === 'string'
          ? first
          : first && typeof first === 'object' && typeof first.data === 'string'
            ? first.data
            : null;

      if (!firstPhoto) {
        res.status(404).json({ message: 'Fotoğraf bulunamadı' });
        return;
      }
      res.json({ foto_preview: firstPhoto });
    } catch {
      res.status(500).json({ message: 'Fotoğraf verisi okunamadı' });
    }
  } catch (error) {
    logger.error('Thumbnail getirme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Tek Kayıdın Fotoğraflarını Getir
router.get('/kayit-photos/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const record = await query(
      'SELECT foto_data FROM saha_kayitlari WHERE id = $1',
      [id]
    );

    if (record.rows.length === 0) {
      res.status(404).json({ message: 'Kayıt bulunamadı' });
      return;
    }

    res.json({ foto_data: record.rows[0].foto_data });
  } catch (error) {
    logger.error('Fotoğraf getirme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Tüm Saha Kayıtlarını Getir (Admin için) - foto_data hariç (performans)
router.get('/all-kayitlar', authenticateToken, async (req: Request, res: Response): Promise<void> => {
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
             (sk.foto_data IS NOT NULL) as has_photos,
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
      data: records.rows.map(withPhotoFlag),
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
router.get('/user-kayitlar/:username', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { username } = req.params;

    const records = await query(
      `SELECT id, saha_elemani_id, saha_elemani_username, isim, soyisim, notlar, created_at, updated_at,
              (foto_data IS NOT NULL) as has_photos
       FROM saha_kayitlari 
       WHERE saha_elemani_username = $1 
       ORDER BY created_at DESC`,
      [username]
    );

    res.json(records.rows.map(withPhotoFlag));
  } catch (error) {
    logger.error('Kullanıcı saha kayıtları getirme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

export default router;