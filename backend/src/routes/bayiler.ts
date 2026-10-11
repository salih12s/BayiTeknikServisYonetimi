import express, { Request, Response } from 'express';
import { query, updateReturning, isUniqueViolation } from '../db';
import { orderByText } from '../utils/sqlText';
import auth from '../middleware/auth';
import { Bayi } from '../types';
import logger from '../utils/logger';
import requireIntegerParam from '../middleware/requireIntegerParam';

const router = express.Router();
router.param('id', requireIntegerParam);

// GET all bayiler
router.get('/', auth, async (_req: Request, res: Response) => {
  try {
    const result = await query<Bayi>(
      `SELECT * FROM bayiler ORDER BY ${orderByText('isim')}`
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Error fetching bayiler:', error);
    res.status(500).json({ error: 'Bayiler getirilirken hata oluştu' });
  }
});

// POST new bayi
router.post('/', auth, async (req: Request, res: Response) => {
  try {
    const { isim } = req.body;

    if (!isim || !isim.trim()) {
      return res.status(400).json({ error: 'Bayi ismi gereklidir' });
    }

    const username = isim.trim();
    const password = '123456'; // Varsayılan şifre

    const result = await query<Bayi>(
      'INSERT INTO bayiler (isim, username, password) VALUES ($1, $2, $3) RETURNING *',
      [username, username, password]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error: any) {
    logger.error('Error creating bayi:', error);
    
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: 'Bu bayi zaten mevcut' });
    }
    
    return res.status(500).json({ error: 'Bayi oluşturulurken hata oluştu' });
  }
});

// PUT update bayi
router.put('/:id', auth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { isim } = req.body;

    if (!isim || !isim.trim()) {
      return res.status(400).json({ error: 'Bayi ismi gereklidir' });
    }

    const result = await updateReturning<Bayi>(
      'UPDATE bayiler SET isim = $1 WHERE id = $2 RETURNING *',
      [isim.trim(), id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bayi bulunamadı' });
    }

    return res.json(result.rows[0]);
  } catch (error: any) {
    logger.error('Error updating bayi:', error);
    
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: 'Bu bayi ismi zaten kullanılıyor' });
    }
    
    return res.status(500).json({ error: 'Bayi güncellenirken hata oluştu' });
  }
});

// DELETE bayi
router.delete('/:id', auth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM bayiler WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bayi bulunamadı' });
    }

    return res.json({ message: 'Bayi başarıyla silindi' });
  } catch (error) {
    logger.error('Error deleting bayi:', error);
    return res.status(500).json({ error: 'Bayi silinirken hata oluştu' });
  }
});

export default router;