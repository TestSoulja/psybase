#!/usr/bin/env node
/**
 * Страж паритета RU/EN.
 *
 * Сравнивает пары ru.md / en.md в topics/ и for-app/ по тому, что не зависит
 * от языка: заголовки (количество и уровень), числа, PMID, DOI, ссылки,
 * ключи front-matter, наличие раздела «не нашёл».
 *
 * Стиль и смысл не проверяет — ловит молчаливые потери фактов.
 * Зависимостей нет: только Node.
 *
 *   node tools/parity.mjs          # все темы
 *   node tools/parity.mjs паника   # одна тема по слагу
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOTS = ['topics', 'for-app'];
const only = process.argv[2] ?? null;

const URL_RE = /https?:\/\/[^\s)\]"'<>]+/g;
const DOI_RE = /10\.\d{4,9}\/\S+/g;
const PMID_IN_URL_RE = /(?:pubmed\.ncbi\.nlm\.nih\.gov\/|europepmc\.org\/article\/MED\/)(\d{6,9})/g;
const PMID_TEXT_RE = /\bPMID[:\s]+(\d{6,9})/gi;
const NUMBER_RE = /(?<![\w.,-])\d+(?:[.,]\d+)?/g;

// DOI бывает со скобками: 10.1016/S0140-6736(17)32802-7. Шаблон [^\s)]+ режет
// его на первой «)» — ловушка из docs/env.md. Берём всё непробельное и снимаем
// хвостовой мусор разметки и несбалансированные закрывающие скобки.
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

function stripPunct(s) {
  return s.replace(/[.,;:]+$/, '').toLowerCase();
}

function uniqueSorted(list) {
  return [...new Set(list)].sort();
}

function multiset(list) {
  return list.slice().sort();
}

function parse(md) {
  // BOM ломает разбор front-matter: PowerShell и часть редакторов пишут файлы с ним
  md = md.replace(/^\uFEFF/, '');
  const fmMatch = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const fm = {};
  if (fmMatch) {
    for (const line of fmMatch[1].split(/\r?\n/)) {
      const m = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
      if (m) fm[m[1]] = m[2].trim();
    }
  }
  const body = fmMatch ? md.slice(fmMatch[0].length) : md;
  return { fm, body };
}

function extract(body) {
  const urls = uniqueSorted([...body.matchAll(URL_RE)].map((m) => stripPunct(m[0])));
  const dois = uniqueSorted([...body.matchAll(DOI_RE)].map((m) => cleanDoi(m[0]).toLowerCase()));

  const pmids = uniqueSorted([
    ...[...body.matchAll(PMID_IN_URL_RE)].map((m) => m[1]),
    ...[...body.matchAll(PMID_TEXT_RE)].map((m) => m[1]),
  ]);

  const headings = [...body.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm)].map((m) => m[1].length);

  // числа считаем по тексту без ссылок и DOI: там цифры — часть адреса
  const plain = body.replace(URL_RE, ' ').replace(DOI_RE, ' ');
  const numbers = multiset([...plain.matchAll(NUMBER_RE)].map((m) => m[0].replace(',', '.')));

  return { urls, dois, pmids, headings, numbers };
}

function diffSets(a, b, label, problems, where) {
  const onlyA = a.filter((x) => !b.includes(x));
  const onlyB = b.filter((x) => !a.includes(x));
  if (onlyA.length) problems.push(`${where}: ${label} есть в RU, нет в EN — ${onlyA.join(', ')}`);
  if (onlyB.length) problems.push(`${where}: ${label} есть в EN, нет в RU — ${onlyB.join(', ')}`);
}

function checkPair(dir, slug) {
  const where = dir.replace(ROOT, '').replace(/^[\\/]/, '');
  const problems = [];
  const ruPath = join(dir, 'ru.md');
  const enPath = join(dir, 'en.md');

  if (!existsSync(enPath)) {
    problems.push(`${where}: нет en.md (правило «правка RU вместе с EN» не выполнено)`);
    return { where, problems, stats: null };
  }

  const ru = parse(readFileSync(ruPath, 'utf8'));
  const en = parse(readFileSync(enPath, 'utf8'));

  const ruKeys = Object.keys(ru.fm).sort();
  const enKeys = Object.keys(en.fm).sort();
  if (ruKeys.join() !== enKeys.join()) {
    problems.push(`${where}: разные ключи front-matter — RU [${ruKeys.join(', ')}], EN [${enKeys.join(', ')}]`);
  }

  const A = extract(ru.body);
  const B = extract(en.body);

  if (A.headings.length !== B.headings.length) {
    problems.push(`${where}: заголовков RU ${A.headings.length}, EN ${B.headings.length}`);
  }
  const lvlA = A.headings.join(',');
  const lvlB = B.headings.join(',');
  if (lvlA !== lvlB) problems.push(`${where}: разный уровень заголовков — RU [${lvlA}], EN [${lvlB}]`);

  const numA = multiset(A.numbers);
  const numB = multiset(B.numbers);
  if (numA.join() !== numB.join()) {
    const onlyA = numA.filter((x) => !numB.includes(x));
    const onlyB = numB.filter((x) => !numA.includes(x));
    if (onlyA.length) problems.push(`${where}: числа есть в RU, нет в EN — ${onlyA.join(', ')}`);
    if (onlyB.length) problems.push(`${where}: числа есть в EN, нет в RU — ${onlyB.join(', ')}`);
  }

  diffSets(A.pmids, B.pmids, 'PMID', problems, where);
  diffSets(A.dois, B.dois, 'DOI', problems, where);
  diffSets(A.urls, B.urls, 'ссылки', problems, where);

  if (!/^#{1,6}\s*Не нашёл/m.test(ru.body)) problems.push(`${where}: в RU нет раздела «Не нашёл»`);
  if (!/^#{1,6}\s*Not found/im.test(en.body)) problems.push(`${where}: в EN нет раздела «Not found»`);

  return {
    where,
    problems,
    stats: `${A.headings.length} заголовков, ${A.numbers.length} чисел, ${A.pmids.length} PMID, ${A.dois.length} DOI, ${A.urls.length} ссылок`,
  };
}

function collect() {
  const pairs = [];
  for (const root of ROOTS) {
    const abs = join(ROOT, root);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      const dir = join(abs, name);
      if (!statSync(dir).isDirectory()) continue;
      if (name.startsWith('.')) continue;
      if (only && name !== only) continue;
      if (!existsSync(join(dir, 'ru.md'))) continue;
      pairs.push({ dir, slug: name });
    }
  }
  return pairs;
}

const pairs = collect();
if (!pairs.length) {
  console.log(only ? `нет темы «${only}» с ru.md` : 'нет ни одной темы — проверять нечего');
  process.exit(only ? 1 : 0);
}

let failed = 0;
for (const { dir } of pairs) {
  const { where, problems, stats } = checkPair(dir);
  if (problems.length) {
    failed++;
    console.log(`✖ ${where}`);
    for (const p of problems) console.log(`   ${p}`);
  } else {
    console.log(`✔ ${where} — паритет: ${stats}`);
  }
}

console.log(failed ? `\nпровалено пар: ${failed} из ${pairs.length}` : `\nвсе пары в порядке: ${pairs.length}`);
process.exit(failed ? 1 : 0);
