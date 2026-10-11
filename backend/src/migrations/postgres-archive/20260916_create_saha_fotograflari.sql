-- R2 fotoğraf metadata tablosu.
-- Bu migration yalnızca yeni tabloyu oluşturur; eski foto_data kolonuna dokunmaz.
-- Taşıma script'i doğrulama tamamlanana kadar foto_data'yı silmez.

CREATE TABLE IF NOT EXISTS saha_fotograflari (
  id BIGSERIAL PRIMARY KEY,
  saha_kaydi_id INTEGER NOT NULL
    REFERENCES saha_kayitlari(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT,
  mime_type VARCHAR(100) NOT NULL DEFAULT 'image/jpeg',
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256 CHAR(64),
  sort_order SMALLINT NOT NULL DEFAULT 0
    CHECK (sort_order >= 0 AND sort_order <= 4),
  source VARCHAR(20) NOT NULL DEFAULT 'r2'
    CHECK (source IN ('r2', 'legacy')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  migrated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_saha_fotograflari_kayit_sira
  ON saha_fotograflari (saha_kaydi_id, sort_order);

CREATE INDEX IF NOT EXISTS ix_saha_fotograflari_kayit
  ON saha_fotograflari (saha_kaydi_id);

CREATE INDEX IF NOT EXISTS ix_saha_fotograflari_checksum
  ON saha_fotograflari (checksum_sha256)
  WHERE checksum_sha256 IS NOT NULL;

COMMENT ON TABLE saha_fotograflari IS
  'Cloudflare R2 object key ve fotoğraf metadata; binary içerik PostgreSQL''de tutulmaz.';
COMMENT ON COLUMN saha_fotograflari.object_key IS
  'Private R2 bucket içindeki anahtar; signed URL üretmek için kullanılır.';
COMMENT ON COLUMN saha_fotograflari.source IS
  'r2 yeni yükleme, legacy foto_data kolonundan taşınmış kayıt.';
