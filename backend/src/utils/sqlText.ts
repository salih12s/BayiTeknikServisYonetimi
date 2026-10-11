/**
 * Metin kolonunu eski PostgreSQL kurulumunun (en_US.utf8) sırasıyla sıralayan
 * ORDER BY ifadesi.
 *
 * Kolonlar harfi harfine karşılaştırılsın diye utf8mb4_nopad_bin ile tanımlıdır; o
 * kuralla sıralama "Z"yi "a"dan, "Ç"yi "Z"den sonraya koyar. PostgreSQL ise harfleri
 * dil kurallarına göre dizer ve ilk karşılaştırmada boşlukları yok sayar
 * ("ALFAMODA", "ALFA TİCARET"ten önce gelir). Bu ifade, canlıdaki sıralı sekiz
 * listenin tamamında aynı sırayı verdiği ölçülerek seçildi (2026-10-11).
 */
/**
 * Aramada harf büyüklüğünü VE Türkçe noktalı/noktasız i ayrımını yok sayan SQL ifadesi.
 *
 * Veritabanının LOWER'ı Türkçe bilmez: 'IŞIK' -> 'işik' olur, kullanıcının yazdığı
 * 'ışık' ise olduğu gibi kalır ve eşleşmez (büyük harfle yazınca bulunur, küçük harfle
 * bulunmaz). Burada I, İ, ı ve i (ve JavaScript'in ürettiği "i + birleşen nokta")
 * hepsi tek bir harfe indirgenir; arama ikisini ayırt etmez.
 */
export function foldSql(expression: string): string {
  return `REPLACE(REPLACE(LOWER(${expression}), 'i̇', 'i'), 'ı', 'i')`;
}

/** `kolon LIKE $n` karşılığı: iki taraf da foldSql ile indirgenir. */
export function likeFold(column: string, paramIndex: number): string {
  return `${foldSql(column)} LIKE ${foldSql(`$${paramIndex}`)}`;
}

/** `kolon = $n` karşılığı: iki taraf da foldSql ile indirgenir. */
export function equalsFold(column: string, paramIndex: number): string {
  return `${foldSql(column)} = ${foldSql(`$${paramIndex}`)}`;
}

export function orderByText(column: string): string {
  return (
    `REPLACE(${column}, ' ', '') COLLATE utf8mb4_uca1400_as_cs, ` +
    `${column} COLLATE utf8mb4_uca1400_as_cs`
  );
}
