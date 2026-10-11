import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { RegistryEntry, appendRegistry, planMigration, readRegistry } from './registry';

function entry(kayitId: number, fingerprint: string, failed: RegistryEntry['failed'] = []): RegistryEntry {
  return { kayit_id: kayitId, fingerprint, migrated_at: '2026-10-11T00:00:00.000Z', photos: [], failed };
}

describe('kayıt defteri', () => {
  let dir: string;
  let file: string;

  // Her test kendi geçici klasöründe çalışır (isolation).
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2-defter-'));
    file = path.join(dir, 'defter.jsonl');
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('dosya yoksa defter boştur', () => {
    assert.equal(readRegistry(file).size, 0);
  });

  it('eklenen kayıtlar okunur; aynı kayıt için son satır geçerlidir', () => {
    appendRegistry(file, entry(1, 'a'));
    appendRegistry(file, entry(2, 'b'));
    appendRegistry(file, entry(1, 'a2'));

    const registry = readRegistry(file);
    assert.equal(registry.size, 2);
    assert.equal(registry.get(1)?.fingerprint, 'a2');
    assert.equal(registry.get(2)?.fingerprint, 'b');
  });

  it('yazarken kesilmiş (yarım) son satır yok sayılır', () => {
    appendRegistry(file, entry(1, 'a'));
    fs.appendFileSync(file, '{"kayit_id":2,"finger');
    const registry = readRegistry(file);
    assert.deepEqual([...registry.keys()], [1]);
  });

  it('ortadaki bozuk satır hatadır (defter elle bozulmuş)', () => {
    appendRegistry(file, entry(1, 'a'));
    fs.appendFileSync(file, 'bozuk satır\n');
    appendRegistry(file, entry(2, 'b'));
    assert.throws(() => readRegistry(file), /satır 2/);
  });
});

describe('planMigration', () => {
  const registry = new Map<number, RegistryEntry>([
    [1, entry(1, 'a')],
    [2, entry(2, 'eski')],
    [3, entry(3, 'c', [{ sort_order: 0, reason: 'x' }])],
    [9, entry(9, 'silinmis')],
  ]);

  it('taşınmamış, değişmiş ve hatalı kayıtlar yeniden taşınır; tamam olanlar atlanır', () => {
    const plan = planMigration(
      [
        { id: 1, fingerprint: 'a' },
        { id: 2, fingerprint: 'yeni' },
        { id: 3, fingerprint: 'c' },
        { id: 4, fingerprint: 'd' },
      ],
      registry,
    );
    assert.equal(plan.done, 1);
    assert.deepEqual(plan.todo.map((record) => record.id), [2, 3, 4]);
    assert.deepEqual(plan.gone, [9]);
  });

  it('boş defterde her şey taşınır; boş kaynakta yapılacak iş yoktur', () => {
    assert.equal(planMigration([{ id: 1, fingerprint: 'a' }], new Map()).todo.length, 1);
    const plan = planMigration([], registry);
    assert.deepEqual(plan.todo, []);
    assert.deepEqual(plan.gone, [1, 2, 3, 9]);
  });
});
