import express, { Request, Response } from 'express';
import { query, updateReturning, isUniqueViolation } from '../db';
import { orderByText } from '../utils/sqlText';
import authMiddleware from '../middleware/auth';
import logger from '../utils/logger';
import requireIntegerParam from '../middleware/requireIntegerParam';

const router = express.Router();
router.param('id', requireIntegerParam);

// Tüm markaları getir
router.get('/', authMiddleware, async (_req: Request, res: Response): Promise<void> => {
  try {
    // ⚡ CACHE: Marka listesi 5 dakika tarayıcıda cache'lenir
    res.set({
      'Cache-Control': 'public, max-age=300',
      'ETag': `markalar-${Date.now()}`,
    });
    
    const result = await query(
      `SELECT * FROM markalar ORDER BY ${orderByText('isim')}`
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Marka listeleme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Yeni marka ekle
router.post('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { isim } = req.body;

    if (!isim || !isim.trim()) {
      res.status(400).json({ message: 'Marka ismi gereklidir' });
      return;
    }

    const result = await query(
      'INSERT INTO markalar (isim) VALUES ($1) RETURNING *',
      [isim.trim()]
    );

    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (isUniqueViolation(error)) {
      res.status(400).json({ message: 'Bu marka zaten kayıtlı' });
    } else {
      logger.error('Marka ekleme hatası:', error);
      res.status(500).json({ message: 'Sunucu hatası' });
    }
  }
});

// Marka güncelle
router.put('/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { isim } = req.body;

    if (!isim || !isim.trim()) {
      res.status(400).json({ message: 'Marka ismi gereklidir' });
      return;
    }

    const result = await updateReturning(
      'UPDATE markalar SET isim = $1 WHERE id = $2 RETURNING *',
      [isim.trim(), id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Marka bulunamadı' });
      return;
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    if (isUniqueViolation(error)) {
      res.status(400).json({ message: 'Bu marka ismi zaten kullanılıyor' });
    } else {
      logger.error('Marka güncelleme hatası:', error);
      res.status(500).json({ message: 'Sunucu hatası' });
    }
  }
});

// Marka sil
router.delete('/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM markalar WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Marka bulunamadı' });
      return;
    }

    res.json({ message: 'Marka başarıyla silindi' });
  } catch (error) {
    logger.error('Marka silme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

export default router;
