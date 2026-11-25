#!/usr/bin/env node
// Статистика research/: утверждения, id, размер — без чтения файлов человеком.
// node tools/research-stats.mjs [--wave N] [--tsv <файл>]
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const waveArg = args.includes('--wave') ? Number(args[args.indexOf('--wave') + 1]) : null;
const tsvOut = args.includes('--tsv') ? args[args.indexOf('--tsv') + 1] : null;

const root = 'research';
const dirs = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
  .map((d) => d.name)
  .sort();

const skip = new Set(['README.md', 'queue.md', 'env-holes.md']);
const LEVELS = ['meta', 'rct', 'cohort', 'case', 'review', 'opinion', 'unsure'];
const pmidRe = /PMID[:\s]*(\d{5,9})\b/g;
const doiRe = /10\.\d{4,9}\/[^\s`"'<>|)\]]+/g;

const countClaims = (body) => {
  const lines = body.split('\n');
  const bullets = lines.filter((l) => /^- \S/.test(l.trim()) || /^\d+\. \S/.test(l.trim()));
  if (bullets.length) return { n: bullets.length, bullets };
  // проза: абзацы вместо списка
  const paras = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith('#'));
  return { n: paras.length, bullets: [] };
};

const rows = [];
const tsv = [];
const pmidFiles = new Map();

for (const date of dirs) {
  const dir = path.join(root, date);
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.md') && !skip.has(n)).sort()) {
    const p = path.join(dir, f);
    const text = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
    const fm = text.slice(0, text.indexOf('\n---', 3));
    const get = (k) => {
      const m = fm.match(new RegExp('^' + k + ':\\s*(.*)$', 'm'));
      return m ? m[1].replace(/^["']|["']$/g, '') : '';
    };
    const passages = [...text.matchAll(/^## Заход (\d+)/gm)].map((m) => Number(m[1]));
    const lastWave = passages.length ? Math.max(...passages) : 0;

    // утверждения: строки "- " и "1. " внутри "### Что нашёл"
    const blocks = text.split(/^#{2,3} /m).filter((b) => b.startsWith('Что нашёл'));
    let claims = 0;
    const claimLines = [];
    for (const b of blocks) {
      const { n, bullets } = countClaims(b.split(/^#{2,3} /m)[0]);
      claims += n;
      for (const t of bullets) claimLines.push(t.replace(/^(- |\d+\. )/, ''));
    }

    const pmids = new Set([...text.matchAll(pmidRe)].map((m) => m[1]));
    const dois = new Set(
      [...text.matchAll(doiRe)].map((m) => m[0].replace(/[.,;:]+$/, '').toLowerCase()),
    );
    for (const id of pmids) {
      const set = pmidFiles.get(id) || new Set();
      set.add(f);
      pmidFiles.set(id, set);
    }

    const bytes = fs.statSync(p).size;
    const inWave = waveArg
      ? (() => {
          const i = text.indexOf('## Заход ' + waveArg);
          if (i === -1) return 0;
          const rest = text.slice(text.indexOf('\n', i));
          const end = rest.search(/^## Заход /m);
          const sec = rest.slice(0, end === -1 ? rest.length : end);
          const wb = sec.split(/^#{2,3} /m).find((b) => b.startsWith('Что нашёл'));
          if (!wb) return 0;
          return countClaims(wb.split(/^#{2,3} /m)[0]).n;
        })()
      : null;

    rows.push({
      file: date + '/' + f,
      lane: get('lane'),
      waves: passages.length,
      lastWave,
      inWave,
      claims,
      pmids: pmids.size,
      dois: dois.size,
      kb: Math.round(bytes / 1024),
      perClaim: claims ? Math.round(bytes / claims) : 0,
    });

    if (tsvOut) {
      for (const c of claimLines) {
        const pm = (c.match(/PMID[:\s]*(\d{5,9})/) || [])[1] || '';
        const dm = (c.match(/10\.\d{4,9}\/[^\s`"'<>|)\]]+/) || [])[0] || '';
        const lv = (LEVELS.find((l) => new RegExp('\\b' + l + '\\b', 'i').test(c)) || '').toLowerCase();
        tsv.push([date + '/' + f, pm, dm, lv, c.replace(/\t/g, ' ')].join('\t'));
      }
    }
  }
}

const pad = (s, n) => String(s).padEnd(n);
const head =
  pad('файл', 52) + pad('lane', 5) + pad('зах.', 5) + pad('утв.', 5) + pad('+волна', 7) +
  pad('PMID', 6) + pad('DOI', 5) + pad('КБ', 4) + 'Б/утв';
console.log(head);
console.log('-'.repeat(head.length));
let T = { claims: 0, pmids: 0, dois: 0, kb: 0, inWave: 0 };
const waveCol = waveArg !== null;
for (const r of rows) {
  console.log(
    pad(r.file, 52) + pad(r.lane, 5) + pad(r.waves, 5) + pad(r.claims, 5) +
      pad(waveCol ? r.inWave : '', 7) + pad(r.pmids, 6) + pad(r.dois, 5) + pad(r.kb, 4) +
      r.perClaim,
  );
  T.claims += r.claims;
  T.pmids += r.pmids;
  T.dois += r.dois;
  T.kb += r.kb;
  T.inWave += r.inWave || 0;
}
console.log('-'.repeat(head.length));
console.log(
  `файлов ${rows.length}: утверждений ${T.claims}, PMID ${T.pmids} (с повторами между файлами), ` +
    `DOI ${T.dois}, ${T.kb} КБ` + (waveCol ? `, волна ${waveArg}: ${T.inWave}` : ''),
);

const dup = [...pmidFiles.entries()].filter(([, s]) => s.size >= 3);
console.log(`PMID в 3+ файлах: ${dup.length}`);
if (dup.length) for (const [id, s] of dup.slice(0, 10)) console.log(`  ${id}: ${[...s].join(', ')}`);

if (waveArg) {
  const over = rows.filter((r) => (r.inWave || 0) > 60);
  if (over.length) console.log('КАП 60 превышен: ' + over.map((r) => r.file).join(', '));
}

if (tsvOut) {
  fs.writeFileSync(tsvOut, tsv.join('\n') + '\n', 'utf8');
  console.log(`TSV: ${tsvOut} (${tsv.length} строк)`);
}
