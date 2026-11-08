import express, { Request, RequestHandler, Response } from 'express';
import { query } from '../db';
import authMiddleware from '../middleware/auth';
import requireIntegerParam from '../middleware/requireIntegerParam';
import { SOCKET_EVENTS } from '../constants/socketEvents';
import { emitIslemEvent } from '../services/realtime';
import logger from '../utils/logger';
import { orderByText } from '../utils/sqlText';
import {
  bayiCreatedBy,
  createRateLimiter,
  generateLinkToken,
  isLinkToken,
  parseBayiKayit,
} from '../utils/bayiKayitRules';
import { invalidateStatsCache } from './islemler';

/**
 * Bayi kayıt linki.
 *
 *   /linkler...   Yönetici: bayiye link oluşturur, yeniler, iptal eder.
 *   /form/:token  HERKESE AÇIK: linki açan kişi giriş yapmadan yeni işlem kaydı doldurur.
 *
 * Herkese açık kısım yalnızca kayıt EKLER; hiçbir kaydı okumaz, değiştirmez, silmez.
 */
const router = express.Router();
router.param('bayiId', requireIntegerParam);

const requireAdmin: RequestHandler = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ message: 'Bu işlem için yönetici yetkisi gerekir' });
    return;
  }
  next();
};

const INVALID_LINK = 'Bu link geçersiz ya da iptal edilmiş. Lütfen firmadan yeni link isteyin.';

// Bir linkten 10 dakikada en çok 30 kayıt: link yanlış ellere geçerse listeyi dolduramasın.
export const BAYI_KAYIT_LIMIT = 30;
const submissions = createRateLimiter(BAYI_KAYIT_LIMIT, 10 * 60 * 1000);

/** Tanım listesindeki adlar: baştaki/sondaki boşluk atılır, boş ve yinelenen adlar çıkarılır. */
function cleanNames(rows: Array<{ isim: string }>): string[] {
  return [...new Set(rows.map((row) => row.isim.trim()).filter(Boolean))];
}

async function findBayiByToken(token: unknown): Promise<{ id: number; isim: string } | null> {
  if (!isLinkToken(token)) return null;
  const result = await query<{ id: number; isim: string }>(
    `SELECT b.id, b.isim FROM bayi_kayit_linkleri l
     JOIN bayiler b ON b.id = l.bayi_id
     WHERE l.token = $1`,
    [token],
  );
  return result.rows[0] ?? null;
}

// ---- yönetici

