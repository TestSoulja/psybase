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
 *   - таблица тем в README.md расходится с topics/: тема есть на диске, но не
 *     в таблице; тема в таблице, а папки нет; число источников не равно
 *     `sources:` во front-matter темы.
 *   - сноска под таблицей тем («N карточек в sources/: N в темах, N из них —
 *     в нескольких темах, N — только в for-app») расходится с диском.
 *   - в README.en.md пары «N topics/cards/claims/sources» расходятся с числами
 *     главной, которые считает build.mjs (home: topics, cards, claims, notFound).
 *   - в README.en.md есть число, которого нет в README.md: второй слой,
 *     ловит опечатку, а не смысл.
 *
 *   node tools/status.mjs
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { frontMatter, topicStats } from './stats.mjs';

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
  if (!mentioned.has(f)) problems.push(`STATUS.md — нет строки для legacy/inbox/${f}`);
}
for (const f of mentioned) {
  if (!inboxFiles.includes(f)) problems.push(`STATUS.md — ссылка на legacy/inbox/${f}, файла нет`);
}

// 2. Готовые темы
const topics = existsSync(TOPICS)
  ? readdirSync(TOPICS).filter((d) => statSync(join(TOPICS, d)).isDirectory())
  : [];
for (const d of topics) {
  if (d === '_example') continue;
  if (!status.includes(`topics/${d}`) && !status.includes(`${d}/`)) {
    problems.push(`topics/${d}/ru.md — тема не отмечена в STATUS.md`);
  }
}

// 3. Дата обновления
const dateMatch = status.match(/^Обновлено:\s*(\d{4}-\d{2}-\d{2})/m);
if (!dateMatch) problems.push('STATUS.md — нет строки «Обновлено: ГГГГ-ММ-ДД»');

