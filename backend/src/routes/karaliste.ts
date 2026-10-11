import express, { Request, Response } from 'express';
import { query } from '../db';
import authMiddleware from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import requireIntegerParam from '../middleware/requireIntegerParam';

const router = express.Router();
router.param('id', requireIntegerParam);

// `createKaralisteTable` Part 2 / P2.D1 ile bootstrap/createKaralisteTable.ts'ye
// taşındı. server.ts artık doğrudan o dosyadan import eder. Route dosyası yalnız
// HTTP handler'ları tutar.
//
// Part 2 / P2.D4 (PILOT): Bu dosyadaki handler'lar try/catch yerine
// `asyncHandler` ile sarılmıştır. Yakalanmamış promise reject'leri global
// `errorHandler` middleware'ine (server.ts içinde mount edildi) düşer ve
// 500 + `{ message: 'Sunucu hatası' }` üretir — yani önceki davranışla
// bire bir aynı yanıt. Loglama errorHandler içinde yapılır.

// Karalisteye ekle
router.post('/', authMiddleware, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { ad_soyad, cep_tel, yedek_tel, mahalle, cadde, sokak, kapi_no, sebep } = req.body;
  // Phase 13: (req as any).user cast'i kaldırıldı; Express.Request.user
  // augmentation'ı (backend/src/types/express.d.ts + middleware/auth.ts)
  // sayesinde artık tip-safe şekilde erişiyoruz. Runtime davranış aynı.
  const created_by = req.user?.username || 'system';

  if (!ad_soyad) {
    res.status(400).json({ message: 'Ad soyad zorunludur' });
    return;
  }

  const result = await query(
    `INSERT INTO karaliste (ad_soyad, cep_tel, yedek_tel, mahalle, cadde, sokak, kapi_no, sebep, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [ad_soyad, cep_tel || null, yedek_tel || null, mahalle || null, cadde || null, sokak || null, kapi_no || null, sebep || null, created_by]
  );

  res.status(201).json(result.rows[0]);
}));

// Karalisteden sil
router.delete('/:id', authMiddleware, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  await query('DELETE FROM karaliste WHERE id = $1', [id]);
  res.json({ message: 'Karalisteden silindi' });
}));

// Telefon numarasına göre karaliste kontrolü
router.get('/check-phone', authMiddleware, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { phone } = req.query;
  if (!phone) {
    res.json({ blacklisted: false });
    return;
  }
  const cleanedPhone = (phone as string).replace(/\D/g, '');

  const result = await query(
    `SELECT * FROM karaliste WHERE 
      REPLACE(REPLACE(REPLACE(REPLACE(cep_tel, ' ', ''), '-', ''), '(', ''), ')', '') LIKE $1
      OR REPLACE(REPLACE(REPLACE(REPLACE(yedek_tel, ' ', ''), '-', ''), '(', ''), ')', '') LIKE $1
    ORDER BY created_at DESC LIMIT 1`,
    [`%${cleanedPhone}%`]
  );

  if (result.rows.length > 0) {
    res.json({ blacklisted: true, record: result.rows[0] });
  } else {
    res.json({ blacklisted: false });
  }
}));

// Adrese göre karaliste kontrolü (mahalle + cadde/sokak + kapı_no)
router.get('/check-address', authMiddleware, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { mahalle, cadde, sokak, kapi_no } = req.query;

  if (!mahalle && !sokak && !cadde) {
    res.json({ blacklisted: false });
    return;
  }

  let whereClause = 'WHERE 1=1';
  const params: unknown[] = [];
  let paramIndex = 1;

  if (mahalle) {
    whereClause += ` AND LOWER(mahalle) = LOWER($${paramIndex})`;
    params.push(mahalle);
    paramIndex++;
  }
  if (cadde) {
    whereClause += ` AND LOWER(cadde) = LOWER($${paramIndex})`;
    params.push(cadde);
    paramIndex++;
  }
  if (sokak) {
    whereClause += ` AND LOWER(sokak) = LOWER($${paramIndex})`;
    params.push(sokak);
    paramIndex++;
  }
  if (kapi_no) {
    whereClause += ` AND LOWER(kapi_no) = LOWER($${paramIndex})`;
    params.push(kapi_no);
    paramIndex++;
  }

  const result = await query(
    `SELECT * FROM karaliste ${whereClause} ORDER BY created_at DESC LIMIT 1`,
    params
  );

  if (result.rows.length > 0) {
    res.json({ blacklisted: true, record: result.rows[0] });
  } else {
    res.json({ blacklisted: false });
  }
}));

// Tüm karaliste kayıtlarını listele
router.get('/', authMiddleware, asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  const result = await query('SELECT * FROM karaliste ORDER BY created_at DESC');
  res.json(result.rows);
}));

export default router;
