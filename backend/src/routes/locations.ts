import { Router } from 'express';
import { query } from '../db';
import { orderByText } from '../utils/sqlText';
import logger from '../utils/logger';
import requireIntegerParam from '../middleware/requireIntegerParam';

const router = Router();
router.param('ilceId', requireIntegerParam);

// Tüm ilçeleri getir
router.get('/', async (_req, res) => {
  try {
    // ⚡ CACHE: İlçe listesi değişmez, 1 saat cache
    res.set({
      'Cache-Control': 'public, max-age=3600', // 1 saat
      'ETag': 'ilceler-v1',
    });
    
    const result = await query(`SELECT * FROM ilceler ORDER BY ${orderByText('isim')}`);
    res.json(result.rows);
  } catch (error) {
    logger.error('İlçeler getirilirken hata:', error);
    res.status(500).json({ message: 'İlçeler getirilirken hata oluştu' });
  }
});

// Belirli bir ilçeye ait mahalleleri getir
router.get('/:ilceId/mahalleler', async (req, res) => {
  try {
    const { ilceId } = req.params;
    const result = await query(
      `SELECT * FROM mahalleler WHERE ilce_id = $1 ORDER BY ${orderByText('isim')}`,
      [ilceId]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('Mahalleler getirilirken hata:', error);
    res.status(500).json({ message: 'Mahalleler getirilirken hata oluştu' });
  }
});

export default router;