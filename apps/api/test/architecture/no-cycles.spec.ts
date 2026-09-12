// REQ-ARCH-04 (docs/04 rule 5): contracts-level dependency graph must be acyclic.
import { contextOf, importsOf, listContexts, resolveInternal, walk, MODULES_DIR } from './helpers';
import * as path from 'path';

describe('architecture: no cyclic context dependencies', () => {
  it('context graph is acyclic', () => {
    const edges = new Map<string, Set<string>>();
    for (const ctx of listContexts()) {
      edges.set(ctx, new Set());
      for (const file of walk(path.join(MODULES_DIR, ctx))) {
        for (const spec of importsOf(file)) {
          const resolved = resolveInternal(file, spec);
          if (!resolved) {
            continue;
          }
          const target = contextOf(resolved);
          if (target && target !== ctx) {
            edges.get(ctx)!.add(target);
          }
        }
      }
    }
    const visiting = new Set<string>();
    const done = new Set<string>();
    const cycle: string[] = [];
    const visit = (node: string, trail: string[]): void => {
      if (done.has(node)) {
        return;
      }
      if (visiting.has(node)) {
        cycle.push([...trail, node].join(' -> '));
        return;
      }
      visiting.add(node);
      for (const next of edges.get(node) ?? []) {
        visit(next, [...trail, node]);
      }
      visiting.delete(node);
      done.add(node);
    };
    for (const ctx of listContexts()) {
      visit(ctx, []);
    }
    expect(cycle).toEqual([]);
  });
});
