-- Saha Kayıtları Performans İndeksleri
-- Amaç: Yüksek hacimli saha_kayitlari tablosunda hızlı pagination,
-- arama (ILIKE / %x%), bugün filtresi ve JOIN performansı sağlamak.

-- 1) pg_trgm extension: "%kelime%" LIKE sorguları için GIN trigram index.
--    Çok büyük fark yaratır: LIKE '%abc%' artık index kullanır.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2) Saha kullanıcısı ana sorgusu için composite index:
--    WHERE saha_elemani_id = $1 ORDER BY created_at DESC LIMIT ...
--    B-tree ASC/DESC iki yönde de çalışır, sorun değil.
CREATE INDEX IF NOT EXISTS idx_saha_kayitlari_elemani_created
  ON saha_kayitlari(saha_elemani_id, created_at DESC);

-- 3) Admin "tüm kayıtlar" sorgusu için created_at üzerinde DESC index.
--    (Varsa zaten iş görüyor; idempotent.)
CREATE INDEX IF NOT EXISTS idx_saha_kayitlari_created_at_desc
  ON saha_kayitlari(created_at DESC);

-- 4) Arama için trigram GIN indexleri (isim, soyisim, notlar).
--    Büyük/küçük harf hassasiyeti için LOWER() üzerine expression index.
CREATE INDEX IF NOT EXISTS idx_saha_kayitlari_isim_trgm
  ON saha_kayitlari USING GIN (LOWER(isim) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_saha_kayitlari_soyisim_trgm
  ON saha_kayitlari USING GIN (LOWER(soyisim) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_saha_kayitlari_notlar_trgm
  ON saha_kayitlari USING GIN (LOWER(COALESCE(notlar, '')) gin_trgm_ops);

-- 5) saha_elemani_username üzerinde arama/eşitlik için (admin tarafı / user-kayitlar):
CREATE INDEX IF NOT EXISTS idx_saha_kayitlari_username
  ON saha_kayitlari(saha_elemani_username);

-- 6) Planner istatistiklerini güncelle (ufak tablolarda hızlıdır, büyükte de hızlıca biter).
ANALYZE saha_kayitlari;
