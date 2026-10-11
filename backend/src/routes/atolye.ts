import express, { Request, Response } from 'express';
import { query, updateReturning } from '../db';
import { toSqlTimestamp } from '../utils/sqlParams';
import auth from '../middleware/auth';
import { Atolye, AtolyeCreateDto, AtolyeUpdateDto } from '../types';
import { SOCKET_EVENTS } from '../constants/socketEvents';
import logger from '../utils/logger';
import requireIntegerParam from '../middleware/requireIntegerParam';
import { MAX_ATOLYE_ADET, parseAdet } from '../utils/atolyeRules';

const router = express.Router();
router.param('id', requireIntegerParam);

// === SIMPLE IN-MEMORY CACHE ===
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache: {
  statusCounts?: CacheEntry<any>;
  nextId?: CacheEntry<number>;
} = {};

const CACHE_TTL = 10000; // 10 saniye - daha agresif cache

function isCacheValid<T>(entry: CacheEntry<T> | undefined): boolean {
  if (!entry) return false;
  return Date.now() - entry.timestamp < CACHE_TTL;
}

function invalidateCache() {
  cache.statusCounts = undefined;
  cache.nextId = undefined;
}
// === END CACHE ===

// GET atolye records with pagination
router.get('/', auth, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const noPagination = req.query.all === 'true';

    if (noPagination) {
      const result = await query<Atolye>(
        'SELECT * FROM atolye ORDER BY created_at DESC'
      );
      return res.json(result.rows);
    }

    const countResult = await query('SELECT COUNT(*) AS count FROM atolye');
    const totalCount = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / limit);

    const result = await query<Atolye>(
      'SELECT * FROM atolye ORDER BY id DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );

    return res.json({
      data: result.rows,
      pagination: { page, limit, totalCount, totalPages, hasNext: page < totalPages, hasPrev: page > 1 }
    });
  } catch (error) {
    logger.error('Error fetching atolye records:', error);
    return res.status(500).json({ error: 'Atölye kayıtları getirilirken hata oluştu' });
  }
});

// GET next available ID - CACHED
router.get('/next-id', auth, async (_req: Request, res: Response) => {
  try {
    if (isCacheValid(cache.nextId)) {
      return res.json({ nextId: cache.nextId!.data });
    }
    const result = await query('SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM atolye');
    // MAX(id) + 1 MySQL'de BIGINT (metin) döner; PostgreSQL'deki gibi sayı olarak verilir.
    const nextId = Number(result.rows[0].next_id);
    cache.nextId = { data: nextId, timestamp: Date.now() };
    return res.json({ nextId });
  } catch (error) {
    logger.error('Error getting next ID:', error);
    return res.status(500).json({ error: 'Sıra numarası alınamadı' });
  }
});

