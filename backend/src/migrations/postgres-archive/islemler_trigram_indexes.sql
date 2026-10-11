-- ============================================================
-- islemler + atolye: ILIKE '%...%' aramaları için trigram index'leri
-- ============================================================
--
-- NEDEN:
-- Tablo filtrelerinin tamamı `ILIKE '%deger%'` şeklinde çalışıyor
-- (backend/src/routes/islemler.ts GET /). Mevcut `idx_ad_soyad`,
-- `idx_teknisyen_ismi`, `idx_cep_tel` gibi B-tree index'ler bu kalıpta
-- KULLANILAMAZ — planner her seferinde Seq Scan yapar. Aynı sorgunun bir de
-- COUNT(*) versiyonu çalıştığı için tablo sayfa başına iki kez taranır.
--
-- pg_trgm GIN index'leri `%...%` desenlerini gerçekten indeksler.
--
-- NASIL ÇALIŞTIRILIR (CANLI VERİTABANI):
--   psql "$DATABASE_URL" -f islemler_trigram_indexes.sql
--
-- ÖNEMLİ:
--   * `CONCURRENTLY` kullanıldı → tablo yazmaya kapanmaz, uygulama
--     çalışırken güvenle koşar. Bunun karşılığı: her komut daha yavaştır
--     ve TRANSACTION İÇİNDE ÇALIŞTIRILAMAZ (BEGIN/COMMIT ile sarmayın).
--   * Bir komut başarısız olursa geride INVALID bir index kalabilir;
--     `\d islemler` ile kontrol edip `DROP INDEX CONCURRENTLY <ad>;` deyip
--     tekrar deneyin.
--   * 11.000 satırda tamamı bir kaç saniye sürer.
--   * Ek disk maliyeti: kabaca tablo boyutunun %30-60'ı.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- --- islemler: tabloda filtre kutusu olan metin kolonları ---
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_islemler_ad_soyad_trgm
  ON islemler USING GIN (ad_soyad gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_islemler_ilce_trgm
  ON islemler USING GIN (ilce gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_islemler_mahalle_trgm
  ON islemler USING GIN (mahalle gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_islemler_cadde_trgm
  ON islemler USING GIN (cadde gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_islemler_sokak_trgm
  ON islemler USING GIN (sokak gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_islemler_apartman_site_trgm
  ON islemler USING GIN (apartman_site gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_islemler_cep_tel_trgm
  ON islemler USING GIN (cep_tel gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_islemler_yedek_tel_trgm
  ON islemler USING GIN (yedek_tel gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_islemler_urun_trgm
  ON islemler USING GIN (urun gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_islemler_marka_trgm
  ON islemler USING GIN (marka gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_islemler_sikayet_trgm
  ON islemler USING GIN (sikayet gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_islemler_yapilan_islem_trgm
  ON islemler USING GIN (yapilan_islem gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_islemler_teknisyen_trgm
  ON islemler USING GIN (teknisyen_ismi gin_trgm_ops);

-- --- atolye: aynı gerekçe (frontend şu an client-side filtreliyor, ama
-- --- sunucu tarafı aramaya geçildiğinde hazır olsun) ---
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_atolye_musteri_trgm
  ON atolye USING GIN (musteri_ad_soyad gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_atolye_tel_no_trgm
  ON atolye USING GIN (tel_no gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_atolye_seri_no_trgm
  ON atolye USING GIN (seri_no gin_trgm_ops);

-- Planner istatistiklerini tazele
ANALYZE islemler;
ANALYZE atolye;

-- Sonucu doğrula
SELECT tablename, indexname
FROM pg_indexes
WHERE tablename IN ('islemler', 'atolye') AND indexname LIKE '%trgm%'
ORDER BY tablename, indexname;
