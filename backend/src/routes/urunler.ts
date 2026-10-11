import { Router } from 'express';
import { query, updateReturning } from '../db';
import { orderByText } from '../utils/sqlText';
import { Urun } from '../types';
import authenticateToken from '../middleware/auth';
import logger from '../utils/logger';
import requireIntegerParam from '../middleware/requireIntegerParam';

const router = Router();
router.param('id', requireIntegerParam);

// Tüm ürünleri getir
router.get('/', authenticateToken, async (_req, res) => {
  try {
    // ⚡ CACHE: Ürün listesi 5 dakika tarayıcıda cache'lenir
    res.set({
      'Cache-Control': 'public, max-age=300',
      'ETag': `urunler-${Date.now()}`,
    });
    
    const result = await query<Urun>(
      `SELECT * FROM urunler ORDER BY ${orderByText('isim')}`
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Ürünler getirme hatası:', error);
    res.status(500).json({ error: 'Ürünler getirilemedi' });
  }
});

// Yeni ürün ekle
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { isim } = req.body;
    
    if (!isim) {
      return res.status(400).json({ error: 'Ürün ismi gerekli' });
    }

    const result = await query<Urun>(
      'INSERT INTO urunler (isim) VALUES ($1) RETURNING *',
      [isim]
    );
    
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Ürün ekleme hatası:', error);
    return res.status(500).json({ error: 'Ürün eklenemedi' });
  }
});

// Ürün güncelle
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { isim } = req.body;

    if (!isim) {
      return res.status(400).json({ error: 'Ürün ismi gerekli' });
    }

    const result = await updateReturning<Urun>(
      'UPDATE urunler SET isim = $1 WHERE id = $2 RETURNING *',
      [isim, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ürün bulunamadı' });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    logger.error('Ürün güncelleme hatası:', error);
    return res.status(500).json({ error: 'Ürün güncellenemedi' });
  }
});

// Ürün sil
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM urunler WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ürün bulunamadı' });
    }

    return res.json({ message: 'Ürün silindi' });
  } catch (error) {
    logger.error('Ürün silme hatası:', error);
    return res.status(500).json({ error: 'Ürün silinemedi' });
  }
});

export default router;