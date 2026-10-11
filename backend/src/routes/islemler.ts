import express, { Request, Response } from 'express';
import { query, updateReturning } from '../db';
import authMiddleware from '../middleware/auth';
import logger from '../utils/logger';
import { IslemCreateDto } from '../types';
import { SOCKET_EVENTS } from '../constants/socketEvents';
import requireIntegerParam from '../middleware/requireIntegerParam';

const router = express.Router();
router.param('id', requireIntegerParam);

// === STATS CACHE ===
// /stats sorgusu 7 adet COUNT(*) FILTER içerir; index kullanamaz ve tabloyu
// baştan sona tarar. Her socket olayında BÜTÜN bağlı istemciler bu endpoint'i
// çağırdığı için tek bir tıklama N adet full-table aggregate'e dönüşüyordu.
// Kısa ömürlü cache + yazma sonrası invalidation ile bu tamamen ortadan kalkar.
interface StatsCacheEntry {
  data: any;
  timestamp: number;
}
let statsCache: StatsCacheEntry | undefined;
let statsInFlight: Promise<any> | null = null;
// Sorgu uçarken bir yazma gelirse, dönen (bayatlamış) sonucun cache'e
// yazılmasını engellemek için sürüm sayacı.
let statsGeneration = 0;
const STATS_CACHE_TTL = 15000; // 15 sn

function invalidateStatsCache(): void {
  statsCache = undefined;
  statsGeneration++;
}

async function computeStats(): Promise<any> {
  const result = await query(`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN is_durumu = 'acik' THEN 1 END) as acik,
      COUNT(CASE WHEN is_durumu = 'parca_bekliyor' THEN 1 END) as parca_bekliyor,
      COUNT(CASE WHEN is_durumu = 'tamamlandi' THEN 1 END) as tamamlandi,
      COUNT(CASE WHEN is_durumu = 'iptal' THEN 1 END) as iptal,
      COUNT(CASE WHEN full_tarih >= CURRENT_DATE AND full_tarih < CURRENT_DATE + INTERVAL 1 DAY THEN 1 END) as bugun,
      COUNT(CASE WHEN (yazdirildi IS NULL OR yazdirildi = false) THEN 1 END) as yazdirilmamis
    FROM islemler
  `);
  return result.rows[0];
}
// === END STATS CACHE ===

