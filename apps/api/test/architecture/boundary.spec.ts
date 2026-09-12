// REQ-ARCH-01 (docs/04 rule 1+4): cross-context imports may target contracts ONLY.
import { importsOf, listContexts, resolveInternal, walk, MODULES_DIR } from './helpers';
import * as path from 'path';

describe('architecture: module boundaries (contracts only)', () => {
  const contexts = listContexts();

  it('has exactly the 12 locked bounded contexts', () => {
    expect([...contexts].sort()).toEqual(
      [
        'analytics-controltower', 'auction-market', 'catalog-standards', 'claims-support',
        'demand-rfq', 'identity-party', 'logistics-coldchain', 'notifications',
        'order-allocation', 'payments-settlement', 'quality-traceability', 'supply-inventory'
      ].sort()
    );
  });

  it('no context imports another context internal code', () => {
    const violations: string[] = [];
    for (const ctx of contexts) {
      for (const file of walk(path.join(MODULES_DIR, ctx))) {
        for (const spec of importsOf(file)) {
          const resolved = resolveInternal(file, spec);
          if (!resolved) {
            continue;
          }
          const rel = path.relative(MODULES_DIR, resolved);
          if (rel.startsWith('..')) {
            continue;
          }
          const [targetCtx, second] = rel.split(path.sep);
          if (targetCtx !== ctx && second !== 'contracts') {
            violations.push(`${file} -> ${spec} (resolves to ${rel})`);
          }
          if (spec.startsWith('@module/')) {
            // alias always maps to contracts — nothing else is expressible; keep check explicit
            expect(resolved.endsWith(path.join('contracts', 'index.ts'))).toBe(true);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
