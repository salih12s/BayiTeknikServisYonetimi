-- Migration: Make musteri_ad_soyad and bayi_adi nullable in atolye table
-- Date: 2025-10-15
-- Description: Allow either musteri_ad_soyad OR bayi_adi to be filled, but at least one is required

-- Make both columns nullable
ALTER TABLE atolye 
ALTER COLUMN musteri_ad_soyad DROP NOT NULL;

ALTER TABLE atolye 
ALTER COLUMN bayi_adi DROP NOT NULL;

-- Add check constraint to ensure at least one is filled
ALTER TABLE atolye 
ADD CONSTRAINT atolye_musteri_or_bayi_check 
CHECK (
  (musteri_ad_soyad IS NOT NULL AND musteri_ad_soyad != '') 
  OR 
  (bayi_adi IS NOT NULL AND bayi_adi != '')
);
