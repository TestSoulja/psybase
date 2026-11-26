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
 *     больше чем в одной теме, N — только в for-app») расходится с диском.
 *   - в README.en.md пары «N topics/cards/claims/sources» расходятся с числами
 *     главной, которые считает build.mjs (home: topics, cards, claims, notFound).
 *   - в README.en.md есть число, которого нет в README.md: второй слой,
 *     ловит опечатку, а не смысл.
 *   - pages/<slug>/ без ru.md; слаг страницы совпал с темой; страница попала
 *     в таблицу тем; «Тем: N» на собранной главной не равна числу папок тем.
 *   - dist/ нет или он старше последней правки входов — это ошибка, а не
 *     «сверка пропущена»: собери `node tools/build.mjs`.
 *   - страница источника: нет индекса, страницы карточки или строки; число
 *     в индексе не равно числу файлов или числу на главной; тип показан не
 *     тем числом; в sitemap нет адресов источников или страниц каталога;
 *     «цитируется в темах» ведёт на несуществующую тему.
 *   - у карточки нет `read:` или значение не из abstract|full|page|unknown;
 *     на странице карточки нет `data-read` или текст строки не равен метке;
 *     таблица типов на странице доказательности расходится с sources/;
 *     список «Источники» темы ссылается не на все карточки.
 *   - в теме нет обязательного минимума разделов: «Что это», «Что не доказано»,
 *     «Не нашёл», «Источники» (README обещает именно этот список).
 *
 *   node tools/status.mjs
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
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

// 2a. pages/ — каталог, а не темы. Папка без ru.md не бывает: иначе сборка
// молча пропустит страницу, а README будет на неё ссылаться. Слаг страницы
// не может совпасть с темой: адрес /ru/<slug>/ один.
const PAGES = join(ROOT, 'pages');
const pageDirs = existsSync(PAGES)
  ? readdirSync(PAGES).filter((d) => statSync(join(PAGES, d)).isDirectory()).filter((d) => !d.startsWith('.'))
  : [];
for (const d of pageDirs) {
  if (!existsSync(join(PAGES, d, 'ru.md'))) {
    problems.push(`pages/${d}/ — папка без ru.md: страница без текста`);
  }
  if (topics.includes(d)) {
    problems.push(`pages/${d}/ и topics/${d}/ — один адрес /ru/${d}/ на двоих`);
  }
}