// 4. «Дыры и пустые поиски»: у каждой строки таблицы своя дата замера.
// Пустой поиск — тоже результат, и строка без даты через месяц читается как
// «это было давно»: непонятно, повторять запрос или он уже был. Даты в первом
// столбце нет — это дефект журнала. Если раздела нет совсем, страж тоже
// падает: иначе его отключают, удалив заголовок.
const lines = status.split(/\r?\n/);
const holesHeading = lines.findIndex((l) => l.trim() === '## Дыры и пустые поиски');
if (holesHeading === -1) {
  problems.push('STATUS.md — нет раздела «Дыры и пустые поиски»');
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

// 7. README.md: таблица «Что внутри сейчас» — это то, что видит новый читатель,
// и она стареет молча. Страж сверяет три вещи: тема на диске есть в таблице;
// тема из таблицы есть на диске; число источников в столбце равно `sources:`
// во front-matter темы. Языки сверяются заодно: столбец «RU» без `en.md` и
// «RU + EN» при наличии перевода — та же устаревшая строка.
const TOPIC_STUB = (d) => {
  const p = join(TOPICS, d, 'ru.md');
  const text = existsSync(p) ? readFileSync(p, 'utf8').replace(/^\uFEFF/, '') : '';
  const fm = (text.match(/^---\r?\n([\s\S]*?)\r?\n---/) ?? [null, ''])[1];
  const declared = fm.match(/^sources:\s*(\d+)\s*$/m);
  const title = fm.match(/^title:\s*(.+)$/m);
  const updated = fm.match(/^updated:\s*(\d{4}-\d{2}-\d{2})\s*$/m);
  return {
    dir: d,
    title: title ? title[1].trim() : d,
    updated: updated ? updated[1] : null,
    sources: declared ? Number(declared[1]) : null,
    hasEn: existsSync(join(TOPICS, d, 'en.md')),
    draft: /^draft:\s*true\s*$/m.test(fm),
  };
};

const topicsInfo = topics.map(TOPIC_STUB);
const publicTopics = topicsInfo.filter((t) => !t.draft && t.dir !== '_example');

const README = join(ROOT, 'README.md');
const readmeText = existsSync(README) ? readFileSync(README, 'utf8').replace(/^\uFEFF/, '') : '';
const readmeLines = readmeText.split(/\r?\n/);
const readmeHead = readmeLines.findIndex((l) => l.trim() === '## Что внутри сейчас');
let readmeRows = 0;

if (readmeHead === -1) {
  problems.push('README.md — нет раздела «Что внутри сейчас» с таблицей тем');
} else {
  const seen = new Set();
  for (let i = readmeHead + 1; i < readmeLines.length; i++) {
    const line = readmeLines[i];
    if (/^##\s/.test(line)) break; // раздел кончился
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (!cells.length) continue;
    if (cells[0] === 'Тема') continue; // шапка
    if (/^:?-{3,}:?$/.test(cells[0])) continue; // разделитель
    readmeRows++;

    // Описание темы — одна строка без чисел: числа живут в соседних столбцах,
    // а цифра в прозе устаревает молча.
    if (/\d/.test(cells[3] ?? '')) {
      problems.push(
        `README.md:${i + 1} — в столбце «О чём» темы «${cells[0]}» есть цифра: описание должно быть без чисел`,
      );
    }

    const url = cells[4] ?? '';
    const slugMatch = url.match(/\/ru\/([a-z0-9_-]+)\//);
    if (!slugMatch) {
      problems.push(
        `README.md:${i + 1} — в строке «${cells[0]}» нет адреса вида /ru/<slug>/, сверять не с чем`,
      );
      continue;
    }
    const slug = slugMatch[1];
    if (slug === '_example') {
      problems.push('README.md — в таблице тем стоит topics/_example: это шаблон, а не тема');
      continue;
    }
    const info = topicsInfo.find((t) => t.dir === slug);
    if (!info) {
      problems.push(`README.md — тема «${cells[0]}» есть в таблице, а папки topics/${slug} нет`);
      continue;
    }
    seen.add(slug);
    const declaredInRow = Number((cells[2] ?? '').replace(/[^\d]/g, ''));
    if (info.sources === null) {
      problems.push(`topics/${slug}/ru.md — во front-matter нет «sources: N», сверять с README не с чем`);
    } else if (declaredInRow !== info.sources) {
      problems.push(
        `README.md — «${info.title}»: в таблице источников ${declaredInRow || '—'}, а в topics/${slug}/ru.md sources: ${info.sources}`,
      );
    }
    const rowHasEn = /\bEN\b/.test(cells[1] ?? '');
    if (info.hasEn && !rowHasEn) {
      problems.push(`README.md — «${info.title}»: перевод есть (en.md), а в столбце языков только RU`);
    }
    if (!info.hasEn && rowHasEn) {
      problems.push(`README.md — «${info.title}»: в таблице EN, а файла topics/${slug}/en.md нет`);
    }
  }
  for (const t of publicTopics) {
    if (!seen.has(t.dir)) {
      problems.push(`topics/${t.dir}/ru.md — темы нет в таблице README.md`);
    }
  }
}

// 8. Дата в примере цитаты — дата `updated:` той темы, которую пример называет.
// Пример без сверки стареет молча: страница печатает одно, README — другое.
const citation = readmeText.match(
  /Пси-база\.\s*«(.+?)»\.\s*Обновлено\s+(\d{2})\.(\d{2})\.(\d{4})/,
);
if (!citation) {
  problems.push('README.md — нет примера цитаты с «Обновлено ДД.ММ.ГГГГ», сверять дату не с чем');
} else {
  const [, citeTitle, dd, mm, yyyy] = citation;
  const cited = topicsInfo.find((t) => t.title === citeTitle);
  if (!cited) {
    problems.push(`README.md — в примере цитаты тема «${citeTitle}», а такой темы в topics/ нет`);
  } else if (!cited.updated) {
    problems.push(`topics/${cited.dir}/ru.md — во front-matter нет «updated: ГГГГ-ММ-ДД»`);
  } else {
    const asText = `${cited.updated.slice(8, 10)}.${cited.updated.slice(5, 7)}.${cited.updated.slice(0, 4)}`;
    if (asText !== `${dd}.${mm}.${yyyy}`) {
      problems.push(
        `README.md — в примере цитаты дата ${dd}.${mm}.${yyyy}, а topics/${cited.dir}/ru.md updated: ${cited.updated} (на странице будет ${asText})`,
      );
    }
  }
}

// 9. Сноска под таблицей тем: четыре числа, которые читатель видит рядом с
// «50 карточками». Считать их руками после каждой новой карточки — занятие,
// которое кончается устаревшей цифрой. Считаем так же, как читает человек:
// карточки в sources/, уникальные карточки в topics/, карточки, попавшие
// больше чем в одну тему, и карточки, которые есть только в for-app/.
const SOURCES = join(ROOT, 'sources');
const sourceCards = existsSync(SOURCES)
  ? readdirSync(SOURCES).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -'.md'.length))
  : [];

function citedCards(base) {
  const byOwner = new Map();
  if (!existsSync(base)) return byOwner;
  for (const d of readdirSync(base)) {
    const dir = join(base, d);
    if (!statSync(dir).isDirectory()) continue;
    const refs = new Set();
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const text = readFileSync(join(dir, f), 'utf8').replace(/^\uFEFF/, '');
      for (const m of text.matchAll(/\.\.\/sources\/([a-z0-9-]+)\.md/g)) refs.add(m[1]);
    }
    byOwner.set(d, refs);
  }
  return byOwner;
}

