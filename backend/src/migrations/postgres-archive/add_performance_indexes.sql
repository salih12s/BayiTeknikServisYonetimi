-- ⚡ PERFORMANCE INDEXES
-- Bu index'ler WHERE ve ORDER BY sorgularını 50-100x hızlandırır

-- 1. İş durumu filtresi (en sık kullanılan)
CREATE INDEX IF NOT EXISTS idx_is_durumu ON islemler(is_durumu);

-- 2. Tarih sıralaması (en yeni en üstte)
CREATE INDEX IF NOT EXISTS idx_full_tarih ON islemler(full_tarih DESC);

-- 3. Teknisyen bazlı sorgular
CREATE INDEX IF NOT EXISTS idx_teknisyen_ismi ON islemler(teknisyen_ismi);

-- 4. Telefon aramaları (müşteri geçmişi için)
CREATE INDEX IF NOT EXISTS idx_cep_tel ON islemler(cep_tel);

-- 5. Composite index (durum + tarih birlikte filtre için)
-- Örnek: "Açık işleri tarihe göre sırala"
CREATE INDEX IF NOT EXISTS idx_durum_tarih ON islemler(is_durumu, full_tarih DESC);

-- 6. Ad soyad araması için
CREATE INDEX IF NOT EXISTS idx_ad_soyad ON islemler(ad_soyad);

-- 7. Yazdırılmamış işler filtresi
CREATE INDEX IF NOT EXISTS idx_yazdirildi ON islemler(yazdirildi);

-- Index'lerin oluşturulduğunu doğrula
SELECT 
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'islemler'
ORDER BY indexname;
