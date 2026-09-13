#!/usr/bin/env node
// Compares `tsc --noEmit` against a committed per-file baseline.
//
// The project carries 25 pre-existing diagnostics in files unrelated to current work, so a plain
// `tsc --noEmit` gate would fail every pull request. Counting per file rather than in total also
// catches a new offending file when someone fixes one error and introduces another elsewhere.
//
// Run locally with: node scripts/ci/typecheck-baseline.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BASELINE = '.github/typecheck-baseline.txt';

const parse = (text) => new Map(text.split('\n').filter(Boolean).map(line => {
  const [count, file] = line.split('\t');
  return [file, Number(count)];
}));

const typecheck = spawnSync('npx', ['--no-install', 'tsc', '--noEmit'], { encoding: 'utf8' });
const output = `${typecheck.stdout}${typecheck.stderr}`;
const current = new Map();
for (const line of output.split('\n')) {
  const match = line.match(/^([^(\s]+\.tsx?)\(\d+,\d+\): error TS/);
  if (match) current.set(match[1], (current.get(match[1]) ?? 0) + 1);
}

let baseline;
try {
  baseline = parse(readFileSync(BASELINE, 'utf8'));
} catch {
  console.error(`Baseline ausente em ${BASELINE}. Gere com:\n  npm run typecheck 2>&1 | grep -oE '^[^(]+\\.tsx?' | sort | uniq -c | awk '{printf "%s\\t%s\\n", $1, $2}' > ${BASELINE}`);
  process.exit(1);
}

const regressions = [];
for (const [file, count] of current) {
  const allowed = baseline.get(file) ?? 0;
  if (count > allowed) regressions.push(`${file}: ${count} diagnóstico(s), baseline permite ${allowed}`);
}

const total = [...current.values()].reduce((sum, n) => sum + n, 0);
const allowedTotal = [...baseline.values()].reduce((sum, n) => sum + n, 0);

if (regressions.length) {
  console.error('Novos diagnósticos de tipo introduzidos:\n');
  for (const line of regressions) console.error(`  ${line}`);
  console.error('\nSaída completa do tsc:\n');
  console.error(output.split('\n').filter(line => line.includes('error TS')).join('\n'));
  console.error(`\nTotal: ${total} (baseline ${allowedTotal}).`);
  console.error('Corrija o que esta alteração introduziu. Não atualize a baseline para cima.');
  process.exit(1);
}

const improved = [...baseline].filter(([file, count]) => (current.get(file) ?? 0) < count);
if (improved.length) {
  console.log('Diagnósticos corrigidos em relação à baseline:');
  for (const [file, count] of improved) console.log(`  ${file}: ${current.get(file) ?? 0} (era ${count})`);
  console.log(`\nBaixe a baseline num commit próprio para travar o ganho: atualize ${BASELINE}.`);
}
console.log(`Typecheck dentro da baseline: ${total} diagnóstico(s) preexistente(s), limite ${allowedTotal}.`);