router.get('/linkler', authMiddleware, requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await query(
      'SELECT bayi_id, token, created_at FROM bayi_kayit_linkleri ORDER BY bayi_id',
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Bayi linkleri listeleme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Link oluşturur; bayinin linki varsa YENİLER (eski link artık çalışmaz).
router.post('/linkler/:bayiId', authMiddleware, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const bayiId = Number(req.params.bayiId);
    const bayi = await query('SELECT id FROM bayiler WHERE id = $1', [bayiId]);
    if (bayi.rows.length === 0) {
      res.status(404).json({ message: 'Bayi bulunamadı' });
      return;
    }

    const token = generateLinkToken();
    await query(
      `INSERT INTO bayi_kayit_linkleri (bayi_id, token) VALUES ($1, $2)
       ON DUPLICATE KEY UPDATE token = VALUES(token), created_at = NOW(6)`,
      [bayiId, token],
    );
    res.status(201).json({ bayi_id: bayiId, token });
  } catch (error) {
    logger.error('Bayi linki oluşturma hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

router.delete('/linkler/:bayiId', authMiddleware, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    await query('DELETE FROM bayi_kayit_linkleri WHERE bayi_id = $1', [Number(req.params.bayiId)]);
    res.json({ message: 'Link iptal edildi' });
  } catch (error) {
    logger.error('Bayi linki iptal hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// ---- herkese açık form

// Formun ihtiyaç duyduğu seçenekler. Mahalleler ilçe seçilince /api/ilceler/:id/mahalleler
// (zaten herkese açık) üzerinden alınır.
router.get('/form/:token', async (req: Request, res: Response): Promise<void> => {
  try {
    const bayi = await findBayiByToken(req.params.token);
    if (!bayi) {
      res.status(404).json({ message: INVALID_LINK });
      return;
    }
    const [ilceler, urunler, markalar] = await Promise.all([
      query<{ ilce_id: number; isim: string }>(`SELECT ilce_id, isim FROM ilceler ORDER BY ${orderByText('isim')}`),
      query<{ isim: string }>(`SELECT isim FROM urunler ORDER BY ${orderByText('isim')}`),
      query<{ isim: string }>(`SELECT isim FROM markalar WHERE aktif = 1 ORDER BY ${orderByText('isim')}`),
    ]);
    res.json({
      bayi: bayi.isim,
      ilceler: ilceler.rows.filter((row) => row.isim.trim()),
      // Tanım listelerinde adı boş (yalnızca boşluk) kalmış satırlar seçenek olarak gösterilmez.
      urunler: cleanNames(urunler.rows),
      markalar: cleanNames(markalar.rows),
    });
  } catch (error) {
    logger.error('Bayi kayıt formu hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

router.post('/form/:token', async (req: Request, res: Response): Promise<void> => {
  try {
    const bayi = await findBayiByToken(req.params.token);
    if (!bayi) {
      res.status(404).json({ message: INVALID_LINK });
      return;
    }
    const parsed = parseBayiKayit(req.body);
    if (!parsed.ok) {
      res.status(400).json({ message: parsed.message });
      return;
    }
    const kayit = parsed.value;

    // Listeden seçilen alanlar gerçekten listede mi? (Form değerleri elle değiştirilebilir.)
    const [ilce, urun, marka] = await Promise.all([
      query<{ ilce_id: number }>('SELECT ilce_id FROM ilceler WHERE TRIM(isim) = $1', [kayit.ilce]),
      query('SELECT 1 FROM urunler WHERE TRIM(isim) = $1', [kayit.urun]),
      query('SELECT 1 FROM markalar WHERE TRIM(isim) = $1 AND aktif = 1', [kayit.marka]),
    ]);
    const mahalle =
      ilce.rows.length > 0
        ? await query('SELECT 1 FROM mahalleler WHERE ilce_id = $1 AND TRIM(isim) = $2', [
            ilce.rows[0].ilce_id,
            kayit.mahalle,
          ])
        : { rows: [] };
    if (ilce.rows.length === 0 || mahalle.rows.length === 0) {
      res.status(400).json({ message: 'Lütfen ilçe ve mahalleyi listeden seçin' });
      return;
    }
    if (urun.rows.length === 0 || marka.rows.length === 0) {
      res.status(400).json({ message: 'Lütfen ürün ve markayı listeden seçin' });
      return;
    }

    // Sınır, geçerli kayıtlar için sayılır: yanlış doldurulup düzeltilen form hakkı yemez.
    if (!submissions.allow(String(bayi.id))) {
      res.status(429).json({ message: 'Çok fazla kayıt gönderildi. Lütfen birkaç dakika sonra tekrar deneyin.' });
      return;
    }

    const result = await query(
      `INSERT INTO islemler (
        ad_soyad, ilce, mahalle, cadde, sokak, kapi_no,
        apartman_site, blok_no, daire_no, cep_tel, yedek_tel,
        urun, marka, sikayet, is_durumu, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'acik', $15)
      RETURNING *`,
      [
        kayit.ad_soyad, kayit.ilce, kayit.mahalle, kayit.cadde, kayit.sokak, kayit.kapi_no,
        kayit.apartman_site, kayit.blok_no, kayit.daire_no, kayit.cep_tel, kayit.yedek_tel,
        kayit.urun, kayit.marka, kayit.sikayet, bayiCreatedBy(bayi.isim),
      ],
      0,
    );
    const islem = result.rows[0];

    invalidateStatsCache();
    // Ofisteki açık ekranlara yeni kayıt anında düşer.
    emitIslemEvent(req.app.get('io'), SOCKET_EVENTS.YENI_ISLEM, islem);

    res.status(201).json({ message: 'Kaydınız alındı', sira_no: islem.id });
  } catch (error) {
    logger.error('Bayi kaydı oluşturma hatası:', error);
    res.status(500).json({ message: 'Kayıt alınamadı, lütfen tekrar deneyin' });
  }
});

export default router;
