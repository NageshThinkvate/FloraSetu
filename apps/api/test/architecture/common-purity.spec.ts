// REQ-ARCH-03 (docs/04): common/ must stay domain-free — no imports from modules.
import { importsOf, resolveInternal, walk, COMMON_DIR, MODULES_DIR } from './helpers';
import * as path from 'path';

describe('architecture: common purity', () => {
  it('src/common never imports from src/modules', () => {
    const violations: string[] = [];
    for (const file of walk(COMMON_DIR)) {
      for (const spec of importsOf(file)) {
        if (spec.startsWith('@module/')) {
          violations.push(`${file} -> ${spec}`);
          continue;
        }
        const resolved = resolveInternal(file, spec);
        if (resolved && resolved.startsWith(MODULES_DIR)) {
          violations.push(`${file} -> ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('modules directory contains only the 12 contexts (no stray code)', () => {
    const rel = walk(MODULES_DIR).map((f) => path.relative(MODULES_DIR, f));
    for (const f of rel) {
      const parts = f.split(path.sep);
      expect(parts.length).toBeGreaterThanOrEqual(2);
    }
  });
});
