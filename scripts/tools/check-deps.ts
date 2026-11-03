/**
 * 依赖方向检查：扫描 src/ 下所有 import，违反规则就以非 0 退出。
 *   game/   不得 import render/ audio/ app/ ui/ three vue
 *   render/ 不得 import ui/ app/ audio/
 *   audio/  只能 import game/（以及自己）
 *   ui/     不得 import render/（要的数据通过 ui/hud.ts 快照）
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('src');

interface Rule {
  dir: string;
  banned: string[];
  /** 允许的第三方包（不写就不限制） */
  packages?: string[];
}

const RULES: Rule[] = [
  { dir: 'game', banned: ['render', 'audio', 'app', 'ui'], packages: [] },
  { dir: 'render', banned: ['ui', 'app', 'audio'] },
  { dir: 'audio', banned: ['render', 'app', 'ui'], packages: [] },
  { dir: 'ui', banned: ['render'] },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|vue)$/.test(e.name)) out.push(p);
  }
  return out;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;

/** 返回 import 指向的顶层目录（game / render / …），第三方包返回 'pkg:名字' */
function targetOf(file: string, spec: string): string {
  if (spec.startsWith('@/')) return spec.slice(2).split('/')[0] as string;
  if (spec.startsWith('.')) {
    const abs = path.resolve(path.dirname(file), spec);
    const rel = path.relative(root, abs).split(path.sep);
    return rel[0] === '..' ? 'outside' : (rel.length > 1 ? (rel[0] as string) : '(root)');
  }
  const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : (spec.split('/')[0] as string);
  return name.startsWith('node:') ? 'pkg:node' : `pkg:${name}`;
}

let violations = 0;
let scanned = 0;
for (const file of walk(root)) {
  const rel = path.relative(root, file).split(path.sep);
  const top = rel.length > 1 ? (rel[0] as string) : '(root)';
  const rule = RULES.find((r) => r.dir === top);
  if (!rule) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = (m[1] ?? m[2] ?? m[3]) as string;
    scanned++;
    const t = targetOf(file, spec);
    let bad = false;
    if (t.startsWith('pkg:')) bad = rule.packages !== undefined && !rule.packages.includes(t.slice(4));
    else bad = rule.banned.includes(t) || t === 'outside';
    if (bad) {
      violations++;
      console.log(`FAIL  src/${rel.join('/')} → ${spec}   （${top}/ 不得依赖 ${t.replace('pkg:', '包 ')}）`);
    }
  }
}
console.log(`扫描 ${scanned} 条 import，违规 ${violations} 条`);
if (violations) process.exit(1);