const topicCites = citedCards(TOPICS);
const appCites = citedCards(join(ROOT, 'for-app'));
const appUnion = new Set();
for (const refs of appCites.values()) for (const c of refs) appUnion.add(c);
const cardTopics = new Map(sourceCards.map((c) => [c, new Set()]));
for (const [topic, refs] of topicCites) {
  for (const c of refs) cardTopics.get(c)?.add(topic);
}

const inTopics = sourceCards.filter((c) => cardTopics.get(c).size > 0);
const multiTopic = inTopics.filter((c) => cardTopics.get(c).size > 1);
const appOnly = sourceCards.filter((c) => cardTopics.get(c).size === 0 && appUnion.has(c));
const nowhere = sourceCards.filter((c) => cardTopics.get(c).size === 0 && !appUnion.has(c));

for (const c of nowhere) {
  problems.push(`sources/${c}.md — карточка не цитируется ни в topics/, ни в for-app/`);
}

const footnote = readmeText
  .replace(/\s+/g, ' ')
  .match(
    /(\d+) карточ(?:ек|ки) в `sources\/`: (\d+) в темах, (\d+) из них — в нескольких темах, (\d+) — только в `for-app`/,
  );
if (!footnote) {
  problems.push(
    'README.md — нет сноски «N карточек в `sources/`: N в темах, N из них — в нескольких темах, N — только в `for-app`»',
  );
} else {
  const asRead = [
    ['карточек в sources/', Number(footnote[1]), sourceCards.length],
    ['в темах', Number(footnote[2]), inTopics.length],
    ['в нескольких темах', Number(footnote[3]), multiTopic.length],
    ['только в for-app/', Number(footnote[4]), appOnly.length],
  ];
  for (const [label, written, actual] of asRead) {
    if (written !== actual) {
      problems.push(`README.md — сноска: ${label} ${written}, а на диске ${actual}`);
    }
  }
}

// 10. README.en.md — шпаргалка, а не второй канон.
//
// Первый слой — смысл. Пары «<N> topics|cards|claims|sources|questions|
// unanswered» сверяются с числами, которые считает build.mjs для главной
// (home: topics, cards, claims, notFound). Это ловит «50 topics», где число
// есть в русском тексте, но означает не то.
//
// Второй слой — подмножество цифр: любое число из README.en.md должно
// встречаться в README.md. Это ловит опечатку и выдуманное число, но не
// смысл: «50 topics» проходит второй слой, потому что 50 в каноне есть.
const EN_README = join(ROOT, 'README.en.md');
const numbersIn = (text, { skipListMarkers = false } = {}) => {
  const found = new Set();
  for (const line of text.split(/\r?\n/)) {
    const clean = skipListMarkers ? line.replace(/^\s*\d+[.)]\s+/, ' ') : line;
    for (const m of clean.matchAll(/\d+(?:[.,]\d+)*/g)) found.add(m[0]);
  }
  return found;
};

