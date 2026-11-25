#!/usr/bin/env node
/**
 * Сверка STATUS.md с диском.
 *
 * Журнал состояния полезен ровно до тех пор, пока совпадает с файлами.
 * Этот скрипт падает, если:
 *   - в legacy/inbox/ есть файл, которого нет в таблице STATUS.md;
 *   - в STATUS.md есть тема, файла которой нет;
 *   - в topics/ появилась папка, не отмеченная в STATUS.md;
 *   - в STATUS.md нет строки «Обновлено: ГГГГ-ММ-ДД»;
 *   - в таблице «Дыры и пустые поиски» у строки нет даты ГГГГ-ММ-ДД;
 *   - в topics/<тема>/ru.md или en.md раздел «Не нашёл» / «Not found» пуст.
 *
 *   node tools/status.mjs
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATUS = join(ROOT, 'STATUS.md');
const INBOX = join(ROOT, 'legacy', 'inbox');
const TOPICS = join(ROOT, 'topics');

if (!existsSync(STATUS)) {
  console.error('нет STATUS.md');
  process.exit(1);
}

const status = readFileSync(STATUS, 'utf8');
const problems = [];

// 1. Файлы очереди
const inboxFiles = existsSync(INBOX)
  ? readdirSync(INBOX).filter((f) => f.endsWith('.md')).sort()
  : [];

const mentioned = new Set(
  [...status.matchAll(/`(06-\d\d-[a-z0-9-]+\.md)`/g)].map((m) => m[1]),
);

for (const f of inboxFiles) {
  if (!mentioned.has(f)) problems.push(`в STATUS.md нет строки для ${f}`);
}
for (const f of mentioned) {
  if (!inboxFiles.includes(f)) problems.push(`STATUS.md ссылается на ${f}, файла нет`);
}

// 2. Готовые темы
const topics = existsSync(TOPICS)
  ? readdirSync(TOPICS).filter((d) => statSync(join(TOPICS, d)).isDirectory())
  : [];
for (const d of topics) {
  if (d === '_example') continue;
  if (!status.includes(`topics/${d}`) && !status.includes(`${d}/`)) {
    problems.push(`тема topics/${d} не отмечена в STATUS.md`);
  }
}

// 3. Дата обновления
const dateMatch = status.match(/^Обновлено:\s*(\d{4}-\d{2}-\d{2})/m);
if (!dateMatch) problems.push('в STATUS.md нет строки «Обновлено: ГГГГ-ММ-ДД»');

// 4. «Дыры и пустые поиски»: у каждой строки таблицы своя дата замера.
// Пустой поиск — тоже результат, и строка без даты через месяц читается как
// «это было давно»: непонятно, повторять запрос или он уже был. Даты в первом
// столбце нет — это дефект журнала. Если раздела нет совсем, страж тоже
// падает: иначе его отключают, удалив заголовок.
const lines = status.split(/\r?\n/);
const holesHeading = lines.findIndex((l) => l.trim() === '## Дыры и пустые поиски');
if (holesHeading === -1) {
  problems.push('в STATUS.md нет раздела «Дыры и пустые поиски»');
} else {
  for (let i = holesHeading + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) break; // раздел кончился
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (!cells.length) continue;
    if (cells[0] === 'Дата') continue; // шапка таблицы
    if (/^:?-{3,}:?$/.test(cells[0])) continue; // строка-разделитель
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[0])) {
      problems.push(
        `STATUS.md:${i + 1} — строка «Дыры и пустые поиски» без даты ГГГГ-ММ-ДД (первая ячейка «${cells[0]}»)`,
      );
    }
  }
}

// 5. Раздел «Не нашёл» / «Not found» не пустой: правило §4 правил приёма.
// Пустой раздел означает «искали недостаточно», а не «всё нашлось».
// Отсутствие заголовка здесь не проверяем — его ловит parity.mjs; этот страж
// отвечает только за пустое тело. topics/_example проверяется наравне с
// остальными: это настоящая пара ru/en, и исключение по draft: true позволило
// бы проводить черновик без раздела — ровно то, что страж запрещает.
const NOT_FOUND = [
  { file: 'ru.md', heading: /^#{1,6}\s*Не нашёл\s*#*\s*$/, label: 'Не нашёл' },
  { file: 'en.md', heading: /^#{1,6}\s*Not found\s*#*\s*$/i, label: 'Not found' },
];

function sectionBodyIsEmpty(text, headingRe) {
  const content = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const start = content.findIndex((l) => headingRe.test(l.trim()));
  if (start === -1) return null; // заголовка нет — не наша забота, см. parity.mjs
  const body = [];
  for (let i = start + 1; i < content.length; i++) {
    if (/^#{1,2}\s/.test(content[i])) break; // следующий ## — раздел кончился
    body.push(content[i]);
  }
  return body.join('\n').trim() === '';
}

for (const d of topics) {
  for (const { file, heading, label } of NOT_FOUND) {
    const p = join(TOPICS, d, file);
    if (!existsSync(p)) continue; // отсутствие пары — долг перевода, не ошибка
    if (sectionBodyIsEmpty(readFileSync(p, 'utf8'), heading)) {
      problems.push(`topics/${d}/${file} — раздел «${label}» пуст (правило §4: пустым он быть не может)`);
    }
  }
}

// 6. `sources: N` во front-matter = числу различных карточек, на которые ссылается
// тема. Для RU-only темы это замена паритету: потерю ссылки при правке больше
// ничто не заметит — EN-копии нет, сверять не с чем. Падает только потеря
// (ссылок стало меньше, чем заявлено); обратное — устаревший счётчик, он
// печатается строкой, но цикл не останавливает.
const untranslated = topics.filter((d) => !existsSync(join(TOPICS, d, 'en.md')));
const staleSources = [];
for (const d of topics) {
  const p = join(TOPICS, d, 'ru.md');
  if (!existsSync(p)) continue;
  const text = readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fmText = fmMatch ? fmMatch[1] : '';
  if (/^draft:\s*true\s*$/m.test(fmText)) continue; // шаблон _example не публикуется
  const declared = fmText.match(/^sources:\s*(\d+)\s*$/m);
  if (!declared) {
    problems.push(`topics/${d}/ru.md — во front-matter нет «sources: N»`);
    continue;
  }
  const refs = new Set([...text.matchAll(/\.\.\/sources\/([a-z0-9-]+)\.md/g)].map((m) => m[1]));
  if (refs.size < Number(declared[1])) {
    problems.push(`topics/${d}: sources: ${declared[1]}, а карточек в тексте ${refs.size} — ссылка потеряна`);
  } else if (refs.size > Number(declared[1])) {
    staleSources.push(`topics/${d}: sources: ${declared[1]}, карточек в тексте ${refs.size} — счётчик устарел`);
  }
}

if (problems.length) {
  console.log('✖ STATUS.md расходится с диском:');
  for (const p of problems) console.log(`   ${p}`);
  process.exit(1);
}

for (const s of staleSources) console.log(`· ${s}`);

console.log(
  `✔ STATUS.md совпадает с диском: ${inboxFiles.length} файлов в очереди, ${topics.length} папок тем; ` +
    `тем без перевода: ${untranslated.length}; «Дыры и пустые поиски» — с датами; «Не нашёл» не пуст`,
);
