// 搬文件并自动改写所有相对 import。
// 用法：node scripts/tools/relocate.mjs moves.json   （moves.json: [["src/a.ts","src/b/a.ts"], ...]）
// 只处理 src/ 和 scripts/ 里的 .ts / .vue / .mjs；目录 import（index.ts）也能识别。
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const moves = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const abs = (p) => path.resolve(root, p);
const moveMap = new Map(moves.map(([a, b]) => [abs(a), abs(b)]));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|vue|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = [...walk(abs('src')), ...walk(abs('scripts'))];

function resolveSpec(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const c of [base, base + '.ts', base + '.vue', base + '.mjs', path.join(base, 'index.ts')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

const newPathOf = (f) => moveMap.get(f) ?? f;
const re = /((?:from|import)\s*\(?\s*)(['"])(\.{1,2}\/[^'"]+)\2/g;
const rewrites = new Map();
let changed = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const nf = newPathOf(f);
  const out = src.replace(re, (m, pre, q, spec) => {
    const target = resolveSpec(f, spec);
    if (!target) {
      console.warn(`unresolved ${spec} in ${path.relative(root, f)}`);
      return m;
    }
    const nt = newPathOf(target);
    let rel;
    const isIndex = path.basename(target) === 'index.ts' && !spec.endsWith('index') && !spec.endsWith('index.ts');
    if (isIndex) rel = path.relative(path.dirname(nf), path.dirname(nt));
    else {
      rel = path.relative(path.dirname(nf), nt);
      // 保留原来的写法：原来没写扩展名就去掉 .ts
      const hadExt = /\.(ts|vue|mjs)$/.test(spec);
      if (!hadExt) rel = rel.replace(/\.ts$/, '');
    }
    rel = rel.split(path.sep).join('/');
    if (!rel.startsWith('.')) rel = './' + rel;
    if (rel === spec) return m;
    changed++;
    return `${pre}${q}${rel}${q}`;
  });
  if (out !== src) rewrites.set(f, out);
}
for (const [f, text] of rewrites) fs.writeFileSync(f, text);
for (const [a, b] of moveMap) {
  fs.mkdirSync(path.dirname(b), { recursive: true });
  fs.renameSync(a, b);
}
// 清掉搬空的目录
for (const [a] of moveMap) {
  let d = path.dirname(a);
  while (d.startsWith(abs('src')) || d.startsWith(abs('scripts'))) {
    if (fs.existsSync(d) && fs.readdirSync(d).length === 0) fs.rmdirSync(d);
    else break;
    d = path.dirname(d);
  }
}
console.log(`moved ${moveMap.size} files, rewrote ${changed} imports in ${rewrites.size} files`);
