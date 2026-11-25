#!/usr/bin/env node
/**
 * Страж паритета RU/EN.
 *
 * Сравнивает пары ru.md / en.md в topics/, for-app/ и pages/ по тому, что не зависит
 * от языка: заголовки (количество и уровень), числа, PMID, DOI, ссылки,
 * ключи front-matter, наличие раздела «не нашёл».
 *
 * Файл без en.md — не ошибка, а долг перевода: он идёт в счёт «без перевода»
 * отдельно по корням, чтобы темы и страницы каталога не смешивались.
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
const ROOTS = ['topics', 'for-app', 'pages'];
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

// Числа блока chart считаются отдельно (их сверяет checkCharts): иначе число,
// оставшееся в графике, прикрывает пропажу того же числа из прозы.
const CHART_BLOCK_RE = /```chart\r?\n[\s\S]*?```/g;

// Набор чисел текста: без ссылок и DOI, где цифры — часть адреса.
// Тире между цифрами — разделитель диапазона, а не минус: «5-10», «5–10»
// и «5 − 10» дают один и тот же набор, иначе дефис в EN против тире в RU
// выглядел бы как потеря числа.
function numbersIn(body) {
  const plain = body
    .replace(URL_RE, ' ')
    .replace(DOI_RE, ' ')
    .replace(/(\d)\s*[-–—−]\s*(\d)/g, '$1–$2');
  return multiset([...plain.matchAll(NUMBER_RE)].map((m) => m[0].replace(',', '.')));
}

// Разделы «##»: числа сравниваются по разделам, а не общей кучей — иначе число,
// переехавшее из одного утверждения в другое, выглядит как паритет.
function sectionsOf(body) {
  const out = [];
  const parts = body.split(/^##[ \t]+/m);
  out.push({ title: '', text: parts.shift() ?? '' });
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const title = (nl < 0 ? part : part.slice(0, nl)).trim();
    const text = nl < 0 ? '' : part.slice(nl + 1);
    out.push({ title, text });
  }
  return out;
}

function extract(body) {
  const urls = uniqueSorted([...body.matchAll(URL_RE)].map((m) => stripPunct(m[0])));
  const dois = uniqueSorted([...body.matchAll(DOI_RE)].map((m) => cleanDoi(m[0]).toLowerCase()));

  const pmids = uniqueSorted([
    ...[...body.matchAll(PMID_IN_URL_RE)].map((m) => m[1]),
    ...[...body.matchAll(PMID_TEXT_RE)].map((m) => m[1]),
  ]);

  const headings = [...body.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm)].map((m) => m[1].length);

  const numbers = numbersIn(body.replace(CHART_BLOCK_RE, ' '));

  return { urls, dois, pmids, headings, numbers };
}

// ```chart в тексте: значения сравниваются и как обычные числа (они попадают
// в общий набор), и структурно — тип, число значений, подписи, источник.
function chartBlocks(body) {
  const out = [];
  const re = /```chart\r?\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(body))) {
    const data = { type: '', values: [], labels: 0, source: '', bases: [], unit: '', note: '' };
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^\s*([a-zA-Z]+)\s*:\s*(.*)$/);
      if (!kv) continue;
      const key = kv[1].toLowerCase();
      const val = kv[2].trim();
      if (key === 'type') data.type = val.toLowerCase();
      else if (key === 'values') data.values = val.split(',').map((s) => s.trim()).filter(Boolean);
      else if (key === 'labels') data.labels = val.split(',').filter((s) => s.trim()).length;
      else if (key === 'source') data.source = val;
      else if (key === 'bases') data.bases = val.split(',').map((s) => s.trim()).filter(Boolean);
      else if (key === 'unit') data.unit = val;
      else if (key === 'note') data.note = val;
    }
    out.push(data);
  }
  return out;
}

// Значение графика сравнивается как строка после нормализации: «51,6» = «51.6»,
// «1,2–4,6» = «1.2-4.6», «1 000» = «1000». Так перевод вправе писать десятичную
// запятую, а подмена числа всё равно видна.
const canonValue = (s) =>
  String(s)
    .trim()
    .replace(/\s+/g, '')
    .replace(/[–—]/g, '-')
    .replace(/,/g, '.');

function checkCharts(ruBody, enBody, where, problems) {
  const a = chartBlocks(ruBody);
  const b = chartBlocks(enBody);
  if (a.length !== b.length) {
    problems.push(`${where}: графиков RU ${a.length}, EN ${b.length}`);
    return;
  }
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    const n = i + 1;
    if (x.type !== y.type) problems.push(`${where}: график ${n} — тип RU «${x.type}», EN «${y.type}»`);
    if (x.source !== y.source) problems.push(`${where}: график ${n} — источник RU «${x.source}», EN «${y.source}»`);
    if (x.labels !== y.labels) problems.push(`${where}: график ${n} — подписей RU ${x.labels}, EN ${y.labels}`);
    if (x.unit !== y.unit) problems.push(`${where}: график ${n} — единица RU «${x.unit}», EN «${y.unit}»`);
    if (x.bases.join(',') !== y.bases.join(',')) {
      problems.push(
        `${where}: график ${n} — bases RU [${x.bases.join(', ')}], EN [${y.bases.join(', ')}]`,
      );
    }
    if (x.type === 'funnel' && !x.bases.length) {
      problems.push(`${where}: график ${n} — у воронки RU нет bases`);
    }
    if (y.type === 'funnel' && !y.bases.length) {
      problems.push(`${where}: график ${n} — у воронки EN нет bases`);
    }
    // note переводится, поэтому дословно текст не сверяется: сверяются его
    // наличие и набор чисел внутри — «41,9 %» в RU и «41.9%» в EN обязаны
    // совпасть, а пропавшая оговорка видна как пустой note в одной версии.
    if (Boolean(x.note) !== Boolean(y.note)) {
      problems.push(
        `${where}: график ${n} — note RU ${x.note ? 'есть' : 'нет'}, EN ${y.note ? 'есть' : 'нет'}`,
      );
    } else {
      diffNumbers(numbersIn(x.note), numbersIn(y.note), 'note: ', problems, where);
    }
    if (x.values.length !== y.values.length) {
      problems.push(
        `${where}: график ${n} — значений RU ${x.values.length}, EN ${y.values.length} (дробная часть в блоке chart — точкой, запятая разделяет значения)`,
      );
      continue;
    }
    const bad = x.values.some((v, k) => canonValue(v) !== canonValue(y.values[k]));
    if (bad) {
      problems.push(
        `${where}: график ${n} — значения RU [${x.values.join(', ')}], EN [${y.values.join(', ')}]`,
      );
    }
  }
}

function diffNumbers(a, b, label, problems, where) {
  if (a.join() === b.join()) return;
  const count = (list) => list.reduce((m, n) => m.set(n, (m.get(n) ?? 0) + 1), new Map());
  const ca = count(a);
  const cb = count(b);
  const parts = [];
  for (const [n, k] of ca) if (k !== (cb.get(n) ?? 0)) parts.push(`${n} (RU ${k}, EN ${cb.get(n) ?? 0})`);
  for (const [n, k] of cb) if (!ca.has(n)) parts.push(`${n} (RU 0, EN ${k})`);
  if (parts.length) problems.push(`${where}: ${label}числа не совпали — ${parts.join(', ')}`);
}

// Числа прозы — по разделам, числа графиков — отдельно (checkCharts). Так
// «15» в блоке chart не прикрывает пропажу «15%» из текста утверждения.
function checkSections(ruBody, enBody, where, problems) {
  const a = sectionsOf(ruBody.replace(CHART_BLOCK_RE, ' '));
  const b = sectionsOf(enBody.replace(CHART_BLOCK_RE, ' '));
  if (a.length !== b.length) {
    problems.push(`${where}: разделов «##» RU ${a.length}, EN ${b.length}`);
    diffNumbers(numbersIn(ruBody.replace(CHART_BLOCK_RE, ' ')), numbersIn(enBody.replace(CHART_BLOCK_RE, ' ')), '', problems, where);
    return;
  }
  for (let i = 0; i < a.length; i++) {
    const label = a[i].title ? `раздел ${i} «${a[i].title}»: ` : 'до первого раздела: ';
    diffNumbers(numbersIn(a[i].text), numbersIn(b[i].text), label, problems, where);
  }
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
    // RU — канон; тема без перевода не ошибка, а долг: пару проверять нечего.
    return { where, problems, stats: null, untranslated: true };
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

  checkSections(ru.body, en.body, where, problems);

  diffSets(A.pmids, B.pmids, 'PMID', problems, where);
  diffSets(A.dois, B.dois, 'DOI', problems, where);
  diffSets(A.urls, B.urls, 'ссылки', problems, where);

  checkCharts(ru.body, en.body, where, problems);

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
      pairs.push({ dir, slug: name, root });
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
let untranslated = 0;
const untranslatedByRoot = { topics: 0, 'for-app': 0, pages: 0 };
for (const { dir, root } of pairs) {
  const { where, problems, stats, untranslated: noEn } = checkPair(dir);
  if (noEn) {
    if (root === 'pages') {
      untranslatedByRoot.pages++;
    } else {
      untranslated++;
      untranslatedByRoot[root]++;
    }
    const label = root === 'pages' ? ' (страница каталога, пары нет)' : ' (пары нет, проверять нечего)';
    console.log(`· ${where} — без перевода${label}`);
    continue;
  }
  if (problems.length) {
    failed++;
    console.log(`✖ ${where}`);
    for (const p of problems) console.log(`   ${p}`);
  } else {
    console.log(`✔ ${where} — паритет: ${stats}`);
  }
}

const pairsChecked = pairs.length - untranslated - untranslatedByRoot.pages;
const un = untranslated
  ? `файлов без перевода: ${untranslated} (в темах ${untranslatedByRoot.topics}, в for-app ${untranslatedByRoot['for-app']})`
  : '';
if (untranslatedByRoot.pages) {
  console.log(
    `· страниц каталога: ${untranslatedByRoot.pages}, только RU (решение 26.11.2026)`,
  );
}
console.log(
  failed
    ? `\nпровалено пар: ${failed} из ${pairsChecked}` + (un ? `; ${un}` : '')
    : `\nвсе пары в порядке: ${pairsChecked}` + (un ? `; ${un}` : ''),
);
process.exit(failed ? 1 : 0);
