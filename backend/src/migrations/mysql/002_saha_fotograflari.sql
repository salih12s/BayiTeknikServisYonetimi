-- Saha fotoğrafları Cloudflare R2'de durur; veritabanında yalnızca adresleri tutulur.
-- (Eski PostgreSQL taslağı: migrations/postgres-archive/20260916_create_saha_fotograflari.sql)
--
-- Bir satırın iki hali vardır:
--   * saha_kaydi_id NULL  -> "bekleyen yükleme": tarayıcıya imzalı yükleme adresi verildi
--     ama fotoğraf henüz bir kayda bağlanmadı. 24 saat içinde bağlanmazsa temizlenir.
--   * saha_kaydi_id dolu  -> kayda bağlı fotoğraf; sort_order kayıttaki sırasıdır.
--
-- Kayıt silinince satırlar FK ile birlikte silinir (CASCADE). R2'deki dosyanın silinmesi
-- veritabanı işleminin parçası olamaz; bu yüzden silinecek adresler aynı transaction'da
-- r2_silme_kuyrugu tablosuna yazılır ve dosyalar işlem tamamlandıktan sonra silinir.
-- Silme yarıda kalırsa kuyruk satırı durur, bir sonraki temizlikte yeniden denenir.

CREATE TABLE IF NOT EXISTS saha_fotograflari (
  id INT NOT NULL AUTO_INCREMENT,
  saha_kaydi_id INT NULL,
  yukleyen_id INT NULL,
  object_key VARCHAR(255) NOT NULL,
  thumb_key VARCHAR(255) NULL,
  original_name VARCHAR(255) NULL,
  mime_type VARCHAR(100) NOT NULL DEFAULT 'image/jpeg',
  size_bytes INT UNSIGNED NOT NULL,
  thumb_size_bytes INT UNSIGNED NULL,
  checksum_sha256 CHAR(64) NULL,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  source VARCHAR(20) NOT NULL DEFAULT 'r2',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  migrated_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY saha_fotograflari_object_key_key (object_key),
  KEY idx_saha_fotograflari_kayit_sira (saha_kaydi_id, sort_order),
  KEY idx_saha_fotograflari_bekleyen (yukleyen_id, saha_kaydi_id),
  KEY idx_saha_fotograflari_created_at (created_at),
  CONSTRAINT saha_fotograflari_saha_kaydi_id_fkey
    FOREIGN KEY (saha_kaydi_id) REFERENCES saha_kayitlari (id) ON DELETE CASCADE,
  CONSTRAINT saha_fotograflari_source_check CHECK (source IN ('r2', 'legacy'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS r2_silme_kuyrugu (
  id INT NOT NULL AUTO_INCREMENT,
  object_key VARCHAR(255) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
