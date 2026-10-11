-- Atölye tablosuna note_no kolonu ekle
ALTER TABLE atolye ADD COLUMN IF NOT EXISTS note_no VARCHAR(100);

-- Index ekle (performans için)
CREATE INDEX IF NOT EXISTS idx_atolye_note_no ON atolye(note_no);
