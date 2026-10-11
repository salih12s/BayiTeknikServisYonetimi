import express, { Request, Response } from 'express';
import { query, updateReturning, isUniqueViolation } from '../db';
import { orderByText } from '../utils/sqlText';
import auth from '../middleware/auth';
import { Montaj } from '../types';
import logger from '../utils/logger';
import requireIntegerParam from '../middleware/requireIntegerParam';

const router = express.Router();
router.param('id', requireIntegerParam);

// GET all montajlar
router.get('/', auth, async (_req: Request, res: Response) => {
  try {
    // ⚡ CACHE: Montaj listesi 5 dakika tarayıcıda cache'lenir
    res.set({
      'Cache-Control': 'public, max-age=300',
      'ETag': `montajlar-${Date.now()}`,
    });
    
    const result = await query<Montaj>(
      `SELECT * FROM montajlar ORDER BY ${orderByText('isim')}`
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Error fetching montajlar:', error);
    res.status(500).json({ error: 'Montajlar getirilirken hata oluştu' });
  }
});

// POST new montaj
router.post('/', auth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { isim } = req.body;

    if (!isim || !isim.trim()) {
      res.status(400).json({ error: 'Montaj ismi gereklidir' });
      return;
    }

    const result = await query<Montaj>(
      'INSERT INTO montajlar (isim) VALUES ($1) RETURNING *',
      [isim.trim()]
    );

    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    logger.error('Error creating montaj:', error);
    
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: 'Bu montaj zaten mevcut' });
      return;
    }
    
    res.status(500).json({ error: 'Montaj oluşturulurken hata oluştu' });
  }
});

// PUT update montaj
router.put('/:id', auth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { isim } = req.body;

    if (!isim || !isim.trim()) {
      res.status(400).json({ error: 'Montaj ismi gereklidir' });
      return;
    }

    const result = await updateReturning<Montaj>(
      'UPDATE montajlar SET isim = $1 WHERE id = $2 RETURNING *',
      [isim.trim(), id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Montaj bulunamadı' });
      return;
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    logger.error('Error updating montaj:', error);
    
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: 'Bu montaj ismi zaten kullanılıyor' });
      return;
    }
    
    res.status(500).json({ error: 'Montaj güncellenirken hata oluştu' });
  }
});

// DELETE montaj
router.delete('/:id', auth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM montajlar WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Montaj bulunamadı' });
      return;
    }

    res.json({ message: 'Montaj başarıyla silindi' });
  } catch (error) {
    logger.error('Error deleting montaj:', error);
    res.status(500).json({ error: 'Montaj silinirken hata oluştu' });
  }
});

export default router;