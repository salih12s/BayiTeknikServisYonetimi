/**
 * Toplu fotoğraf taşımasının yerel kayıt defteri.
 *
 * Her satır bir saha kaydının taşıma sonucudur (JSON Lines). Dosyaya yalnızca ekleme
 * yapılır: taşıma yarıda kesilirse o ana kadar yazılanlar geçerlidir ve yeniden
 * çalıştırıldığında kaldığı yerden devam eder. Aynı kayıt için sonraki satır öncekinin
 * yerine geçer (kayıt bu arada canlıda değiştiyse yeniden taşınır).
 */
import fs from 'fs';

export interface RegistryPhoto {
  sort_order: number;
  object_key: string;
  thumb_key: string | null;
  original_name: string | null;
  mime_type: string;
  size_bytes: number;
  thumb_size_bytes: number | null;
  /** Depodaki dosyanın SHA-256 özeti. */
  checksum_sha256: string;
  /** Veritabanındaki orijinalin boyutu (rapor için). */
  original_bytes: number;
  outcome: 'resized' | 'original' | 'unreadable';
}

export interface RegistryEntry {
  kayit_id: number;
  /** Kaynaktaki fotoğraf yükünün parmak izi; değişirse kayıt yeniden taşınır. */
  fingerprint: string;
  migrated_at: string;
  photos: RegistryPhoto[];
  failed: Array<{ sort_order: number; reason: string }>;
}

export interface SourceRecord {
  id: number;
  fingerprint: string;
}

/** Defterin bütün satırları, yazıldıkları sırayla. Dosya yoksa boştur. */
export function readRegistryHistory(file: string): RegistryEntry[] {
  const history: RegistryEntry[] = [];
  if (!fs.existsSync(file)) return history;

  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      history.push(JSON.parse(line) as RegistryEntry);
    } catch {
      // Yazarken kesilmiş (yarım) son satır yok sayılır: o kayıt yeniden taşınır.
      // Ortadaki bozuk satır ise defterin elle bozulduğunu gösterir.
      if (index >= lines.length - 2) return;
      throw new Error(`Kayıt defteri bozuk: ${file} satır ${index + 1}`);
    }
  });
  return history;
}

/** Defteri okur; her kayıt için EN SON satır geçerlidir. Dosya yoksa defter boştur. */
export function readRegistry(file: string): Map<number, RegistryEntry> {
  const entries = new Map<number, RegistryEntry>();
  for (const entry of readRegistryHistory(file)) entries.set(entry.kayit_id, entry);
  return entries;
}

function keysOf(entry: RegistryEntry): string[] {
  return entry.photos.flatMap((photo) =>
    photo.thumb_key ? [photo.object_key, photo.thumb_key] : [photo.object_key],
  );
}

/**
 * Depoda artık hiçbir kaydın kullanmadığı dosyalar: yeniden taşınan kayıtların ESKİ
 * sürümlerine ait olanlar ve (`goneIds`) kaynakta silinmiş kayıtlarınkiler. Bir kaydın
 * geçerli (son) sürümünün kullandığı dosya asla listeye girmez.
 */
export function staleObjectKeys(history: RegistryEntry[], goneIds: number[] = []): string[] {
  const latest = new Map<number, RegistryEntry>();
  for (const entry of history) latest.set(entry.kayit_id, entry);
  const gone = new Set(goneIds);

  const inUse = new Set<string>();
  for (const entry of latest.values()) {
    if (!gone.has(entry.kayit_id)) keysOf(entry).forEach((key) => inUse.add(key));
  }
  const stale = new Set<string>();
  for (const entry of history) {
    for (const key of keysOf(entry)) {
      if (!inUse.has(key)) stale.add(key);
    }
  }
  return [...stale].sort();
}

export function appendRegistry(file: string, entry: RegistryEntry): void {
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

export interface MigrationPlan {
  /** Taşınacak kayıtlar: defterde olmayanlar, kaynağı değişenler, hatalı kalanlar. */
  todo: SourceRecord[];
  /** Daha önce eksiksiz taşınmış, kaynağı değişmemiş kayıt sayısı. */
  done: number;
  /** Defterde olup kaynakta artık fotoğrafı olmayan (silinmiş) kayıtlar. */
  gone: number[];
}

/** Kaynaktaki fotoğraflı kayıtları defterle karşılaştırır. */
export function planMigration(
  source: SourceRecord[],
  registry: Map<number, RegistryEntry>,
): MigrationPlan {
  const todo: SourceRecord[] = [];
  let done = 0;
  for (const record of source) {
    const entry = registry.get(record.id);
    if (entry && entry.fingerprint === record.fingerprint && entry.failed.length === 0) {
      done += 1;
    } else {
      todo.push(record);
    }
  }
  const sourceIds = new Set(source.map((record) => record.id));
  const gone = [...registry.keys()].filter((id) => !sourceIds.has(id)).sort((a, b) => a - b);
  return { todo, done, gone };
}
