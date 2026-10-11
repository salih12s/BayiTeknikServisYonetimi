-- ProjeCRM - MySQL/MariaDB başlangıç şeması (MariaDB 11.8 üzerinde doğrulandı).
-- Kaynak: canlı PostgreSQL şeması (2026-10-11 ölçümü); kolon sırası canlıyla aynıdır.
--
-- PostgreSQL davranışını korumak için alınan kararlar:
--   * Sıralama kuralı utf8mb4_nopad_bin: metin karşılaştırması PostgreSQL'deki gibi
--     harfi harfinedir. Varsayılan kural (unicode_ci) 'Çetintaş' ile 'çeti̇ntaş'
--     satırlarını AYNI sayar; printer_settings.marka gibi tekil kolonlarda bu, satır
--     kaybına ve yanlış yazıcı düzenine yol açar. "nopad": sondaki boşluk da ayırt edilir.
--   * timestamp -> DATETIME(6): mikrosaniye korunur. Oturum saat dilimi UTC'dir (db.ts).
--   * text -> MEDIUMTEXT: MySQL'de TEXT 64 KB ile sınırlıdır, PostgreSQL'de sınır yoktur.
--   * jsonb -> JSON, boolean -> TINYINT(1), numeric(10,2) -> DECIMAL(10,2).
--   * pg_trgm (GIN trigram) indexlerinin karşılığı yoktur; satır sayıları küçük olduğu
--     için LIKE '%...%' taraması yeterlidir.

