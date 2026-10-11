-- Atolye tablosunda tel_no, bayi_adi ve musteri_ad_soyad'ı nullable yap
ALTER TABLE atolye ALTER COLUMN tel_no DROP NOT NULL;
ALTER TABLE atolye ALTER COLUMN bayi_adi DROP NOT NULL;
ALTER TABLE atolye ALTER COLUMN musteri_ad_soyad DROP NOT NULL;