// GET status counts - CACHED
router.get('/status-counts', auth, async (_req: Request, res: Response) => {
  try {
    if (isCacheValid(cache.statusCounts)) {
      return res.json(cache.statusCounts!.data);
    }
    const result = await query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN teslim_durumu = 'beklemede' THEN 1 END) as beklemede,
        COUNT(CASE WHEN teslim_durumu = 'teslim_edildi' THEN 1 END) as teslim_edildi,
        COUNT(CASE WHEN teslim_durumu = 'siparis_verildi' THEN 1 END) as siparis_verildi,
        COUNT(CASE WHEN teslim_durumu = 'yapildi' THEN 1 END) as yapildi,
        COUNT(CASE WHEN teslim_durumu = 'fabrika_gitti' THEN 1 END) as fabrika_gitti,
        COUNT(CASE WHEN teslim_durumu = 'odeme_bekliyor' THEN 1 END) as odeme_bekliyor
      FROM atolye
    `);
    cache.statusCounts = { data: result.rows[0], timestamp: Date.now() };
    return res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error getting status counts:', error);
    return res.status(500).json({ error: 'Durum sayıları alınamadı' });
  }
});

// GET single atolye record
router.get('/:id', auth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query<Atolye>(
      'SELECT * FROM atolye WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Kayıt bulunamadı' });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error fetching atolye record:', error);
    return res.status(500).json({ error: 'Kayıt getirilirken hata oluştu' });
  }
});

// POST new atolye record
router.post('/', auth, async (req: Request, res: Response) => {
  try {
    const createDto: AtolyeCreateDto = req.body;
    const username = req.user?.username;

    // Aynı üründen birden çok geldiyse "adet" kadar ayrı kayıt açılır (her birinin sıra
    // numarası farklıdır).
    const adet = parseAdet(req.body.adet);
    if (adet === null) {
      return res.status(400).json({ error: `Adet 1 ile ${MAX_ATOLYE_ADET} arasında bir tam sayı olmalıdır` });
    }

    // Tarihi sadece YYYY-MM-DD formatında al (saat kısmını at)
    let kayitTarihi = null;
    if (createDto.kayit_tarihi) {
      kayitTarihi = String(createDto.kayit_tarihi).substring(0, 10);
    }
    
    console.log('=== BACKEND POST ===');
    console.log('Frontend\'den gelen kayit_tarihi:', createDto.kayit_tarihi);
    console.log('Kullanılacak kayitTarihi (sadece tarih):', kayitTarihi);

    const result = await query<Atolye>(
      `INSERT INTO atolye (
        bayi_adi, musteri_ad_soyad, tel_no, marka, kod, seri_no, sikayet, ozel_not, note_no, kayit_tarihi, created_by
      ) VALUES ${Array(adet).fill('($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)').join(', ')}
      RETURNING *`,
      [
        createDto.bayi_adi || null,
        createDto.musteri_ad_soyad || null,
        createDto.tel_no || null,
        createDto.marka || null,
        createDto.kod || null,
        createDto.seri_no || null,
        createDto.sikayet || null,
        createDto.ozel_not || null,
        createDto.note_no || null,
        kayitTarihi,
        username || null
      ]
    );

    console.log('Database\'den dönen kayit_tarihi:', result.rows[0].kayit_tarihi);
    console.log('===================');

    // Tek INSERT cümlesi: kayıtların ya hepsi açılır ya hiçbiri; numaraları ardışıktır.
    const records = [...result.rows].sort((a, b) => a.id - b.id);
    const newRecord = records[0];

    // Cache'i invalidate et
    invalidateCache();

    // Socket.IO ile tüm bağlı kullanıcılara bildir
    const io = req.app.get('io');
    if (io) {
      for (const record of records) io.emit(SOCKET_EVENTS.YENI_ATOLYE, record);
    }

    // Tek kayıtta yanıt eskisiyle aynıdır; çoklu girişte açılan kayıt sayısı eklenir.
    return res.status(201).json(adet === 1 ? newRecord : { ...newRecord, eklenen_adet: records.length });
  } catch (error) {
    logger.error('Error creating atolye record:', error);
    return res.status(500).json({ error: 'Kayıt oluşturulurken hata oluştu' });
  }
});

// PUT update atolye record
router.put('/:id', auth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateDto: AtolyeUpdateDto = req.body;

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramCounter = 1;

    if (updateDto.teslim_durumu !== undefined) {
      updates.push(`teslim_durumu = $${paramCounter++}`);
      values.push(updateDto.teslim_durumu);
    }
    if (updateDto.bayi_adi !== undefined) {
      updates.push(`bayi_adi = $${paramCounter++}`);
      values.push(updateDto.bayi_adi);
    }
    if (updateDto.musteri_ad_soyad !== undefined) {
      updates.push(`musteri_ad_soyad = $${paramCounter++}`);
      values.push(updateDto.musteri_ad_soyad);
    }
    if (updateDto.tel_no !== undefined) {
      updates.push(`tel_no = $${paramCounter++}`);
      values.push(updateDto.tel_no);
    }
    if (updateDto.marka !== undefined) {
      updates.push(`marka = $${paramCounter++}`);
      values.push(updateDto.marka);
    }
    if (updateDto.kod !== undefined) {
      updates.push(`kod = $${paramCounter++}`);
      values.push(updateDto.kod);
    }
    if (updateDto.seri_no !== undefined) {
      updates.push(`seri_no = $${paramCounter++}`);
      values.push(updateDto.seri_no);
    }
    if (updateDto.sikayet !== undefined) {
      updates.push(`sikayet = $${paramCounter++}`);
      values.push(updateDto.sikayet);
    }
    if (updateDto.ozel_not !== undefined) {
      updates.push(`ozel_not = $${paramCounter++}`);
      values.push(updateDto.ozel_not);
    }
    if (updateDto.yapilan_islem !== undefined) {
      updates.push(`yapilan_islem = $${paramCounter++}`);
      values.push(updateDto.yapilan_islem);
    }
    if (updateDto.note_no !== undefined) {
      updates.push(`note_no = $${paramCounter++}`);
      values.push(updateDto.note_no);
    }
    if (updateDto.ucret !== undefined) {
      updates.push(`ucret = $${paramCounter++}`);
      values.push(updateDto.ucret);
    }
    if (updateDto.yapilma_tarihi !== undefined) {
      updates.push(`yapilma_tarihi = $${paramCounter++}`);
      values.push(toSqlTimestamp(updateDto.yapilma_tarihi));
    }
    if (updateDto.kayit_tarihi !== undefined) {
      updates.push(`kayit_tarihi = $${paramCounter++}`);
      // Tarihi sadece YYYY-MM-DD formatında al
      const kayitTarihiOnly = String(updateDto.kayit_tarihi).substring(0, 10);
      values.push(kayitTarihiOnly);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Güncellenecek alan belirtilmedi' });
    }

    // Always update updated_at
    updates.push(`updated_at = CURRENT_TIMESTAMP(6)`);
    values.push(id);

    const sql = `
      UPDATE atolye 
      SET ${updates.join(', ')}
      WHERE id = $${paramCounter}
      RETURNING *
    `;

    const result = await updateReturning<Atolye>(sql, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Kayıt bulunamadı' });
    }

    const updatedRecord = result.rows[0];

    // Cache'i invalidate et
    invalidateCache();

    // Socket.IO ile tüm bağlı kullanıcılara bildir
    const io = req.app.get('io');
    if (io) {
      io.emit(SOCKET_EVENTS.ATOLYE_GUNCELLENDI, updatedRecord);
    }

    return res.json(updatedRecord);
  } catch (error) {
    logger.error('Error updating atolye record:', error);
    return res.status(500).json({ error: 'Kayıt güncellenirken hata oluştu' });
  }
});

// DELETE atolye record
router.delete('/:id', auth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM atolye WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Kayıt bulunamadı' });
    }

    // Cache'i invalidate et
    invalidateCache();

    // Socket.IO ile tüm bağlı kullanıcılara bildir
    const io = req.app.get('io');
    if (io) {
      io.emit(SOCKET_EVENTS.ATOLYE_SILINDI, parseInt(id));
    }

    return res.json({ message: 'Kayıt başarıyla silindi' });
  } catch (error) {
    logger.error('Error deleting atolye record:', error);
    return res.status(500).json({ error: 'Kayıt silinirken hata oluştu' });
  }
});

export default router;