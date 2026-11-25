#!/usr/bin/env node
/**
 * Индекс источников: идентификатор → где упомянут → проверен ли.
 *
 * Зачем: спринт пишет сырьё в research/, а проверка PMID/DOI стоит времени
 * (Europe PMC ~1 с, 194 id ~4 минуты). Если идентификатор уже проверен и на
 * него есть карточка в sources/, его не проверяют заново — берут из карточки.
 *
 * Откуда берётся «проверен»: только из карточки sources/<slug>.md с полем
 * accessed (см. docs/schema.md). Файл research/ — сырьё, он сам ничего не
 * подтверждает: строка в research/ значит «упомянут», а не «проверен».
 *
 * Сети скрипт не касается: это чтение диска, а не проверка.
 *
 *   node tools/sources-index.mjs                  # все идентификаторы
 *   node tools/sources-index.mjs 35048835         # один PMID
 *   node tools/sources-index.mjs 10.1192/bjp.2021.90
 *   node tools/sources-index.mjs https://pubmed.ncbi.nlm.nih.gov/35048835/
 *
 * Коды возврата: 0 — всё, что просили, найдено; 1 — аргумент нигде не
 * упомянут; 2 — аргумент не похож ни на PMID, ни на DOI.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCAN = ['research', 'sources'];

const PMID_IN_URL_RE = /(?:pubmed\.ncbi\.nlm\.nih\.gov\/|europepmc\.org\/article\/MED\/)(\d{6,9})/g;
const PMID_TEXT_RE = /\bPMID[:\s]+(\d{6,9})/gi;
const DOI_RE = /10\.\d{4,9}\/\S+/g;

// DOI бывает со скобками: 10.1016/S0140-6736(17)32802-7. Шаблон [^\s)]+ режет
// его на первой «)» — на этом уже теряли время (docs/env.md, ловушка 1).
// Поэтому берём всё непробельное и снимаем только хвостовой мусор разметки и
// несбалансированные закрывающие скобки.
function cleanDoi(raw) {
  let d = raw;
  for (;;) {
    const before = d;
    d = d.replace(/[.,;:'"\]>`*]+$/, '');
    if (d.endsWith(')')) {
      const open = (d.match(/\(/g) ?? []).length;
      const close = (d.match(/\)/g) ?? []).length;
      if (close > open) d = d.slice(0, -1);
    }
    if (d === before) break;
  }
  return d;
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

function collect() {
  const mentions = new Map(); // id → [{file, line, text}]
  const cards = new Map(); // id → {file, accessed}

  for (const root of SCAN) {
    for (const file of walk(join(ROOT, root))) {
      const rel = relative(ROOT, file).split(sep).join('/');
      const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
      const isCard = rel.startsWith('sources/');
      const accessed = isCard ? (text.match(/^accessed:\s*(\S+)/m)?.[1] ?? null) : null;

      text.split(/\r?\n/).forEach((line, i) => {
        const ids = new Set();
        for (const m of line.matchAll(PMID_IN_URL_RE)) ids.add(`PMID ${m[1]}`);
        for (const m of line.matchAll(PMID_TEXT_RE)) ids.add(`PMID ${m[1]}`);
        for (const m of line.matchAll(DOI_RE)) ids.add(`DOI ${cleanDoi(m[0]).toLowerCase()}`);

        for (const id of ids) {
          if (!mentions.has(id)) mentions.set(id, []);
          mentions.get(id).push({ file: rel, line: i + 1, text: line.trim() });
          if (isCard && accessed) cards.set(id, { file: rel, accessed });
        }
      });
    }
  }

  return { mentions, cards };
}

function normalize(arg) {
  const a = arg.trim();
  const pmidUrl = a.match(/(?:pubmed\.ncbi\.nlm\.nih\.gov\/|europepmc\.org\/article\/MED\/)(\d{6,9})/);
  if (pmidUrl) return `PMID ${pmidUrl[1]}`;

  if (/^\d{6,9}$/.test(a)) return `PMID ${a}`;

  const pmidText = a.match(/^PMID[:\s]*(\d{6,9})$/i);
  if (pmidText) return `PMID ${pmidText[1]}`;

  const doiUrl = a.match(/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/\S+)$/i);
  if (doiUrl) return `DOI ${cleanDoi(doiUrl[1]).toLowerCase()}`;

  if (/^10\.\d{4,9}\//.test(a)) return `DOI ${cleanDoi(a).toLowerCase()}`;

  return null;
}

function statusOf(id, cards) {
  const card = cards.get(id);
  return card ? `проверен — ${card.file} (accessed ${card.accessed})` : 'не проверен — карточки нет';
}

const { mentions, cards } = collect();
const args = process.argv.slice(2);

if (!mentions.size) {
  console.log('в research/ и sources/ нет ни одного PMID или DOI');
  process.exit(args.length ? 1 : 0);
}

if (!args.length) {
  const ids = [...mentions.keys()].sort();
  const verified = ids.filter((id) => cards.has(id)).length;
  console.log(`идентификаторов: ${ids.length}, с карточкой: ${verified}\n`);
  for (const id of ids) {
    const where = mentions.get(id);
    const files = [...new Set(where.map((m) => m.file))];
    console.log(`${id} · ${where.length} упом. в ${files.length} файл. · ${statusOf(id, cards)}`);
  }
  process.exit(0);
}

let missing = 0;
for (const arg of args) {
  const id = normalize(arg);
  if (!id) {
    console.error(`✖ «${arg}» не похож ни на PMID, ни на DOI`);
    missing++;
    continue;
  }
  const where = mentions.get(id);
  if (!where) {
    console.log(`✖ ${id} — нигде не упомянут (research/ и sources/ просмотрены)`);
    missing++;
    continue;
  }
  const files = [...new Set(where.map((m) => m.file))];
  console.log(`✔ ${id} — ${where.length} упом. в ${files.length} файл.`);
  console.log(`   ${statusOf(id, cards)}`);
  for (const m of where) console.log(`   ${m.file}:${m.line}  ${m.text.slice(0, 160)}`);
}
process.exit(missing ? 1 : 0);
