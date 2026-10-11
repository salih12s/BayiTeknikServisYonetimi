import express, { Request, Response } from 'express';
import { query, updateReturning, isUniqueViolation } from '../db';
import { orderByText } from '../utils/sqlText';
import authMiddleware from '../middleware/auth';
import logger from '../utils/logger';
import requireIntegerParam from '../middleware/requireIntegerParam';

const router = express.Router();
router.param('id', requireIntegerParam);

// Tüm teknisyenleri getir
router.get('/', authMiddleware, async (_req: Request, res: Response): Promise<void> => {
  try {
    // ⚡ CACHE: Teknisyen listesi 5 dakika tarayıcıda cache'lenir
    res.set({
      'Cache-Control': 'public, max-age=300', // 5 dakika
      'ETag': `teknisyenler-${Date.now()}`, // Her 5 dakikada yeni ETag
    });
    
    const result = await query(
      `SELECT * FROM teknisyenler ORDER BY ${orderByText('isim')}`
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Teknisyen listeleme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Yeni teknisyen ekle
router.post('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { isim } = req.body;

    if (!isim || !isim.trim()) {
      res.status(400).json({ message: 'Teknisyen ismi gereklidir' });
      return;
    }

    const result = await query(
      'INSERT INTO teknisyenler (isim) VALUES ($1) RETURNING *',
      [isim.trim()]
    );

    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (isUniqueViolation(error)) {
      res.status(400).json({ message: 'Bu teknisyen zaten kayıtlı' });
    } else {
      logger.error('Teknisyen ekleme hatası:', error);
      res.status(500).json({ message: 'Sunucu hatası' });
    }
  }
});

// Teknisyen güncelle
router.put('/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { isim } = req.body;

    if (!isim || !isim.trim()) {
      res.status(400).json({ message: 'Teknisyen ismi gereklidir' });
      return;
    }

    const result = await updateReturning(
      'UPDATE teknisyenler SET isim = $1 WHERE id = $2 RETURNING *',
      [isim.trim(), id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Teknisyen bulunamadı' });
      return;
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    if (isUniqueViolation(error)) {
      res.status(400).json({ message: 'Bu teknisyen ismi zaten kullanılıyor' });
    } else {
      logger.error('Teknisyen güncelleme hatası:', error);
      res.status(500).json({ message: 'Sunucu hatası' });
    }
  }
});

// Teknisyen sil
router.delete('/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM teknisyenler WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Teknisyen bulunamadı' });
      return;
    }

    res.json({ message: 'Teknisyen başarıyla silindi' });
  } catch (error) {
    logger.error('Teknisyen silme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

export default router;
