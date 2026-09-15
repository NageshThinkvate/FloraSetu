// REQ-ARCH-04 (docs/04 rule 5): contracts-level dependency graph must be acyclic.
//
// ADR-010 (OWNER APPROVED): exactly two bidirectional CONTRACT-pair exceptions are
// authorized, because they guard synchronous commercial invariants that must not rely
// on eventually-consistent projections:
//   1. order-allocation <-> supply-inventory  (buyerHasLotAllocation; reserve/release
//      ownership invariants of the accepted Order/Allocation <-> Supply/Inventory design)
//   2. order-allocation <-> logistics-coldchain (hasBlockingException — ADR-002/§21
//      synchronous acceptance/settlement hold guard)
//
// Strict limits (ADR-010): every import crossing an approved pair must resolve to the
// target context's contracts/ barrel. Any other cycle FAILS, including a third context
// joining an approved pair, and any approved-pair edge that crosses outside contracts/.
import { contextOf, importsOf, listContexts, resolveInternal, walk, MODULES_DIR } from './helpers';
import * as path from 'path';

const ADR_010_ALLOWED_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['order-allocation', 'supply-inventory'],
  ['order-allocation', 'logistics-coldchain']
];

function isAllowedPair(a: string, b: string): boolean {
  return ADR_010_ALLOWED_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

describe('architecture: no cyclic context dependencies', () => {
  it('context graph is acyclic except ADR-010 approved contract pairs', () => {
    // from -> to -> resolved evidence files (used to prove contracts-only crossing)
    const edges = new Map<string, Map<string, string[]>>();
    for (const ctx of listContexts()) {
      edges.set(ctx, new Map());
      for (const file of walk(path.join(MODULES_DIR, ctx))) {
        for (const spec of importsOf(file)) {
          const resolved = resolveInternal(file, spec);
          if (!resolved) {
            continue;
          }
          const target = contextOf(resolved);
          if (target && target !== ctx) {
            const inner = edges.get(ctx)!;
            if (!inner.has(target)) {
              inner.set(target, []);
            }
            inner.get(target)!.push(resolved);
          }
        }
      }
    }

    const visiting = new Set<string>();
    const done = new Set<string>();
    const cycles: string[][] = [];
    const visit = (node: string, trail: string[]): void => {
      if (done.has(node)) {
        return;
      }
      if (visiting.has(node)) {
        // trail contains the visiting path; slice from the repeated node to get the pure cycle
        cycles.push([...trail.slice(trail.indexOf(node)), node]);
        return;
      }
      visiting.add(node);
      for (const next of edges.get(node)?.keys() ?? []) {
        visit(next, [...trail, node]);
      }
      visiting.delete(node);
      done.add(node);
    };
    for (const ctx of listContexts()) {
      visit(ctx, []);
    }

    const violations: string[] = [];
    for (const cyc of cycles) {
      const unique = [...new Set(cyc)];
      const closedTwoCycle = cyc[0] === cyc[cyc.length - 1] && unique.length === 2;
      if (!closedTwoCycle || !isAllowedPair(unique[0], unique[1])) {
        violations.push(`unapproved cycle: ${cyc.join(' -> ')}`);
        continue;
      }
      // Approved pair: every leg must cross via the contracts/ barrel only.
      for (let i = 0; i < cyc.length - 1; i++) {
        const [from, to] = [cyc[i], cyc[i + 1]];
        const evidence = edges.get(from)?.get(to) ?? [];
        const outsideContracts = evidence.filter(
          (f) => !f.includes(`${path.sep}contracts${path.sep}`)
        );
        if (outsideContracts.length > 0) {
          violations.push(
            `ADR-010 pair ${from} -> ${to} crosses outside contracts/: ${outsideContracts.join(', ')}`
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
