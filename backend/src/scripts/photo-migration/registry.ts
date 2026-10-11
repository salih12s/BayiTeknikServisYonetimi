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

/** Defteri okur; her kayıt için EN SON satır geçerlidir. Dosya yoksa defter boştur. */
export function readRegistry(file: string): Map<number, RegistryEntry> {
  const entries = new Map<number, RegistryEntry>();
  if (!fs.existsSync(file)) return entries;

  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    let entry: RegistryEntry;
    try {
      entry = JSON.parse(line) as RegistryEntry;
    } catch {
      // Yazarken kesilmiş (yarım) son satır yok sayılır: o kayıt yeniden taşınır.
      // Ortadaki bozuk satır ise defterin elle bozulduğunu gösterir.
      if (index >= lines.length - 2) return;
      throw new Error(`Kayıt defteri bozuk: ${file} satır ${index + 1}`);
    }
    entries.set(entry.kayit_id, entry);
  });
  return entries;
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
