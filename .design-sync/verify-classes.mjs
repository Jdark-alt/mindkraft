#!/usr/bin/env node
// Guard rail for the shim: every CSS class the shim emits must be part of the
// app's own vocabulary — either styled in style.css, or emitted by the app's
// own markup as a semantic hook (a few are, e.g. `mk-toast-green`, which only
// exists to name the toast's job). A class in neither place means the shim
// invented vocabulary, which renders unstyled in every design built with it.
//
// Run from the repo root:  node .design-sync/verify-classes.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const css = readFileSync(join(repoRoot, 'style.css'), 'utf8');
const markup = ['index.html', 'app.js'].map((f) => readFileSync(join(repoRoot, f), 'utf8')).join('\n');

const defined = new Set();
for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) defined.add(m[1]);

// Classes the app writes into the DOM, styled or not.
const emitted = new Set();
for (const m of markup.matchAll(/class(?:Name)?\s*=\s*["'`]([^"'`]+)["'`]/g)) {
  for (const cls of m[1].split(/\s+/)) if (/^[_a-zA-Z][\w-]*$/.test(cls)) emitted.add(cls);
}
for (const m of markup.matchAll(/classList\.(?:add|remove|toggle|contains)\(\s*'([^']+)'/g)) emitted.add(m[1]);

// The app also builds class names by concatenation — `'mk-toast-' + color`,
// `'gc-badge-' + kind`. Record those literal prefixes so their expansions count
// as app vocabulary too.
// The literal may carry earlier classes too (`'mk-toast mk-toast-' + color`),
// so the prefix is its last whitespace-separated token.
const emittedPrefixes = new Set();
for (const m of markup.matchAll(/['"]([^'"\n]*[\w-]-)['"]\s*\+/g)) {
  const tail = m[1].split(/\s+/).pop();
  if (tail && /^[a-zA-Z][\w-]*-$/.test(tail)) emittedPrefixes.add(tail);
}
const isEmitted = (cls) => emitted.has(cls) || [...emittedPrefixes].some((p) => cls.startsWith(p) && cls !== p);

const srcDir = join(here, 'shim', 'src');
const files = readdirSync(srcDir).filter((f) => /\.tsx?$/.test(f));

// Class names reach the DOM two ways in the shim: string literals inside
// className={...} / cx(...), and template pieces like `gc-${state}`.
const literals = new Set();
const dynamic = [];
for (const file of files) {
  const src = readFileSync(join(srcDir, file), 'utf8');
  for (const m of src.matchAll(/className=(?:"([^"]+)"|\{cx\(([^)]*)\)\})/g)) {
    // Drop comparison operands (`state !== 'default' && …`) — those strings are
    // conditions, never class names.
    const raw = (m[1] ?? m[2] ?? '').replace(/[!=]==?\s*'[^']*'/g, '');
    for (const q of raw.matchAll(/'([^']+)'|"([^"]+)"/g)) {
      const value = q[1] ?? q[2];
      for (const cls of value.split(/\s+/)) if (cls) literals.add(cls);
    }
  }
  // `${prefix}-ring-fill`, `gc-${state}`, `badge-${variant}` and friends
  for (const m of src.matchAll(/`([^`]*\$\{[^`]*)`/g)) dynamic.push({ file, expr: m[0] });
  for (const m of src.matchAll(/className="([^"{}]+)"/g)) {
    for (const cls of m[1].split(/\s+/)) if (cls) literals.add(cls);
  }
}

// Dynamic class names are enumerated by hand here, one entry per template in
// the shim. Keeping the list explicit is the point: adding a template without
// adding its expansions fails this check.
const expansions = [
  ...['1', '2', '3', '4', '5', '6', '7'].map(() => null).filter(Boolean),
  // ring.tsx — `${prefix}-ring-*`
  ...['act', 'gc'].flatMap((p) => ['wrap', 'svg', 'bg', 'done-fill', 'fill', 'label'].map((s) => `${p}-ring-${s}`)),
  // activity-grid.tsx — `gc-${state}`
  ...['done', 'done-multi', 'disabled'].map((s) => `gc-${s}`),
  // chips.tsx — `badge-${variant}` / `gc-badge-${variant}`
  ...['frequency', 'xp', 'negative', 'shield', 'shield-warn', 'counter', 'at-risk', 'penalty', 'streak'].map(
    (v) => `badge-${v}`
  ),
  ...['shield', 'counter', 'challenge', 'alert', 'skip', 'multi'].map((v) => `gc-badge-${v}`),
  // analytics.tsx — `an-stat-${accent}`
  ...['green', 'blue', 'amber', 'coral'].map((a) => `an-stat-${a}`),
  // toast.tsx — `mk-toast-${color}`
  ...['blue', 'green', 'olive', 'red'].map((c) => `mk-toast-${c}`),
  // forms.tsx — `btn-${variant}`
  ...['primary', 'secondary'].map((v) => `btn-${v}`),
];

const checked = [...new Set([...literals, ...expansions])].sort();
const missing = checked.filter((c) => !defined.has(c) && !isEmitted(c));
const hookOnly = checked.filter((c) => !defined.has(c) && isEmitted(c));

console.log(`checked ${checked.length} classes (style.css defines ${defined.size}, app markup emits ${emitted.size})`);
console.log(`dynamic templates found in source: ${dynamic.length}`);
if (hookOnly.length) {
  console.log(`\nunstyled hooks the app also emits (fine): ${hookOnly.map((c) => '.' + c).join(' ')}`);
}
if (missing.length) {
  console.error(`\n✗ ${missing.length} class(es) in neither style.css nor the app's markup:`);
  for (const c of missing) console.error(`   .${c}`);
  process.exit(1);
}
console.log('\n✓ every class the shim emits belongs to the app');
