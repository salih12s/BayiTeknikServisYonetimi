import bcrypt from 'bcryptjs';
import { query } from '../db';
import logger from '../utils/logger';

/**
 * Bayi şifreleri. Müşterinin isteğiyle bütün bayilerin şifresi "123456"dır ve öyle
 * kalır; ama veritabanında DÜZ METİN durmaz, bcrypt ile saklanır (veritabanı kopyası
 * sızsa bile şifre listesi okunamasın, ileride değişen şifreler korunsun).
 */

export const DEFAULT_BAYI_PASSWORD = '123456';
const ROUNDS = 10;

export function isBcryptHash(value: unknown): value is string {
  return typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);
}

export function hashBayiPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

/**
 * Girilen şifre kayıttakiyle eşleşiyor mu? Eski (düz metin) kayıtla eşleşirse `upgrade`
 * doludur: çağıran yeni hash'i kaydeder (giriş yapan bayinin şifresi hemen şifrelenir).
 */
export async function verifyBayiPassword(
  plain: unknown,
  stored: unknown,
): Promise<{ ok: boolean; upgrade?: string }> {
  if (typeof plain !== 'string' || typeof stored !== 'string' || !plain) return { ok: false };
  if (isBcryptHash(stored)) return { ok: await bcrypt.compare(plain, stored) };
  if (plain !== stored) return { ok: false };
  return { ok: true, upgrade: await hashBayiPassword(plain) };
}

/**
 * Düz metin duran bütün bayi şifrelerini bcrypt'e çevirir. Açılışta arka planda bir kez
 * çalışır; tekrar çalışması zararsızdır (yalnızca hâlâ düz metin olanlara dokunur).
 * Kaç bayinin çevrildiğini döndürür.
 */
export async function hashPlaintextBayiPasswords(): Promise<number> {
  const { rows } = await query<{ id: number; password: string | null }>(
    "SELECT id, password FROM bayiler WHERE password IS NULL OR password NOT LIKE '$2%'",
  );
  let changed = 0;
  for (const row of rows) {
    if (isBcryptHash(row.password)) continue;
    const plain = row.password ?? DEFAULT_BAYI_PASSWORD;
    // Koşullu güncelleme: bu arada bayi giriş yapıp şifresini zaten çevirdiyse dokunma.
    const result = await query(
      'UPDATE bayiler SET password = $1 WHERE id = $2 AND (password IS NULL OR password = $3)',
      [await hashBayiPassword(plain), row.id, row.password],
    );
    if (result.rowCount > 0) changed += 1;
  }
  if (changed > 0) logger.info(`Bayi şifreleri şifrelendi (bcrypt): ${changed} bayi`);
  return changed;
}
