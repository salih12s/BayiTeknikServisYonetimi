import { Router, Request, Response } from 'express';
import { query } from '../db';
import authMiddleware from '../middleware/auth';
import logger from '../utils/logger';

const router = Router();

// Bellek içi önbellek YOK: hosting birden fazla süreç çalıştırabilir ve bir süreçte
// kaydedilen düzeni diğeri dakikalarca eski haliyle sunabilir. Tablo 13 küçük
// satırdan ibaret; her istekte okumak ucuzdur.

// Sürücü JSON kolonunu çözülmüş olarak verir; metin gelirse (farklı sunucu/sürücü)
// burada çözülür. Arayüz her durumda aynı listeyi alır: metin giderse yazdırma
// ekranı sessizce varsayılan konumlara döner.
function parseConfig(config: unknown): unknown {
  return typeof config === 'string' ? JSON.parse(config) : config;
}

// Türkçe karakterleri doğru normalize et (büyük/küçük harf duyarsız)
// Tüm Latin harflerini ve Türkçe karakterleri standartlaştır
function normalizeTurkish(str: string): string {
  return str
    .trim()
    .toLowerCase() // Önce küçük harfe çevir
    .normalize('NFD') // Unicode normalizasyonu - aksanları ayır
    .replace(/[\u0300-\u036f]/g, '') // Aksanları temizle
    .replace(/ı/g, 'i') // Türkçe ı'yı i'ye çevir
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .toUpperCase(); // Sonunda büyük harfe çevir
}

// Ortak marka grupları - her grup kendi içinde aynı config'i paylaşır
const BRAND_GROUPS = [
  // Grup 1: Ferre ailesi
  { brands: ['Ferre', 'Femaş', 'General', 'Vorne'], master: 'Ferre' },
  // Grup 2: Alveus ailesi
  { brands: ['Alveus', 'Alpina', 'Cucinox', 'Exep', 'Goodwest', 'Newton', 'Punto', 'White Daisy'], master: 'Alveus' },
  // Grup 3: Daxom ailesi
  { brands: ['Daxom', 'Termomex'], master: 'Daxom' },
  // Grup 4: Çetintaş ailesi
  { brands: ['Çetintaş', 'Evii'], master: 'Çetintaş' },
  // Grup 5: Eminçelik ailesi
  { brands: ['Eminçelik', 'Elleti'], master: 'Eminçelik' },
  // Grup 6: Minisan ailesi
  { brands: ['Minisan', 'Sunday', 'Maximus'], master: 'Minisan' },
  // Grup 7: İtimat ailesi
  { brands: ['İtimat', 'Woox'], master: 'İtimat' }
];

// Marka için master marka ismini bul (gruplardan birindeyse master'ını döndür)
function getMasterBrand(marka: string): string {
  const normalizedMarka = normalizeTurkish(marka);
  
  // Hangi grupta olduğunu kontrol et
  for (const group of BRAND_GROUPS) {
    const isInGroup = group.brands.some(b => normalizeTurkish(b) === normalizedMarka);
    if (isInGroup) {
      return group.master;
    }
  }
  
  // Hiçbir grupta değilse kendi adını kullan (orijinal formatıyla)
  return marka;
}

// Marka için yazıcı ayarlarını getir
router.get('/:marka', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { marka } = req.params;
    const masterBrand = getMasterBrand(marka);

    const result = await query(
      'SELECT config FROM printer_settings WHERE marka = $1',
      [masterBrand]
    );

    if (result.rows.length > 0) {
      res.json(parseConfig(result.rows[0].config));
    } else {
      res.json(null);
    }
  } catch (error) {
    logger.error('❌ Yazıcı ayarları getirme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Marka için yazıcı ayarlarını kaydet/güncelle
router.post('/:marka', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { marka } = req.params;
    const masterBrand = getMasterBrand(marka);
    const config = req.body;

    console.log('📝 Yazıcı ayarları kaydediliyor:', marka, '→ Master:', masterBrand);

    await query(
      `INSERT INTO printer_settings (marka, config, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP(6))
       ON DUPLICATE KEY UPDATE config = VALUES(config), updated_at = CURRENT_TIMESTAMP(6)`,
      [masterBrand, JSON.stringify(config)],
      0
    );
    const result = await query('SELECT * FROM printer_settings WHERE marka = $1', [masterBrand]);
    const saved = result.rows[0];

    console.log('✅ Kaydedildi (master brand):', masterBrand);
    res.json({ ...saved, config: parseConfig(saved.config) });
  } catch (error) {
    logger.error('❌ Yazıcı ayarları kaydetme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

// Marka için yazıcı ayarlarını sil
router.delete('/:marka', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { marka } = req.params;
    const masterBrand = getMasterBrand(marka);
    await query('DELETE FROM printer_settings WHERE marka = $1', [masterBrand], 0);
    res.json({ message: 'Yazıcı ayarları silindi' });
  } catch (error) {
    logger.error('Yazıcı ayarları silme hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

export default router;
