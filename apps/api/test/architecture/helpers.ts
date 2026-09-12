import * as fs from 'fs';
import * as path from 'path';

export const SRC_DIR = path.resolve(__dirname, '..', '..', 'src');
export const MODULES_DIR = path.join(SRC_DIR, 'modules');
export const COMMON_DIR = path.join(SRC_DIR, 'common');

export function listContexts(): string[] {
  return fs.readdirSync(MODULES_DIR).filter((d) => fs.statSync(path.join(MODULES_DIR, d)).isDirectory());
}

export function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const IMPORT_RE = /(?:import|export)\s[^'"]*from\s+['"]([^'"]+)['"]/g;

export function importsOf(file: string): string[] {
  const content = fs.readFileSync(file, 'utf8');
  const result: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = IMPORT_RE.exec(content)) !== null) {
    result.push(match[1]);
  }
  return result;
}

// Resolves an import to a path inside src/ if it is internal; null otherwise (npm deps).
export function resolveInternal(fromFile: string, spec: string): string | null {
  if (spec.startsWith('.')) {
    const base = path.resolve(path.dirname(fromFile), spec);
    for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }
    return null;
  }
  if (spec.startsWith('@module/')) {
    return path.join(MODULES_DIR, spec.slice('@module/'.length), 'contracts', 'index.ts');
  }
  if (spec.startsWith('@common/')) {
    return path.join(COMMON_DIR, spec.slice('@common/'.length));
  }
  return null;
}

export function contextOf(file: string): string | null {
  const rel = path.relative(MODULES_DIR, file);
  if (rel.startsWith('..')) {
    return null;
  }
  return rel.split(path.sep)[0];
}
