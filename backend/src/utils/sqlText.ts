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
export function orderByText(column: string): string {
  return (
    `REPLACE(${column}, ' ', '') COLLATE utf8mb4_uca1400_as_cs, ` +
    `${column} COLLATE utf8mb4_uca1400_as_cs`
  );
}
