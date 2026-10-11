-- Bayilere gönderilen "kayıt linki". Linki açan kişi giriş yapmadan yeni işlem kaydı
-- doldurur; kayıt doğrudan işlem listesine düşer ve hangi bayiden geldiği belli olur.
--
-- Her bayinin en çok bir geçerli linki vardır. Link yenilenince eskisi çalışmaz; satır
-- silinince link iptal olur. Bilerek AYRI tablodur: bayiler tablosunun kolonları eski
-- sistemle birebir aynı kalır (veri kopyalama aracı kolonları karşılaştırır) ve veri
-- yeniden kopyalandığında bayilere gönderilmiş linkler geçerliliğini korur.

CREATE TABLE IF NOT EXISTS bayi_kayit_linkleri (
  bayi_id INT NOT NULL,
  token CHAR(43) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (bayi_id),
  UNIQUE KEY bayi_kayit_linkleri_token_key (token),
  CONSTRAINT bayi_kayit_linkleri_bayi_id_fkey
    FOREIGN KEY (bayi_id) REFERENCES bayiler (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin;
