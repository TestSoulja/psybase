#!/usr/bin/env node
/**
 * Замер читаемости темы.
 *
 * Считает то, что читатель видит на странице, а не разметку: единица — абзац
 * `<p>` или пункт списка `<li>` в topics/<тема>/ru.md; заголовки, таблицы,
 * блоки `chart` и front-matter не входят. Ссылка считается по подписи
 * (`[слаг](…, `cohort`)` → `слаг`), символы `**` считаются, пробелы
 * схлопываются. Блок длиннее 600 знаков — ошибка, exit 1.
 *
 *   node tools/readability.mjs                 — все темы
 *   node tools/readability.mjs bipolar         — одна тема (или несколько)
 *   node tools/readability.mjs bipolar --since 6fff588
 *                                              — сравнить с версией из git
 *
 * `--since` считает старую версию тем же кодом и печатает дельту: блоки,
 * знаки, слова, максимум и число исходных единиц, которые не сохранились
 * дословно. Это и есть подтверждение строки «правились N единиц из M».
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOPICS = join(ROOT, 'topics');
const LIMIT = 600;

function parseUnits(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let i = 0;
  if (lines[0] === '---') {
    i = 1;
    while (i < lines.length && lines[i] !== '---') i++;
    i++;
  }
  const units = [];
  let fence = false;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      fence = !fence;
      i++;
      continue;
    }
    if (fence) {
      i++;
      continue;
    }
    if (/^#{1,6}\s/.test(line) || !line.trim() || /^\|/.test(line)) {
      i++;
      continue;
    }
    if (/^- /.test(line)) {
      const start = i + 1;
      const buf = [line.slice(2)];
      i++;
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^- /.test(lines[i]) &&
        !/^#{1,6}\s/.test(lines[i]) &&
        !/^```/.test(lines[i]) &&
        !/^\|/.test(lines[i])
      ) {
        buf.push(lines[i]);
        i++;
      }
      units.push({ kind: 'li', line: start, text: buf.join(' ').replace(/\s+/g, ' ').trim() });
      continue;
    }
    const start = i + 1;
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^- /.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^\|/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    units.push({ kind: 'p', line: start, text: buf.join(' ').replace(/\s+/g, ' ').trim() });
  }
  return units;
}

// Ссылка → её подпись. URL с одной парой скобок (DOI, страницы) не обрывает
// разбор на первой «)». `**` и обратные кавычки остаются: это и есть
// договорённость замера, записанная в STATUS.md.
function visible(text) {
  return text
    .replace(/\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

function measure(text) {
  const units = parseUnits(text).map((u) => {
    const shown = visible(u.text);
    return { ...u, shown, chars: shown.length, words: shown.split(/\s+/).filter(Boolean).length };
  });
  const paragraphs = units.filter((u) => u.kind === 'p').length;
  return {
    units,
    blocks: units.length,
    paragraphs,
    items: units.length - paragraphs,
    chars: units.reduce((n, u) => n + u.chars, 0),
    words: units.reduce((n, u) => n + u.words, 0),
    max: units.reduce((n, u) => Math.max(n, u.chars), 0),
    long: units.filter((u) => u.chars > LIMIT).sort((a, b) => b.chars - a.chars),
  };
}

function readTopic(slug, rev) {
  const rel = `topics/${slug}/ru.md`;
  if (rev) {
    return execFileSync('git', ['show', `${rev}:${rel}`], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  }
  return readFileSync(join(ROOT, rel), 'utf8');
}

function isDraft(text) {
  const m = text.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return Boolean(m && /^draft:\s*true\s*$/m.test(m[1]));
}

function allSlugs() {
  return readdirSync(TOPICS)
    .filter((d) => d !== '_example' && statSync(join(TOPICS, d)).isDirectory())
    .filter((d) => existsSync(join(TOPICS, d, 'ru.md')))
    .filter((d) => !isDraft(readFileSync(join(TOPICS, d, 'ru.md'), 'utf8')))
    .sort();
}

// Сколько исходных единиц не сохранилось дословно. Разделённый абзац сюда
// входит: целого абзаца в новой версии больше нет.
function changedUnits(before, after) {
  const left = new Map();
  for (const u of after.units) left.set(u.text, (left.get(u.text) ?? 0) + 1);
  let changed = 0;
  for (const u of before.units) {
    const n = left.get(u.text) ?? 0;
    if (n > 0) left.set(u.text, n - 1);
    else changed++;
  }
  return changed;
}

function percent(from, to) {
  if (!from) return '—';
  const pct = ((to / from - 1) * 100).toFixed(1).replace('.', ',');
  return `${pct.startsWith('-') ? '' : '+'}${pct} %`;
}

const args = process.argv.slice(2);
let since = null;
const slugs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--since') {
    since = args[++i];
    if (!since) {
      console.error('--since требует ревизию: например, --since HEAD~1');
      process.exit(2);
    }
    continue;
  }
  if (args[i].startsWith('--')) {
    console.error(`неизвестный ключ «${args[i]}»`);
    process.exit(2);
  }
  slugs.push(args[i]);
}

const known = allSlugs();
const selected = slugs.length ? slugs : known;
for (const s of selected) {
  if (!known.includes(s)) {
    console.error(`темы «${s}» нет в topics/ (или она draft)`);
    process.exit(2);
  }
}

const rows = selected.map((slug) => {
  const text = readTopic(slug, null);
  const now = measure(text);
  const before = since ? measure(readTopic(slug, since)) : null;
  return { slug, now, before };
});

const header = ['тема', 'блоков', 'абзацев', 'пунктов', '>600', 'макс.', 'знаков'];
const body = rows.map(({ slug, now }) => [
  slug,
  fmt(now.blocks),
  fmt(now.paragraphs),
  fmt(now.items),
  fmt(now.long.length),
  fmt(now.max),
  fmt(now.chars),
]);
const totals = rows.reduce(
  (acc, { now }) => {
    acc.blocks += now.blocks;
    acc.paragraphs += now.paragraphs;
    acc.items += now.items;
    acc.long += now.long.length;
    acc.max = Math.max(acc.max, now.max);
    acc.chars += now.chars;
    return acc;
  },
  { blocks: 0, paragraphs: 0, items: 0, long: 0, max: 0, chars: 0 },
);
body.push([
  slugs.length ? 'выбрано' : 'все темы',
  fmt(totals.blocks),
  fmt(totals.paragraphs),
  fmt(totals.items),
  fmt(totals.long),
  fmt(totals.max),
  fmt(totals.chars),
]);

const widths = header.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
const line = (cells) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
console.log(line(header));
console.log(widths.map((w) => '─'.repeat(w)).join('  '));
for (const r of body) console.log(line(r));

if (since) {
  console.log('');
  for (const { slug, now, before } of rows) {
    const changed = changedUnits(before, now);
    console.log(
      `${slug}: блоков ${fmt(before.blocks)} → ${fmt(now.blocks)}; ` +
        `знаков ${fmt(before.chars)} → ${fmt(now.chars)} (${percent(before.chars, now.chars)}); ` +
        `слов ${fmt(before.words)} → ${fmt(now.words)}; ` +
        `максимум ${fmt(before.max)} → ${fmt(now.max)}; ` +
        `изменено исходных единиц ${changed} из ${before.blocks}`,
    );
  }
}

const long = rows.flatMap(({ slug, now }) => now.long.map((u) => ({ slug, ...u })));
if (long.length) {
  console.log('');
  console.log(`✖ блоков длиннее ${LIMIT} знаков: ${long.length}`);
  for (const u of long) console.log(`   ${u.slug}:${u.line} (${u.kind}) — ${u.chars} знаков: ${u.shown.slice(0, 80)}…`);
  process.exit(1);
}

console.log('');
console.log(`✔ все блоки не длиннее ${LIMIT} знаков`);
