// Contact sheet of the zombie previews (.logs/zombies/<id>_<tag>.png) -> .logs/zombies/sheet_<tag>.png
//   node scripts/tools/zombies/sheet.mjs face [cols] [cell width] [cell height]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const dir = path.resolve('.logs/zombies');
const tag = process.argv[2] ?? 'face';
const cols = Number(process.argv[3] ?? 6);
const cw = Number(process.argv[4] ?? 210);
const ch = Number(process.argv[5] ?? 210);
const only = process.argv[6];
const files = fs.readdirSync(dir).filter((f) => f.endsWith(`_${tag}.png`) && !f.startsWith('sheet') && (!only || f.startsWith(only))).sort();
const html = `<body style="margin:0;background:#222;display:grid;grid-template-columns:repeat(${cols},${cw}px);font:11px sans-serif;color:#fff">${files
  .map((f) => `<div style="position:relative;width:${cw}px;height:${ch}px"><img src="${pathToFileURL(path.join(dir, f)).href}" style="width:100%;height:100%;object-fit:cover">${process.env.GRID ? `<div style="position:absolute;inset:0;background-image:linear-gradient(to right,#0f08 1px,transparent 1px),linear-gradient(to bottom,#0f08 1px,transparent 1px),linear-gradient(to right,#ff0c 1px,transparent 1px),linear-gradient(to bottom,#ff0c 1px,transparent 1px);background-size:5% 5%,5% 5%,50% 50%,50% 50%"></div>` : ''}<span style="position:absolute;left:3px;top:2px;background:#000a;padding:0 3px">${f.replace(`_${tag}.png`, '')}</span></div>`)
  .join('')}</body>`;
const page = path.join(dir, `sheet_${tag}.html`);
fs.writeFileSync(page, html);
const rows = Math.ceil(files.length / cols);
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'], defaultViewport: { width: cols * cw, height: rows * ch } });
try {
  const p = await browser.newPage();
  await p.goto(pathToFileURL(page).href, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 800));
  const out = path.join(dir, `sheet_${tag}${only ? `_${only}` : ''}.png`);
  await p.screenshot({ path: out });
  console.log('saved', out, files.length);
} finally {
  await browser.close();
}
