import express from 'express';
import authMiddleware from '../middleware/auth';
import { ADMIN, allowRoles, READ_STAFF_WRITE_ADMIN, STAFF } from '../middleware/requireRole';
import authRoutes from './auth';
import islemlerRoutes from './islemler';
import teknisyenlerRoutes from './teknisyenler';
import markalarRoutes from './markalar';
import bayilerRoutes from './bayiler';
import atolyeRoutes from './atolye';
import adminRoutes from './admin';
import montajlarRoutes from './montajlar';
import aksesuarlarRoutes from './aksesuarlar';
import urunlerRoutes from './urunler';
import locationsRoutes from './locations';
import printerSettingsRoutes from './printerSettings';
import sahaRoutes from './saha';
import karalisteRoutes from './karaliste';
import bayiKayitRoutes from './bayiKayit';

/**
 * API rotaları ve İZİN TABLOSU. Kural: her rol, ekranın ona bugün gösterdiği kadarını
 * yapabilir, fazlasını değil. Ekrandaki düğme gizlemesi güvenlik değildir; isteği
 * doğrudan gönderene karşı tek engel buradaki kurallardır.
 *
 *   rol      | ekranda gördüğü
 *   admin    | her şey (Tanımlamalar, Yönetim, yazıcı ayarı, silme)
 *   user     | Ana Sayfa (işlemler), Müşteri Geçmişi, Atölye, Saha kayıtları
 *   bayi     | yalnızca KENDİ atölye kayıtları (salt okunur; süzme atolye.ts içinde)
 *   saha     | yalnızca kendi saha kayıtları (kurallar saha.ts içinde)
 *
 * Giriş uçları (auth, admin/login, saha/login), bayi kayıt formu, ilçe/mahalle listesi ve
 * log ucu herkese açıktır.
 */
export function mountApiRoutes(app: express.Express): void {
  // Herkese açık giriş uçları; admin.ts ve saha.ts kendi içinde rol kontrolü yapar.
  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/saha', sahaRoutes);
  app.use('/api/bayi-kayit', bayiKayitRoutes);

  app.use('/api/islemler', authMiddleware,
    allowRoles({ GET: STAFF, POST: STAFF, PUT: STAFF, PATCH: STAFF, DELETE: ADMIN }), islemlerRoutes);
  app.use('/api/atolye', authMiddleware,
    allowRoles({ GET: [...STAFF, 'bayi'], POST: STAFF, PUT: STAFF, DELETE: ADMIN }), atolyeRoutes);
  app.use('/api/karaliste', authMiddleware,
    allowRoles({ GET: STAFF, POST: STAFF, DELETE: ADMIN }), karalisteRoutes);
  app.use('/api/printer-settings', authMiddleware,
    allowRoles({ GET: STAFF, POST: ADMIN, DELETE: ADMIN }), printerSettingsRoutes);

  const definitions = [authMiddleware, allowRoles(READ_STAFF_WRITE_ADMIN)];
  app.use('/api/teknisyenler', ...definitions, teknisyenlerRoutes);
  app.use('/api/markalar', ...definitions, markalarRoutes);
  app.use('/api/bayiler', ...definitions, bayilerRoutes);
  app.use('/api/montajlar', ...definitions, montajlarRoutes);
  app.use('/api/aksesuarlar', ...definitions, aksesuarlarRoutes);
  app.use('/api/urunler', ...definitions, urunlerRoutes);

  // İlçe/mahalle adları herkese açık adres verisidir ve bayiye gönderilen GİRİŞSİZ kayıt
  // formu bunları kullanır; bu yüzden giriş istenmez. Rota yalnızca okuma (GET) içerir.
  app.use('/api/ilceler', locationsRoutes);
  app.use('/api/locations/ilceler', locationsRoutes);
}