// İstatistikler endpoint - hafif, sadece sayılar döner
router.get('/stats', authMiddleware, async (_req: Request, res: Response): Promise<void> => {
  try {
    if (statsCache && Date.now() - statsCache.timestamp < STATS_CACHE_TTL) {
      res.json(statsCache.data);
      return;
    }

    // Aynı anda gelen isteklerin hepsi tek sorguyu paylaşsın (thundering herd)
    if (!statsInFlight) {
      const generationAtStart = statsGeneration;
      statsInFlight = computeStats()
        .then((data) => {
          // Sorgu sürerken yazma olduysa sonucu cache'leme; bir sonraki
          // istek taze sorgu atsın.
          if (generationAtStart === statsGeneration) {
            statsCache = { data, timestamp: Date.now() };
          }
          return data;
        })
        .finally(() => {
          statsInFlight = null;
        });
    }

    res.json(await statsInFlight);
  } catch (error) {
    logger.error('İstatistik hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Tüm işlemleri getir (filtreleme ile)
router.get('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      ad_soyad,
      ilce,
      mahalle,
      cadde,
      sokak,
      kapi_no,
      apartman_site,
      blok_no,
      daire_no,
      sabit_tel,
      cep_tel,
      urun,
      marka,
      sikayet,
      teknisyen_ismi,
      yapilan_islem,
      tutar,
      is_durumu,
      today,
      yazdirilmamis,
      ay,
      yil,
      page,
      limit: limitParam
    } = req.query;

    let whereClause = ' WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (ad_soyad) {
      whereClause += ` AND LOWER(ad_soyad) LIKE LOWER($${paramIndex})`;
      params.push(`%${ad_soyad}%`);
      paramIndex++;
    }

    if (ilce) {
      whereClause += ` AND LOWER(ilce) LIKE LOWER($${paramIndex})`;
      params.push(`%${ilce}%`);
      paramIndex++;
    }

    if (mahalle) {
      whereClause += ` AND LOWER(mahalle) LIKE LOWER($${paramIndex})`;
      params.push(`%${mahalle}%`);
      paramIndex++;
    }

    if (cadde) {
      whereClause += ` AND LOWER(cadde) LIKE LOWER($${paramIndex})`;
      params.push(`%${cadde}%`);
      paramIndex++;
    }

    if (sokak) {
      whereClause += ` AND LOWER(sokak) LIKE LOWER($${paramIndex})`;
      params.push(`%${sokak}%`);
      paramIndex++;
    }

    if (kapi_no) {
      whereClause += ` AND LOWER(kapi_no) LIKE LOWER($${paramIndex})`;
      params.push(`%${kapi_no}%`);
      paramIndex++;
    }

    if (apartman_site) {
      whereClause += ` AND LOWER(apartman_site) LIKE LOWER($${paramIndex})`;
      params.push(`%${apartman_site}%`);
      paramIndex++;
    }

    if (blok_no) {
      whereClause += ` AND LOWER(blok_no) LIKE LOWER($${paramIndex})`;
      params.push(`%${blok_no}%`);
      paramIndex++;
    }

    if (daire_no) {
      whereClause += ` AND LOWER(daire_no) LIKE LOWER($${paramIndex})`;
      params.push(`%${daire_no}%`);
      paramIndex++;
    }

    if (sabit_tel) {
      whereClause += ` AND LOWER(sabit_tel) LIKE LOWER($${paramIndex})`;
      params.push(`%${sabit_tel}%`);
      paramIndex++;
    }

    if (cep_tel) {
      whereClause += ` AND (LOWER(cep_tel) LIKE LOWER($${paramIndex}) OR LOWER(yedek_tel) LIKE LOWER($${paramIndex + 1}))`;
      params.push(`%${cep_tel}%`);
      params.push(`%${cep_tel}%`);
      paramIndex += 2;
    }

    if (urun) {
      whereClause += ` AND LOWER(urun) LIKE LOWER($${paramIndex})`;
      params.push(`%${urun}%`);
      paramIndex++;
    }

    if (marka) {
      whereClause += ` AND LOWER(marka) LIKE LOWER($${paramIndex})`;
      params.push(`%${marka}%`);
      paramIndex++;
    }

    if (sikayet) {
      whereClause += ` AND LOWER(sikayet) LIKE LOWER($${paramIndex})`;
      params.push(`%${sikayet}%`);
      paramIndex++;
    }

    if (teknisyen_ismi) {
      whereClause += ` AND LOWER(teknisyen_ismi) LIKE LOWER($${paramIndex})`;
      params.push(`%${teknisyen_ismi}%`);
      paramIndex++;
    }

    if (yapilan_islem) {
      whereClause += ` AND LOWER(yapilan_islem) LIKE LOWER($${paramIndex})`;
      params.push(`%${yapilan_islem}%`);
      paramIndex++;
    }

    if (tutar) {
      whereClause += ` AND LOWER(CAST(tutar AS CHAR)) LIKE LOWER($${paramIndex})`;
      params.push(`%${tutar}%`);
      paramIndex++;
    }

    if (is_durumu) {
      whereClause += ` AND is_durumu = $${paramIndex}`;
      params.push(is_durumu);
      paramIndex++;
    }

    if (today === 'true') {
      whereClause += ` AND full_tarih >= CURRENT_DATE AND full_tarih < CURRENT_DATE + INTERVAL 1 DAY`;
    }

    if (yazdirilmamis === 'true') {
      whereClause += ` AND (yazdirildi IS NULL OR yazdirildi = false)`;
    }

    if (ay) {
      whereClause += ` AND EXTRACT(MONTH FROM full_tarih) = $${paramIndex}`;
      params.push(parseInt(ay as string));
      paramIndex++;
    }

    if (yil) {
      whereClause += ` AND EXTRACT(YEAR FROM full_tarih) = $${paramIndex}`;
      params.push(parseInt(yil as string));
      paramIndex++;
    }

    // Pagination opsiyonel - page/limit gönderilmezse tüm veriyi döndür
    const usePagination = page || limitParam;

    if (usePagination) {
      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const limitNum = Math.min(500, Math.max(1, parseInt(limitParam as string) || 100));
      const offset = (pageNum - 1) * limitNum;

      const countResult = await query(`SELECT COUNT(*) as total FROM islemler${whereClause}`, params);
      const total = parseInt(countResult.rows[0].total);

      const dataQuery = `SELECT * FROM islemler${whereClause} ORDER BY full_tarih DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limitNum, offset);
      const result = await query(dataQuery, params);

      res.json({
        data: result.rows,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum)
        }
      });
    } else {
      const result = await query(`SELECT * FROM islemler${whereClause} ORDER BY full_tarih DESC`, params);
      res.json(result.rows);
    }
  } catch (error) {
    logger.error('İşlemleri getirme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Telefon numarasına göre kayıt ara (duplicate kontrolü için - hafif endpoint)
router.get('/search-by-phone', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone } = req.query;
    if (!phone) {
      res.json([]);
      return;
    }
    const cleanedPhone = (phone as string).replace(/\D/g, '');
    const result = await query(
      `SELECT * FROM islemler WHERE cep_tel LIKE $1 OR yedek_tel LIKE $1 ORDER BY id DESC LIMIT 50`,
      [`%${cleanedPhone}%`]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Telefon arama hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// İsme göre müşteri geçmişi ara (hafif endpoint)
router.get('/search-by-name', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.query;
    if (!name) {
      res.json([]);
      return;
    }
    const result = await query(
      `SELECT * FROM islemler WHERE LOWER(ad_soyad) LIKE LOWER($1) ORDER BY id DESC LIMIT 200`,
      [`%${name}%`]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('İsim arama hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Yeni işlem ekle
router.post('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      ad_soyad,
      ilce,
      mahalle,
      cadde,
      sokak,
      kapi_no,
      apartman_site,
      blok_no,
      daire_no,
      sabit_tel,
      cep_tel,
      yedek_tel,
      urun,
      marka,
      sikayet,
      teknisyen_ismi,
      yapilan_islem,
      tutar,
      is_durumu
    }: IslemCreateDto = req.body;

    // VARCHAR(20) alanları truncate et
    const truncatedKapiNo = (kapi_no || '').slice(0, 20);
    const truncatedBlokNo = (blok_no || '').slice(0, 20);
    const truncatedDaireNo = (daire_no || '').slice(0, 20);
    const truncatedSabitTel = (sabit_tel || '').replace(/\D/g, '').slice(0, 20);
    const truncatedCepTel = (cep_tel || '').replace(/\D/g, '').slice(0, 20);
    const truncatedYedekTel = (yedek_tel || '').replace(/\D/g, '').slice(0, 20);
    const truncatedIsDurumu = (is_durumu || 'acik').slice(0, 20);

    const result = await query(
      `INSERT INTO islemler (
        ad_soyad, ilce, mahalle, cadde, sokak, kapi_no,
        apartman_site, blok_no, daire_no, sabit_tel, cep_tel, yedek_tel,
        urun, marka, sikayet, teknisyen_ismi, yapilan_islem, tutar, is_durumu, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING *`,
      [
        ad_soyad, ilce, mahalle, cadde, sokak, truncatedKapiNo,
        apartman_site, truncatedBlokNo, truncatedDaireNo, truncatedSabitTel, truncatedCepTel, truncatedYedekTel,
        urun, marka, sikayet, teknisyen_ismi, yapilan_islem, tutar, truncatedIsDurumu, req.user?.username
      ],
      0
    );

    invalidateStatsCache();

    // Socket.IO ile tüm kullanıcılara bildir
    const io = req.app.get('io');
    io.emit(SOCKET_EVENTS.YENI_ISLEM, result.rows[0]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('İşlem ekleme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Güncellenebilir alanlar ve her biri için normalizasyon kuralı.
// (VARCHAR(20) kolonlar truncate edilir, telefonlar sadece rakama indirgenir.)
const onlyDigits20 = (v: any) => (v == null ? v : String(v).replace(/\D/g, '').slice(0, 20));
const max20 = (v: any) => (v == null ? v : String(v).slice(0, 20));

const UPDATABLE_ISLEM_FIELDS: Record<string, (v: any) => any> = {
  teknisyen_ismi: (v) => v,
  yapilan_islem: (v) => v,
  tutar: (v) => v,
  ad_soyad: (v) => v,
  ilce: (v) => v,
  mahalle: (v) => v,
  cadde: (v) => v,
  sokak: (v) => v,
  kapi_no: max20,
  apartman_site: (v) => v,
  blok_no: max20,
  daire_no: max20,
  sabit_tel: onlyDigits20,
  cep_tel: onlyDigits20,
  yedek_tel: onlyDigits20,
  urun: (v) => v,
  marka: (v) => v,
  sikayet: (v) => v,
  is_durumu: (v) => max20(v ?? 'acik'),
  yazdirildi: (v) => v,
};

// İşlem güncelle
// ⚡ Eskiden: önce SELECT * (1 round-trip) + ardından 20 kolonun tamamını yazan
// UPDATE. Artık tek sorguda, sadece gönderilen alanlar güncelleniyor.
router.put('/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updates: Record<string, any> = req.body || {};

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [field, normalize] of Object.entries(UPDATABLE_ISLEM_FIELDS)) {
      if (updates[field] === undefined) continue;
      setClauses.push(`${field} = $${paramIndex++}`);
      values.push(normalize(updates[field]));
    }

    if (setClauses.length === 0) {
      res.status(400).json({ message: 'Güncellenecek alan belirtilmedi' });
      return;
    }

    setClauses.push('updated_at = CURRENT_TIMESTAMP(6)');
    values.push(id);

    const result = await updateReturning(
      `UPDATE islemler SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values,
      0
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'İşlem bulunamadı' });
      return;
    }

    invalidateStatsCache();

    // Socket.IO ile tüm kullanıcılara bildir
    const io = req.app.get('io');
    io.emit(SOCKET_EVENTS.ISLEM_GUNCELLENDI, result.rows[0]);

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('İşlem güncelleme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// ⚡ Yazdırıldı bayrağını çevir - tek kolonluk, en hafif yol.
// Tabloda yazıcı simgesine basınca tüm satırı PUT etmek yerine bu kullanılır.
router.patch('/:id/yazdirildi', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { yazdirildi } = req.body;

    const result = await updateReturning(
      `UPDATE islemler SET yazdirildi = $1, updated_at = CURRENT_TIMESTAMP(6)
       WHERE id = $2 RETURNING *`,
      [Boolean(yazdirildi), id],
      0
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'İşlem bulunamadı' });
      return;
    }

    invalidateStatsCache();

    const io = req.app.get('io');
    io.emit(SOCKET_EVENTS.ISLEM_GUNCELLENDI, result.rows[0]);

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Yazdırıldı güncelleme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// İşlem sil
router.delete('/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM islemler WHERE id = $1 RETURNING *',
      [id],
      0
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'İşlem bulunamadı' });
      return;
    }

    invalidateStatsCache();

    // Socket.IO ile tüm kullanıcılara bildir
    const io = req.app.get('io');
    io.emit(SOCKET_EVENTS.ISLEM_SILINDI, id);

    res.json({ message: 'İşlem silindi', islem: result.rows[0] });
  } catch (error) {
    logger.error('İşlem silme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// İşi tamamla/aç
router.patch('/:id/durum', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { is_durumu } = req.body;

    const result = await updateReturning(
      `UPDATE islemler SET 
        is_durumu = $1,
        updated_at = CURRENT_TIMESTAMP(6)
      WHERE id = $2
      RETURNING *`,
      [is_durumu, id],
      0
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'İşlem bulunamadı' });
      return;
    }

    invalidateStatsCache();

    // Socket.IO ile tüm kullanıcılara bildir
    const io = req.app.get('io');
    io.emit(SOCKET_EVENTS.ISLEM_DURUM_DEGISTI, result.rows[0]);

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('İş durumu güncelleme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

export default router;