CREATE TABLE IF NOT EXISTS admins (
  id INT NOT NULL AUTO_INCREMENT,
  username VARCHAR(255) NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY admins_username_key (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS aksesuarlar (
  id INT NOT NULL AUTO_INCREMENT,
  isim VARCHAR(100) NOT NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY aksesuarlar_isim_key (isim)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS atolye (
  id INT NOT NULL AUTO_INCREMENT,
  teslim_durumu VARCHAR(50) NULL DEFAULT 'beklemede',
  bayi_adi VARCHAR(255) NULL,
  musteri_ad_soyad VARCHAR(255) NULL,
  tel_no VARCHAR(20) NOT NULL,
  marka VARCHAR(100) NOT NULL,
  kod VARCHAR(100) NULL,
  seri_no VARCHAR(100) NULL,
  sikayet MEDIUMTEXT NOT NULL,
  ozel_not MEDIUMTEXT NULL,
  yapilan_islem MEDIUMTEXT NULL,
  ucret DECIMAL(10,2) NULL,
  yapilma_tarihi DATETIME(6) NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_by VARCHAR(255) NULL,
  kayit_tarihi VARCHAR(10) NULL,
  note_no VARCHAR(100) NULL,
  PRIMARY KEY (id),
  CONSTRAINT atolye_musteri_or_bayi_check CHECK (
    (musteri_ad_soyad IS NOT NULL AND musteri_ad_soyad <> '')
    OR (bayi_adi IS NOT NULL AND bayi_adi <> '')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS bayiler (
  id INT NOT NULL AUTO_INCREMENT,
  isim VARCHAR(100) NOT NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  username VARCHAR(100) NOT NULL,
  password VARCHAR(255) NULL DEFAULT '123456',
  PRIMARY KEY (id),
  UNIQUE KEY bayiler_isim_key (isim),
  UNIQUE KEY bayiler_username_unique (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS ilceler (
  id INT NOT NULL AUTO_INCREMENT,
  ilce_id INT NOT NULL,
  isim VARCHAR(255) NOT NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY ilceler_ilce_id_key (ilce_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS islemler (
  id INT NOT NULL AUTO_INCREMENT,
  full_tarih DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  teknisyen_ismi VARCHAR(100) NULL,
  yapilan_islem MEDIUMTEXT NULL,
  tutar DECIMAL(10,2) NULL,
  ad_soyad VARCHAR(100) NOT NULL,
  ilce VARCHAR(100) NOT NULL,
  mahalle VARCHAR(100) NOT NULL,
  cadde VARCHAR(100) NOT NULL,
  sokak VARCHAR(100) NOT NULL,
  kapi_no VARCHAR(20) NOT NULL,
  apartman_site VARCHAR(100) NULL,
  blok_no VARCHAR(20) NULL,
  daire_no VARCHAR(20) NULL,
  sabit_tel VARCHAR(20) NULL,
  cep_tel VARCHAR(20) NOT NULL,
  urun VARCHAR(100) NOT NULL,
  marka VARCHAR(100) NOT NULL,
  sikayet MEDIUMTEXT NOT NULL,
  is_durumu VARCHAR(20) NULL DEFAULT 'acik',
  created_by VARCHAR(50) NULL,
  updated_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  yedek_tel VARCHAR(20) NULL,
  yazdirildi TINYINT(1) NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_ad_soyad (ad_soyad),
  KEY idx_cep_tel (cep_tel),
  KEY idx_durum_tarih (is_durumu, full_tarih DESC),
  KEY idx_full_tarih (full_tarih DESC),
  KEY idx_is_durumu (is_durumu),
  KEY idx_teknisyen_ismi (teknisyen_ismi),
  KEY idx_yazdirildi (yazdirildi)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS karaliste (
  id INT NOT NULL AUTO_INCREMENT,
  ad_soyad VARCHAR(100) NOT NULL,
  cep_tel VARCHAR(20) NULL,
  yedek_tel VARCHAR(20) NULL,
  mahalle VARCHAR(100) NULL,
  cadde VARCHAR(100) NULL,
  sokak VARCHAR(100) NULL,
  kapi_no VARCHAR(20) NULL,
  sebep MEDIUMTEXT NULL,
  created_by VARCHAR(50) NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS mahalleler (
  id INT NOT NULL AUTO_INCREMENT,
  mahalle_id INT NOT NULL,
  ilce_id INT NOT NULL,
  isim VARCHAR(255) NOT NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY mahalleler_mahalle_id_key (mahalle_id),
  KEY idx_mahalleler_ilce_id (ilce_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS markalar (
  id INT NOT NULL AUTO_INCREMENT,
  isim VARCHAR(100) NOT NULL,
  kategori VARCHAR(50) NULL,
  aktif TINYINT(1) NULL DEFAULT 1,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY markalar_isim_key (isim)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS montajlar (
  id INT NOT NULL AUTO_INCREMENT,
  isim VARCHAR(100) NOT NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY montajlar_isim_key (isim)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS printer_settings (
  id INT NOT NULL AUTO_INCREMENT,
  marka VARCHAR(100) NOT NULL,
  config JSON NOT NULL,
  updated_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY printer_settings_marka_key (marka)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS saha_elemanlari (
  id INT NOT NULL AUTO_INCREMENT,
  username VARCHAR(100) NOT NULL,
  password VARCHAR(255) NOT NULL,
  ad_soyad VARCHAR(255) NULL,
  is_active TINYINT(1) NULL DEFAULT 1,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY saha_elemanlari_username_key (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS saha_kayitlari (
  id INT NOT NULL AUTO_INCREMENT,
  saha_elemani_id INT NULL,
  saha_elemani_username VARCHAR(100) NOT NULL,
  isim VARCHAR(255) NOT NULL,
  soyisim VARCHAR(255) NOT NULL,
  foto_url MEDIUMTEXT NULL,
  foto_data LONGTEXT NULL,
  notlar MEDIUMTEXT NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_saha_kayitlari_created_at (created_at),
  KEY idx_saha_kayitlari_created_at_desc (created_at DESC),
  KEY idx_saha_kayitlari_elemani_created (saha_elemani_id, created_at DESC),
  KEY idx_saha_kayitlari_isim (isim),
  KEY idx_saha_kayitlari_saha_elemani_id (saha_elemani_id),
  KEY idx_saha_kayitlari_username (saha_elemani_username),
  CONSTRAINT saha_kayitlari_saha_elemani_id_fkey
    FOREIGN KEY (saha_elemani_id) REFERENCES saha_elemanlari (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS teknisyenler (
  id INT NOT NULL AUTO_INCREMENT,
  isim VARCHAR(100) NOT NULL,
  telefon VARCHAR(20) NULL,
  email VARCHAR(100) NULL,
  aktif TINYINT(1) NULL DEFAULT 1,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY teknisyenler_isim_key (isim)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS urunler (
  id INT NOT NULL AUTO_INCREMENT,
  isim VARCHAR(255) NOT NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;

CREATE TABLE IF NOT EXISTS users (
  id INT NOT NULL AUTO_INCREMENT,
  username VARCHAR(50) NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  is_active TINYINT(1) NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY users_username_key (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
