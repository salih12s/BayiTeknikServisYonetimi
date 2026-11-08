import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db';
import logger from '../utils/logger';
import { verifyBayiPassword } from '../services/bayiPasswords';

const router = express.Router();

// Not: Herkese açık "kayıt ol" (/register) ucu 2026-11-08'de KALDIRILDI. İnternetteki
// herkesin hesap açıp bütün müşteri verisine ulaşmasına izin veriyordu; arayüz de
// kullanmıyordu. Kullanıcıyı yalnızca yönetici açar: POST /api/admin/create-user.

// Giriş
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;

    // Kullanıcıyı bul
    const user = await query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    if (user.rows.length === 0) {
      res.status(401).json({ message: 'Kullanıcı adı veya şifre hatalı' });
      return;
    }

    // Şifreyi kontrol et
    const validPassword = await bcrypt.compare(password, user.rows[0].password);

    if (!validPassword) {
      res.status(401).json({ message: 'Kullanıcı adı veya şifre hatalı' });
      return;
    }

    // Yöneticinin pasif yaptığı hesap giriş yapamaz (eskiden bu kontrol yoktu).
    if (user.rows[0].is_active === false) {
      res.status(403).json({ message: 'Hesabınız pasif. Yöneticinize başvurun.' });
      return;
    }

    // Token oluştur
    const token = jwt.sign(
      { id: user.rows[0].id, username: user.rows[0].username, role: 'user' },
      process.env.JWT_SECRET || '',
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Giriş başarılı',
      token,
      user: {
        id: user.rows[0].id,
        username: user.rows[0].username,
        role: 'user'
      }
    });
  } catch (error) {
    logger.error('Giriş hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Bayi Girişi
router.post('/bayi-login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;

    // Bayi'yi bul
    const bayi = await query(
      'SELECT * FROM bayiler WHERE username = $1',
      [username]
    );

    if (bayi.rows.length === 0) {
      res.status(401).json({ message: 'Kullanıcı adı veya şifre hatalı' });
      return;
    }

    // Şifre bcrypt ile saklanır. Eski (düz metin) kayıt eşleşirse hemen şifrelenir.
    const check = await verifyBayiPassword(password, bayi.rows[0].password);
    if (!check.ok) {
      res.status(401).json({ message: 'Kullanıcı adı veya şifre hatalı' });
      return;
    }
    if (check.upgrade) {
      await query('UPDATE bayiler SET password = $1 WHERE id = $2', [check.upgrade, bayi.rows[0].id]);
    }

    // Token oluştur
    const token = jwt.sign(
      { id: bayi.rows[0].id, username: bayi.rows[0].username, role: 'bayi', bayiIsim: bayi.rows[0].isim },
      process.env.JWT_SECRET || '',
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Giriş başarılı',
      token,
      user: {
        id: bayi.rows[0].id,
        username: bayi.rows[0].username,
        role: 'bayi',
        bayiIsim: bayi.rows[0].isim
      }
    });
  } catch (error) {
    logger.error('Bayi giriş hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Sistem Şifresi Kontrolü (Admin girişi için)
router.post('/verify-system-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const { password } = req.body;
    
    // Sistem şifresini .env'den al veya sabit hash kullan
    // bcrypt hash'i "$" içerir; bazı barındırma panelleri ve kabuklar bu karakteri
    // değişken sayıp değeri bozar. Öyle ortamlarda hash base64 olarak
    // SYSTEM_PASSWORD_HASH_B64 ile verilir.
    const SYSTEM_PASSWORD_HASH = process.env.SYSTEM_PASSWORD_HASH_B64
      ? Buffer.from(process.env.SYSTEM_PASSWORD_HASH_B64, 'base64').toString('utf8')
      : process.env.SYSTEM_PASSWORD_HASH ||
        // Yalnız yerel geliştirme için yedek değer; yayında ortam değişkeni ZORUNLU.
        (process.env.NODE_ENV === 'production' ? '' : '$2a$10$XQKZvK5P7pZQwVxJYvN8/.rKZvQK5pGxGvB0YvN8vL5K7pZQwVxJY');
    if (!SYSTEM_PASSWORD_HASH) {
      res.status(503).json({ message: 'Sistem şifresi tanımlı değil' });
      return;
    }

    // Şifreyi kontrol et
    const isValid = await bcrypt.compare(password, SYSTEM_PASSWORD_HASH);
    
    if (!isValid) {
      res.status(401).json({ message: 'Geçersiz sistem şifresi' });
      return;
    }
    
    res.json({ message: 'Sistem şifresi doğrulandı', valid: true });
  } catch (error) {
    logger.error('Sistem şifresi kontrol hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

export default router;