// 2b. Возрастной маркер. 18+ — наше решение, а не требование закона (см.
// docs/rules.md), но у тем о веществах он обязателен: без него страница
// выглядит как совет для любого возраста. Список пополняется вместе с темой:
// слаг, для которого нет topics/<slug>/, — ошибка, а не «запланировано».
// Значение проверяется у всех тем: опечатка «18+ » или «16+» не должна
// проходить молча.
const SUBSTANCE_TOPICS = ['alkogol', 'kannabis'];
const AGE_VALUES = ['18+'];
for (const d of topics) {
  const p = join(TOPICS, d, 'ru.md');
  if (!existsSync(p)) continue;
  const { data } = frontMatter(readFileSync(p, 'utf8'));
  const age = String(data.age ?? '').trim();
  if (!age) continue;
  if (!AGE_VALUES.includes(age)) {
    problems.push(`topics/${d}/ru.md — age: «${age}», допустимо только ${AGE_VALUES.join(' | ')}`);
  }
}
for (const slug of SUBSTANCE_TOPICS) {
  if (!topics.includes(slug)) {
    problems.push(`SUBSTANCE_TOPICS: «${slug}» в списке, а папки topics/${slug}/ нет`);
    continue;
  }
  const p = join(TOPICS, slug, 'ru.md');
  const { data } = frontMatter(readFileSync(p, 'utf8'));
  const age = String(data.age ?? '').trim();
  if (!age) {
    problems.push(`topics/${slug}/ru.md — у темы о веществе нет «age: 18+» (SUBSTANCE_TOPICS)`);
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

// 5b. Обязательный минимум разделов темы. README обещает список, а не «примерно
// так»: без стража следующая тема разойдётся с обещанием молча. «Что известно»
// в минимум не входит — там, где текст идёт по вопросам, эту роль играют
// собственные разделы, и пустой контейнер хуже отсутствующего.
const REQUIRED_SECTIONS = ['Что это', 'Что не доказано', 'Не нашёл', 'Источники'];
for (const d of topics) {
  const p = join(TOPICS, d, 'ru.md');
  if (!existsSync(p)) continue;
  const text = readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  const { data } = frontMatter(text);
  if (/^true$/i.test(String(data.draft ?? '').trim())) continue; // черновик не публикуется
  const h2 = new Set([...text.matchAll(/^##\s+(.+?)\s*#*\s*$/gm)].map((m) => m[1].trim()));
  const missing = REQUIRED_SECTIONS.filter((t) => !h2.has(t));
  if (missing.length) {
    problems.push(
      `topics/${d}/ru.md — нет обязательных разделов: «${missing.join('», «')}» (README: минимум «Что это», «Что не доказано», «Не нашёл», «Источники»)`,
    );
  }
}

// 5c. Инструкции по употреблению. Правило 4 из docs/rules.md и обещание на
// странице «Как мы работаем»: база не описывает способы, дозы, пути и места.
// Страж ищет формулы, а не смысл: он не отличит предупреждение от совета, и
// это осознанно — база не должна содержать такие фразы даже в отрицании.
// «Ё» и регистр не спасают: текст приводится к нижнему регистру, поиск идёт
// без учёта регистра.
//
// Дозы регуляркой не проверяются: числа в миллиграммах законно стоят в
// описании исследований (например, «доза ТГК в экспериментальной работе»),
// и шаблон «цифра + мг» ловил бы научные данные, а не инструкцию. Запрет на
// дозы держится редактурой и тем, что в темах нет раздела «как принимать».
const INSTRUCTION_FORMULAS = [
  {
    re: /как\s+(?:принимать|принять|употреблять|употребить|приготовить|приготовлять|изготовить|изготовлять|вырастить|выращивать|экстрагировать|экстрагируют)/iu,
    label: 'инструкция «как …»',
  },
  {
    re: /способ(?:ы|ов)?\s+(?:употребления|введения|изготовления)/iu,
    label: 'описание способа',
  },
  {
    re: /где\s+(?:можно\s+)?(?:купить|достать|приобрести|заказать)/iu,
    label: 'место приобретения',
  },
  {
    re: /обойти\s+(?:тест|тесты|проверку|проверки)/iu,
    label: 'обход проверки',
  },
  {
    re: /(?:для\s+усиления\s+эффекта|чтобы\s+усилить\s+эффект)/iu,
    label: 'усиление эффекта',
  },
];
const instructionFiles = [];
for (const d of topics) {
  const p = join(TOPICS, d, 'ru.md');
  if (existsSync(p)) instructionFiles.push(p);
}
for (const d of pageDirs) {
  const p = join(PAGES, d, 'ru.md');
  if (existsSync(p)) instructionFiles.push(p);
}
for (const p of instructionFiles) {
  const text = readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  text.split(/\r?\n/).forEach((line, i) => {
    for (const { re, label } of INSTRUCTION_FORMULAS) {
      const m = line.match(re);
      if (m) {
        problems.push(
          `${relative(ROOT, p).replace(/\\/g, '/')}:${i + 1} — запрещённая формула «${m[0]}» (${label})`,
        );
      }
    }
  });
}

// 5d. Декларация на странице «Как мы работаем». Рамка — ст. 46 Федерального
// закона от 08.01.1998 № 3-ФЗ «О наркотических средствах и психотропных
// веществах» (ред. от 27.10.2025); п. 1 и п. 2 — в ред. Федерального закона
// от 08.08.2024 № 224-ФЗ. Полный текст с шестью категориями п. 1 и изъятиями
// п. 2 — в docs/rules.md, «Правовая рамка»; здесь закон не пересказываем.
// Страница обязана назвать категории, которых мы не описываем (изготовление,
// культивирование, дозы для эффекта, пути введения, места приобретения), и
// отдельно — что материалы не являются пропагандой и что мы не представляем
// употребление как общепринятую норму (подпункт 6 п. 1). Формулировки можно
// править, но потерять категорию молча нельзя: страж падает с названием
// отсутствующей фразы.
const DECLARATION_PAGE = join(PAGES, 'kak-my-rabotaem', 'ru.md');
const DECLARATION_PHRASES = [
  'изготовления',
  'культивирование',
  'дозы для достижения эффекта',
  'пути введения',
  'места приобретения',
  'не являются пропагандой',
  'не представляем его как общепринятую норму',
];
let declarationOk = true;
if (!existsSync(DECLARATION_PAGE)) {
  problems.push('pages/kak-my-rabotaem/ru.md — страницы «Как мы работаем» нет: декларация не проверяется');
  declarationOk = false;
} else {
  const declaration = readFileSync(DECLARATION_PAGE, 'utf8').replace(/^\uFEFF/, '').replace(/\s+/g, ' ');
  for (const phrase of DECLARATION_PHRASES) {
    if (!declaration.includes(phrase)) {
      problems.push(`pages/kak-my-rabotaem/ru.md — нет обязательной фразы «${phrase}» (страж 5d)`);
      declarationOk = false;
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
      if (pageDirs.includes(slug)) {
        problems.push(`README.md — «${cells[0]}»: это pages/${slug}/, а таблица тем только для topics/`);
      } else {
        problems.push(`README.md — тема «${cells[0]}» есть в таблице, а папки topics/${slug} нет`);
      }
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
// pages/ сюда намеренно не читается: страница каталога не тема, и её ссылки
// не должны попадать в «в темах».
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

// 9b. Карточка волны без темы. До 27.11.2026 карточка обязана была стоять
// в topics/ или for-app/. Волна 27 добавляет карточки в sources/ до того, как
// тема написана, поэтому третьим законным местом стал research/: карточка
// считается цитируемой, если её PMID стоит в research-файле. Проверка не
// ослаблена: карточка без PMID и без ссылки по-прежнему падает.
const cardPmid = new Map();
for (const c of sourceCards) {
  const { data } = frontMatter(readFileSync(join(SOURCES, `${c}.md`), 'utf8'));
  const m = String(data.id ?? '').match(/PMID\s*(\d+)/i);
  if (m) cardPmid.set(c, m[1]);
}
const researchCited = new Set();
const researchDir = join(ROOT, 'research');
if (existsSync(researchDir)) {
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) {
        const text = readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
        for (const m of text.matchAll(/\bPMID\s+(\d{5,9})\b/g)) researchCited.add(m[1]);
      }
    }
  };
  walk(researchDir);
}
const citedInResearch = (c) => Boolean(cardPmid.get(c) && researchCited.has(cardPmid.get(c)));

const inTopics = sourceCards.filter((c) => cardTopics.get(c).size > 0);
const multiTopic = inTopics.filter((c) => cardTopics.get(c).size > 1);
const appOnly = sourceCards.filter((c) => cardTopics.get(c).size === 0 && appUnion.has(c));
const researchOnly = sourceCards.filter((c) => cardTopics.get(c).size === 0 && !appUnion.has(c) && citedInResearch(c));
const nowhere = sourceCards.filter((c) => cardTopics.get(c).size === 0 && !appUnion.has(c) && !citedInResearch(c));

// С 25.11.2026 карточки законно живут в трёх темах; формулировка стала точной:
// «больше чем в одной», проверять нечего — это определение множества.
for (const c of nowhere) {
  problems.push(`sources/${c}.md — карточка не цитируется ни в topics/, ни в for-app/, ни в research/`);
}

// 9c. Основа чтения: поле `read` обязательно и только из четырёх значений.
// «В каждой карточке написано, чем читали» было утверждением, которого диск не
// подтверждал; теперь это поле, и страж считает, у скольких оно названо.
const READ_VALUES = ['abstract', 'full', 'page', 'unknown'];
const READ_TEXT = {
  abstract: 'аннотация',
  full: 'полный текст',
  page: 'страница целиком',
  unknown: 'Основа чтения не записана',
};
const cardRead = new Map();
const cardType = new Map();
for (const c of sourceCards) {
  const { data } = frontMatter(readFileSync(join(SOURCES, `${c}.md`), 'utf8'));
  cardType.set(c, String(data.type ?? '').trim() || 'none');
  const read = String(data.read ?? '').trim();
  if (!read) {
    problems.push(`sources/${c}.md — нет «read:»: основа чтения обязательна (abstract | full | page | unknown)`);
  } else if (!READ_VALUES.includes(read)) {
    problems.push(`sources/${c}.md — read: «${read}», допустимо только ${READ_VALUES.join(' | ')}`);
  }
  cardRead.set(c, READ_VALUES.includes(read) ? read : 'unknown');
}
const readNamed = [...cardRead.values()].filter((r) => r !== 'unknown').length;
const readUnknown = sourceCards.length - readNamed;
if (readNamed + readUnknown !== sourceCards.length) {
  problems.push(`sources/ — основа чтения: названа у ${readNamed} + не записана у ${readUnknown} ≠ ${sourceCards.length} карточек`);
}

const footnote = readmeText
  .replace(/\s+/g, ' ')
  .match(
    /(\d+) карточ(?:ек|ки) в `sources\/`: (\d+) в темах, (\d+) из них — больше чем в одной теме, (\d+) — только в `for-app`(?:, (\d+) — только в `research\/`)?/,
  );
if (!footnote) {
  problems.push(
    'README.md — нет сноски «N карточек в `sources/`: N в темах, N из них — больше чем в одной теме, N — только в `for-app`, N — только в `research/`»',
  );
} else {
  const asRead = [
    ['карточек в sources/', Number(footnote[1]), sourceCards.length],
    ['в темах', Number(footnote[2]), inTopics.length],
    ['больше чем в одной теме', Number(footnote[3]), multiTopic.length],
    ['только в for-app/', Number(footnote[4]), appOnly.length],
    ['только в research/', Number(footnote[5] ?? 0), researchOnly.length],
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

// 9a. Главная: «Тем: N» — только topics/. pages/ — каталог, он в счётчик не
// входит. Сверяем собранную страницу, а не формулу: если счётчик сложит темы
// и страницы, число разойдётся.
//
// dist/ — не «необязательный артефакт»: все проверки ниже читают собранные
// страницы. Нет сборки — страж падает, а не пишет «сверка пропущена»:
// пропущенная сверка выглядит как успешная.
const DIST = join(ROOT, 'dist');
const DIST_HOME = join(DIST, 'ru', 'index.html');
const distReady = existsSync(DIST_HOME);
if (!distReady) {
  problems.push('dist/ — сборки нет: собери: node tools/build.mjs');
} else {
  const builtAt = statSync(DIST_HOME).mtimeMs;
  let newest = 0;
  let newestWhere = '';
  const touch = (p) => {
    const m = statSync(p).mtimeMs;
    if (m > newest) {
      newest = m;
      newestWhere = p;
    }
  };
  for (const d of topics) {
    for (const f of ['ru.md', 'en.md']) if (existsSync(join(TOPICS, d, f))) touch(join(TOPICS, d, f));
  }
  for (const d of pageDirs) {
    if (existsSync(join(PAGES, d, 'ru.md'))) touch(join(PAGES, d, 'ru.md'));
  }
  for (const f of sourceCards) touch(join(SOURCES, `${f}.md`));
  touch(join(ROOT, 'tools', 'build.mjs'));
  if (newest > builtAt + 2000) {
    problems.push(
      `dist/ — старше последней правки (${newestWhere.replace(ROOT + '\\', '')}): пересобери: node tools/build.mjs`,
    );
  }

  const html = readFileSync(DIST_HOME, 'utf8').replace(/^\uFEFF/, '');
  const shown = html.match(/Тем:\s*([\d\s\u00a0]+)/);
  if (!shown) {
    problems.push('dist/ru/index.html — нет строки «Тем: N», сверять нечего');
  } else {
    const written = Number(shown[1].replace(/\D/g, ''));
    if (written !== buildHome.topics) {
      problems.push(
        `dist/ru/index.html — «Тем: ${written}», а папок тем ${buildHome.topics}: страницы каталога не должны входить в счётчик`,
      );
    }
  }

  const cardsShown = html.match(/карточек источников:\s*([\d\s\u00a0]+)/);
  if (!cardsShown) {
    problems.push('dist/ru/index.html — нет строки «карточек источников: N»');
  } else {
    const writtenCards = Number(cardsShown[1].replace(/\D/g, ''));
    if (writtenCards !== sourceCards.length) {
      problems.push(
        `dist/ru/index.html — «карточек источников: ${writtenCards}», а файлов в sources/ ${sourceCards.length}`,
      );
    }
  }
}

// 9b. Страницы источников: индекс и карточка на каждый файл. Проверяем то,
// что читатель получит: число в индексе, набор строк, наличие страницы,
// адреса в sitemap и живые ссылки «цитируется в темах».
const SITE = 'https://testsoulja.github.io/psybase/';
if (distReady) {
  const SRC_INDEX = join(DIST, 'ru', 'istochniki', 'index.html');
  if (!existsSync(SRC_INDEX)) {
    problems.push('dist/ru/istochniki/index.html — нет индекса источников: пересобери: node tools/build.mjs');
  } else {
    const idx = readFileSync(SRC_INDEX, 'utf8').replace(/^\uFEFF/, '');
    const declared = idx.match(/data-source-count="(\d+)"/);
    if (!declared) {
      problems.push('dist/ru/istochniki/index.html — нет data-source-count, сверять число не с чем');
    } else if (Number(declared[1]) !== sourceCards.length) {
      problems.push(
        `dist/ru/istochniki/index.html — в индексе ${declared[1]} карточек, а файлов в sources/ ${sourceCards.length}`,
      );
    }
    const rows = [...idx.matchAll(/data-type="([a-z]+)" data-source="([a-z0-9-]+)"/g)];
    const rowIds = new Set(rows.map((m) => m[2]));
    for (const c of sourceCards) {
      if (!rowIds.has(c)) problems.push(`dist/ru/istochniki/index.html — нет строки для sources/${c}.md`);
      if (!existsSync(join(DIST, 'ru', 'istochniki', c, 'index.html'))) {
        problems.push(`dist/ru/istochniki/${c}/ — нет страницы карточки`);
      }
    }
    for (const id of rowIds) {
      if (!sourceCards.includes(id)) problems.push(`dist/ru/istochniki/index.html — строка для несуществующей карточки «${id}»`);
    }
    const typeOnDisk = {};
    for (const c of sourceCards) {
      const { data } = frontMatter(readFileSync(join(SOURCES, `${c}.md`), 'utf8'));
      typeOnDisk[data.type] = (typeOnDisk[data.type] ?? 0) + 1;
    }
    const typeShown = {};
    for (const [, type] of rows) typeShown[type] = (typeShown[type] ?? 0) + 1;
    for (const type of new Set([...Object.keys(typeOnDisk), ...Object.keys(typeShown)])) {
      if ((typeOnDisk[type] ?? 0) !== (typeShown[type] ?? 0)) {
        problems.push(
          `dist/ru/istochniki/index.html — типа «${type}» показано ${typeShown[type] ?? 0}, а в sources/ ${typeOnDisk[type] ?? 0}`,
        );
      }
    }
    // «Цитируется в темах» — только существующие адреса: тема или страница каталога.
    // Заодно строка «Чем читали»: data-read из четырёх значений и текст ровно
    // метка. Иначе страница может сказать «аннотация · Europe PMC», хотя тело
    // карточки называет другой путь.
    const deadLinks = [];
    for (const c of sourceCards) {
      const p = join(DIST, 'ru', 'istochniki', c, 'index.html');
      if (!existsSync(p)) continue;
      const text = readFileSync(p, 'utf8');
      const readMatch = text.match(/<p class="read" data-read="([^"]*)">([^<]*)<\/p>/);
      if (!readMatch) {
        problems.push(`dist/ru/istochniki/${c}/ — нет строки «Чем читали» с data-read`);
      } else {
        const [, shownRead, shownText] = readMatch;
        if (!READ_VALUES.includes(shownRead)) {
          problems.push(
            `dist/ru/istochniki/${c}/ — data-read «${shownRead}», допустимо только ${READ_VALUES.join(' | ')}`,
          );
        } else if (shownText !== READ_TEXT[shownRead]) {
          problems.push(
            `dist/ru/istochniki/${c}/ — data-read «${shownRead}», а текст «${shownText}», ожидается ровно «${READ_TEXT[shownRead]}»`,
          );
        }
        const { data } = frontMatter(readFileSync(join(SOURCES, `${c}.md`), 'utf8'));
        const sourceRead = String(data.read ?? '').trim();
        if (shownRead !== sourceRead) {
          problems.push(
            `dist/ru/istochniki/${c}/ — data-read «${shownRead}», а в sources/${c}.md read: «${sourceRead}»`,
          );
        }
      }
      for (const m of text.matchAll(/href="\/psybase\/ru\/([a-z0-9-]+)\/"/g)) {
        if (m[1] === 'istochniki') continue;
        if (!topics.includes(m[1]) && !pageDirs.includes(m[1])) deadLinks.push(`${c} → ${m[1]}`);
      }
    }
    if (deadLinks.length) {
      problems.push(
        `dist/ru/istochniki/<id>/ — ссылка на несуществующую тему: ${deadLinks.slice(0, 3).join(', ')}${deadLinks.length > 3 ? ` и ещё ${deadLinks.length - 3}` : ''}`,
      );
    }
  }
  const SITEMAP = join(DIST, 'sitemap.xml');
  if (!existsSync(SITEMAP)) {
    problems.push('dist/sitemap.xml — файла нет: пересобери: node tools/build.mjs');
  } else {
    const sm = readFileSync(SITEMAP, 'utf8');
    const need = [
      ...pageDirs.map((d) => `${SITE}ru/${d}/`),
      `${SITE}ru/istochniki/`,
      ...sourceCards.map((c) => `${SITE}ru/istochniki/${c}/`),
    ];
    const missing = need.filter((u) => !sm.includes(`<loc>${u}</loc>`));
    if (missing.length) {
      problems.push(
        `dist/sitemap.xml — нет ${missing.length} адресов (страницы каталога и источники), например ${missing[0]}`,
      );
    }
  }

  // Таблица типов на странице доказательности: число в data-types должно
  // сходиться с front-matter, иначе страница печатает свою копию правды.
  const DOK = join(DIST, 'ru', 'dokazatelnost', 'index.html');
  if (pageDirs.includes('dokazatelnost')) {
    if (!existsSync(DOK)) {
      problems.push('dist/ru/dokazatelnost/index.html — страницы доказательности нет: пересобери: node tools/build.mjs');
    } else {
      const dok = readFileSync(DOK, 'utf8');
      const typesAttr = dok.match(/<table class="types" data-types="([^"]+)"/);
      if (!typesAttr) {
        problems.push('dist/ru/dokazatelnost/index.html — таблица типов без data-types, сверять не с чем');
      } else {
        const shownTypes = Object.fromEntries(
          typesAttr[1].split(',').map((pair) => {
            const [k, v] = pair.split(':');
            return [k, Number(v)];
          }),
        );
        const diskTypes = {};
        for (const c of sourceCards) {
          const { data } = frontMatter(readFileSync(join(SOURCES, `${c}.md`), 'utf8'));
          diskTypes[data.type] = (diskTypes[data.type] ?? 0) + 1;
        }
        for (const type of new Set([...Object.keys(shownTypes), ...Object.keys(diskTypes)])) {
          if ((shownTypes[type] ?? 0) !== (diskTypes[type] ?? 0)) {
            problems.push(
              `dist/ru/dokazatelnost/index.html — в data-types «${type}:${shownTypes[type] ?? 0}», а в sources/ ${diskTypes[type] ?? 0}`,
            );
          }
        }
      }
      const readShown = dok.match(/Основа чтения названа у (\d+) из (\d+); у (\d+) не записана/);
      if (!readShown) {
        problems.push('dist/ru/dokazatelnost/index.html — нет строки об основе чтения, сверять нечего');
      } else if (
        Number(readShown[1]) !== readNamed ||
        Number(readShown[2]) !== sourceCards.length ||
        Number(readShown[3]) !== readUnknown
      ) {
        problems.push(
          `dist/ru/dokazatelnost/index.html — «названа у ${readShown[1]} из ${readShown[2]}; у ${readShown[3]} не записана», а на диске ${readNamed} из ${sourceCards.length}; ${readUnknown}`,
        );
      }
    }
  }

  // Список «Источники» в конце темы: каждая карточка — ссылкой на свою
  // страницу, и число различных ссылок равно `sources:` темы.
  for (const t of topicsInfo) {
    if (t.draft || t.dir === '_example') continue;
    const p = join(DIST, 'ru', t.dir, 'index.html');
    if (!existsSync(p)) continue;
    const html = readFileSync(p, 'utf8');
    const section = html.match(/<h2>Источники<\/h2>([\s\S]*?)<\/section>/);
    if (!section) {
      problems.push(`dist/ru/${t.dir}/ — нет раздела «Источники», сверять список не с чем`);
      continue;
    }
    const ids = new Set(
      [...section[1].matchAll(/href="\/psybase\/ru\/istochniki\/([a-z0-9-]+)\/"/g)].map((m) => m[1]),
    );
    if (t.sources !== null && ids.size !== t.sources) {
      problems.push(
        `dist/ru/${t.dir}/ — в «Источники» ${ids.size} различных ссылок на карточки, а sources: ${t.sources}`,
      );
    }
  }
}

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
if (declarationOk) {
  console.log(
    `· страж 5d: декларация на /ru/kak-my-rabotaem/ — ${DECLARATION_PHRASES.length} ключевых фраз на месте`,
  );
}

const totalSources = publicTopics.reduce((n, t) => n + (t.sources ?? 0), 0);
for (const t of publicTopics) {
  console.log(`· topics/${t.dir}: источников ${t.sources ?? '—'}, ${t.hasEn ? 'RU + EN' : 'RU'}`);
}
// Разбивка по типам печатается, а не считается руками: сумма обязана сходиться
// с `sources:` темы и с числом различных карточек, иначе цифра в STATUS
// устаревает молча (так уже вышло с «168 новых» и «177 цитируемых»).
const TYPE_ORDER = ['meta', 'rct', 'cohort', 'review', 'case', 'opinion', 'unsure'];
for (const t of publicTopics) {
  const refs = topicCites.get(t.dir);
  if (!refs || !refs.size) continue;
  const counts = Object.fromEntries(TYPE_ORDER.map((k) => [k, 0]));
  let other = 0;
  for (const c of refs) {
    const ty = cardType.get(c) ?? 'none';
    if (ty in counts) counts[ty]++;
    else other++;
  }
  const parts = TYPE_ORDER.filter((k) => counts[k]).map((k) => `${k} ${counts[k]}`);
  if (other) parts.push(`без типа ${other}`);
  console.log(`· типы в topics/${t.dir}: ${parts.join(', ')} — ${refs.size} различных`);
}
console.log(
  `· тем: ${publicTopics.length}, источников по темам: ${totalSources}, без перевода: ${untranslated.length}`,
);
console.log(
  `· карточки: ${sourceCards.length} в sources/, ${inTopics.length} в темах, ${multiTopic.length} больше чем в одной теме, ${appOnly.length} только в for-app`,
);
console.log(`· основа чтения: названа у ${readNamed}, не записана у ${readUnknown}`);
console.log(`· страниц каталога: ${pageDirs.length} (в таблицу тем и сноску карточек не входят)`);

console.log(
  `✔ STATUS.md совпадает с диском: ${inboxFiles.length} файлов в очереди, ${topics.length} папок тем; ` +
    `тем без перевода: ${untranslated.length}; «Дыры и пустые поиски» — с датами; «Не нашёл» не пуст`,
);
console.log(
  `✔ README.md: таблица тем сходится с topics/ — строк ${readmeRows}, источники, языки, сноска карточек и дата цитаты сверены; README.en.md — числа и смысл сверены со сборкой`,
);