// Те же docs и тот же topicStats, что в build.mjs: иначе страж сверялся бы
// с копией формул, а не со сборкой.
const buildDocs = [];
for (const d of topics) {
  const p = join(TOPICS, d, 'ru.md');
  if (!existsSync(p)) continue;
  const doc = frontMatter(readFileSync(p, 'utf8'));
  if (String(doc.data.draft).trim() === 'true') continue;
  buildDocs.push(doc);
}
const buildStats = buildDocs.map(topicStats);
const buildHome = {
  topics: buildDocs.length,
  cards: sourceCards.length,
  claims: buildStats.reduce((n, s) => n + s.claims, 0),
  notFound: buildStats.reduce((n, s) => n + s.notFound, 0),
};

const HOME_KEYS = {
  topics: 'topics',
  cards: 'cards',
  'source cards': 'cards',
  sources: 'cards',
  claims: 'claims',
  questions: 'notFound',
  unanswered: 'notFound',
  notfound: 'notFound',
};

if (existsSync(EN_README)) {
  const enText = readFileSync(EN_README, 'utf8').replace(/^\uFEFF/, '');

  const pairs = [
    ...enText.matchAll(
      /\b(\d+)\s+(topics|(?:source\s+)?cards|claims|sources|questions|unanswered|notFound)\b/gi,
    ),
  ];
  const checked = new Set();
  for (const m of pairs) {
    const word = m[2].toLowerCase().replace(/\s+/g, ' ');
    const key = HOME_KEYS[word];
    if (!key) continue;
    const written = Number(m[1]);
    const actual = buildHome[key];
    if (written !== actual && !checked.has(`${key}:${written}`)) {
      checked.add(`${key}:${written}`);
      problems.push(
        `README.en.md — «${m[0].trim()}», а build.mjs для главной считает ${key}: ${actual}`,
      );
    }
  }

  // Второй слой: опечатка, а не смысл (см. комментарий выше).
  const canonNumbers = numbersIn(readmeText, { skipListMarkers: true });
  const extra = [...numbersIn(enText)].filter((n) => !canonNumbers.has(n));
  if (extra.length) {
    problems.push(
      `README.en.md — числа, которых нет в README.md: ${extra.join(', ')} (шпаргалка не вводит своих чисел)`,
    );
  }
} else if (/README\.en\.md/.test(readmeText)) {
  problems.push('README.en.md — файла нет, а README.md ссылается на English summary');
}

if (problems.length) {
  console.log('✖ найдены расхождения:');
  for (const p of problems) console.log(`   ${p}`);
  process.exit(1);
}

for (const s of staleSources) console.log(`· ${s}`);

const totalSources = publicTopics.reduce((n, t) => n + (t.sources ?? 0), 0);
for (const t of publicTopics) {
  console.log(`· topics/${t.dir}: источников ${t.sources ?? '—'}, ${t.hasEn ? 'RU + EN' : 'RU'}`);
}
console.log(
  `· тем: ${publicTopics.length}, источников по темам: ${totalSources}, без перевода: ${untranslated.length}`,
);
console.log(
  `· карточки: ${sourceCards.length} в sources/, ${inTopics.length} в темах, ${multiTopic.length} в нескольких темах, ${appOnly.length} только в for-app`,
);

console.log(
  `✔ STATUS.md совпадает с диском: ${inboxFiles.length} файлов в очереди, ${topics.length} папок тем; ` +
    `тем без перевода: ${untranslated.length}; «Дыры и пустые поиски» — с датами; «Не нашёл» не пуст`,
);
console.log(
  `✔ README.md: таблица тем сходится с topics/ — строк ${readmeRows}, источники, языки, сноска карточек и дата цитаты сверены; README.en.md — числа и смысл сверены со сборкой`,
);
