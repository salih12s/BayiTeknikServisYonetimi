import logger from '../utils/logger';

/**
 * Bilet (JWT) 24 saat geçerlidir. Hesap bu arada pasif yapılır ya da silinirse elindeki
 * bilet de hemen geçersiz olmalıdır; bu yüzden her istekte hesabın hâlâ var ve aktif
 * olduğu kontrol edilir. Veritabanını yormamak için sonuç 60 sn saklanır; pasif yapma ve
 * silme işlemleri saklanan sonucu hemen siler (forgetAccountStatus).
 */

const CACHE_MS = 60_000;
const cache = new Map<string, { active: boolean; at: number }>();

/** Rol başına "hesap var ve aktif mi" sorgusu. Pasif olabilen hesaplarda is_active de bakılır. */
const LOOKUP_SQL: Record<string, string> = {
  admin: 'SELECT 1 AS ok FROM admins WHERE id = $1',
  user: 'SELECT 1 AS ok FROM users WHERE id = $1 AND COALESCE(is_active, 1) = 1',
  saha: 'SELECT 1 AS ok FROM saha_elemanlari WHERE id = $1 AND COALESCE(is_active, 1) = 1',
  bayi: 'SELECT 1 AS ok FROM bayiler WHERE id = $1',
};

type Lookup = (role: string, id: number) => Promise<boolean>;

const databaseLookup: Lookup = async (role, id) => {
  const sql = LOOKUP_SQL[role];
  if (!sql) return false; // rolü olmayan / bilinmeyen eski bilet
  // Veritabanı modülü ilk sorguda yüklenir: içe aktarıldığı anda bağlantı açar ve
  // veritabanı gerektirmeyen testleri bekletirdi.
  const { query } = await import('../db');
  const result = await query(sql, [id]);
  return result.rows.length > 0;
};

let lookup: Lookup = databaseLookup;

/**
 * Yalnızca testler için: hesap durumunu veritabanı yerine sahte bir fonksiyondan al
 * (Fake). Argümansız çağrı gerçek veritabanı sorgusuna döner.
 */
export function setAccountLookupForTests(fake?: Lookup): void {
  lookup = fake ?? databaseLookup;
  cache.clear();
}

export async function isAccountActive(role: string | undefined, id: number | undefined): Promise<boolean> {
  if (!role || typeof id !== 'number') return false;
  const key = `${role}:${id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.active;
  try {
    const active = await lookup(role, id);
    cache.set(key, { active, at: Date.now() });
    if (cache.size > 5000) cache.clear();
    return active;
  } catch (error) {
    // Veritabanına o an ulaşılamıyorsa kullanıcıyı kilitlemeyiz; isteğin kendisi zaten
    // veritabanı gerektirdiği için hata verecektir.
    logger.warn('Hesap durumu kontrol edilemedi:', (error as Error).message);
    return true;
  }
}

/** Hesap pasif yapıldı / silindi: saklanan sonucu hemen unut (bilet anında geçersiz olsun). */
export function forgetAccountStatus(role: string, id: number): void {
  cache.delete(`${role}:${id}`);
}
