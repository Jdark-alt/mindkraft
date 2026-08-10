#!/usr/bin/env node
// Stage the app's real design assets into the shim's dist/ so the converter can
// pick them up with package-bounded paths (cfg.cssEntry and cfg.guidelinesGlob
// are both resolved relative to this package and may not escape it).
//
// Nothing here is authored: style.css and the design brief are copied verbatim
// from the repo root, so the design system always ships what the app ships.
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const dist = join(here, 'dist');

mkdirSync(join(dist, 'guidelines'), { recursive: true });

const assets = [
  ['style.css', join(dist, 'mindkraft.css')],
  ['Mindkraft — Design Brief', join(dist, 'guidelines', 'design-brief.md')],
];

for (const [from, to] of assets) {
  const src = join(repoRoot, from);
  copyFileSync(src, to);
  console.log(`  copied ${from} → ${to.slice(here.length + 1)} (${(statSync(to).size / 1024).toFixed(0)} KB)`);
}
