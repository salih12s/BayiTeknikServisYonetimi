-- Atölye tablosuna note_no sütunu ekle
ALTER TABLE atolye ADD COLUMN IF NOT EXISTS note_no VARCHAR(100);
