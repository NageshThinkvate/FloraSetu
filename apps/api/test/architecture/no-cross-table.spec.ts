// REQ-ARCH-02 (docs/04 rule 2): no cross-boundary table reads. A context's code may
// reference only its own schemas plus the shared `core` schema.
import * as fs from 'fs';
import * as path from 'path';
import { listContexts, walk, MODULES_DIR } from './helpers';
import ownership from './table-ownership.json';

const SCHEMA_RE = /\b(identity|catalog|supply|demand|auction|ordering|quality|logistics|payments|claims|notifications|analytics)\.[a-z_]+/g;

describe('architecture: no cross-boundary table access', () => {
  it('context code touches only owned schemas (or core)', () => {
    const violations: string[] = [];
    for (const ctx of listContexts()) {
      const owned = new Set((ownership as Record<string, string[]>)[ctx] ?? []);
      for (const file of walk(path.join(MODULES_DIR, ctx))) {
        const content = fs.readFileSync(file, 'utf8');
        let match: RegExpExecArray | null;
        SCHEMA_RE.lastIndex = 0;
        while ((match = SCHEMA_RE.exec(content)) !== null) {
          const schema = match[1];
          if (!owned.has(schema)) {
            violations.push(`${file} references foreign schema ${schema}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
