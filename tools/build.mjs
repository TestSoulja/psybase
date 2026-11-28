#!/usr/bin/env node
/**
 * Сборка статики: topics/<slug>/{ru,en}.md -> dist/{ru,en}/<slug>/index.html.
 * Без зависимостей; for-app/ не публикуется; сырой HTML не пропускается.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { frontMatter, splitSections, topicStats, homeStats, LEVELS } from './stats.mjs';
import { classifyCitations, readResearchPmids } from './citations.mjs';
import { buildFingerprint } from './build-fingerprint.mjs';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = '/psybase/'; // единственная константа адреса
const SITE = 'https://testsoulja.github.io' + BASE;
const FIXTURE = process.argv.includes('--fixture');
const DIST = FIXTURE ? join(tmpdir(), 'psybase-fixture-' + process.pid) : join(ROOT, 'dist');
const TOPICS = join(ROOT, 'topics');
const PAGES = join(ROOT, 'pages');
const SOURCES = join(ROOT, 'sources');
const APP = join(ROOT, 'for-app');
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function closingParen(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return i;
  }
  return -1;
}
function anchor(label, raw) {
  let href = raw.trim();
  let level = null;
  const m = href.match(/^(.*),\s*`([a-z]+)`$/);
  if (m) {
    href = m[1].trim();
    level = m[2];
  }
  const badge = level ? ` <span class="badge badge-${esc(level)}">${esc(level)}</span>` : '';
  const src = href.match(/^\.\.\/sources\/([a-z0-9-]+)\.md$/);
  if (src) {
    // Пометка типа — ссылка на страницу карточки: из темы видно не только
    // «какой это дизайн», но и откуда взято. Без карточки пометка остаётся
    // текстом, чтобы не вести в 404.
    const badgeLink =
      level && existsSync(join(SOURCES, `${src[1]}.md`))
        ? ` <a class="badge badge-${esc(level)}" href="${sourceHref(src[1])}">${esc(level)}</a>`
        : level
          ? ` <span class="badge badge-${esc(level)}">${esc(level)}</span>`
          : '';
    return `<span class="src" data-src="${src[1]}">${label}</span>${badgeLink}`;
  }
  if (/^https?:\/\//.test(href)) return `<a href="${esc(href)}" rel="noopener">${label}</a>${badge}`;
  if (href.startsWith(BASE) || href.startsWith('/')) return `<a href="${esc(href)}">${label}</a>${badge}`;
  return `<span class="linkish">${label}</span>${badge}`;
}
function inline(text) {
  let s = esc(text);
  let out = '';
  let i = 0;
  for (;;) {
    const j = s.indexOf('](', i);
    if (j < 0) {
      out += s.slice(i);
      break;
    }
    const lb = s.lastIndexOf('[', j);
    const end = lb < i ? -1 : closingParen(s, j + 1);
    if (lb < i || end < 0) {
      out += s.slice(i, j + 2);
      i = j + 2;
      continue;
    }
    out += s.slice(i, lb) + anchor(s.slice(lb + 1, j), s.slice(j + 2, end));
    i = end + 1;
  }
  s = out
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  return s;
}
function table(lines) {
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const head = cells(lines[0]);
  const rows = lines.slice(2).map(cells);
  return `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')
  }</tbody></table>`;
}
function renderBody(lines, ctx) {
  // {{read}} — строка-число внутри абзаца, не блок: подставляем до разбора,
  // иначе токен уехал бы в текст страницы.
  lines = lines.map((l) => l.replace(/\{\{read\}\}/g, ctx.readStats ?? ''));
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.trim() === '{{types}}') {
      if (!ctx.typesTable) {
        throw new Error(
          `${ctx.pageLabel ?? 'страница'}: есть {{types}}, а таблица типов пуста — сборка не подставит числа`,
        );
      }
      out.push(ctx.typesTable);
      i++;
      continue;
    }
    if (line.trim() === '{{read}}') {
      out.push(ctx.readStats ?? '');
      i++;
      continue;
    }
    if (/^```/.test(line)) {
      const fence = line.slice(3).trim().toLowerCase();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      if (fence === 'chart') {
        out.push(chartHtml(buf.join('\n'), ctx));
        continue;
      }
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = Math.min(6, Math.max(3, h[1].length));
      out.push(`<h${lvl}>${inline(h[2].trim())}</h${lvl}>`);
      i++;
      continue;
    }
    if (/^\s*\|/.test(line) && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1] ?? '')) {
      const buf = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) buf.push(lines[i++]);
      out.push(table(buf));
      continue;
    }
    const bullet = /^\s*(?:[-*]|\d+\.)\s+/;
    if (bullet.test(line)) {
      const items = [];
      while (i < lines.length && bullet.test(lines[i])) {
        let item = lines[i].replace(bullet, '');
        i++;
        while (i < lines.length && lines[i].trim() && !bullet.test(lines[i]) && !/^#{1,6}\s/.test(lines[i])) {
          item += ' ' + lines[i].trim();
          i++;
        }
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^#{1,6}\s/.test(lines[i]) && !bullet.test(lines[i])) {
      buf.push(lines[i++]);
    }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}
// --- графики: ```chart в markdown -> CSS-бары, таблица-эквивалент, подпись ------
// Без библиотек и без hover: всё видно на печати и в чёрно-белом виде.
const CHART_LEVELS = LEVELS;

function parseChart(raw) {
  const data = { type: 'bar', values: [], labels: [], source: '', bases: [], unit: '', note: '' };
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([a-zA-Z]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'type') data.type = val.toLowerCase();
    else if (key === 'values') data.values = val.split(',').map((s) => s.trim()).filter(Boolean);
    else if (key === 'labels') data.labels = val.split(',').map((s) => s.trim());
    else if (key === 'source') data.source = val;
    else if (key === 'bases') data.bases = val.split(',').map((s) => s.trim()).filter(Boolean);
    else if (key === 'unit') data.unit = val;
    else if (key === 'note') data.note = val;
  }
  return data;
}

const toNum = (s) => Number(String(s).replace(',', '.'));

// Диапазон пишется точкой: `1.2–4.6`. Запятая — разделитель значений, поэтому
// внутри значения её быть не может: иначе `1,2–4,6` распалось бы на три числа.
// Отрицательные значения разбираются отдельно, чтобы сборка сказала «минус»,
// а не «не число»: бар отрицательной ширины молча обрезался бы в ноль.
function chartRange(raw) {
  const s = String(raw).trim();
  const neg = s.match(/^[−-]\s*([\d.]+)$/);
  if (neg) {
    const v = -toNum(neg[1]);
    return { lo: v, hi: v, raw: s };
  }
  const m = s.match(/^([\d.]+)\s*[–—-]\s*([\d.]+)$/);
  if (m) return { lo: toNum(m[1]), hi: toNum(m[2]), raw: s };
  const v = toNum(s);
  return { lo: v, hi: v, raw: s };
}

// Числа в тексте темы пишутся по-русски с запятой, в блоке chart — с точкой
// (запятая там разделитель). Ищем дословно: «2,41» как «2,41», но не «2,41»
// внутри «12,41» и не «2,4» внутри «2,41».
function numberInText(text, raw, lang) {
  const needle = lang === 'ru' ? String(raw).replace('.', ',') : String(raw);
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sep = lang === 'ru' ? ',' : '\\.';
  return new RegExp(`(?<![\\d${sep}])${esc}(?![\\d${sep}])`).test(text);
}

// Текст темы без блоков chart: иначе значение нашлось бы само в себе, и проверка
// «график не вводит чисел, которых в тексте нет» стала бы бессмысленной.
function proseOnly(body) {
  return String(body).replace(/```chart\b[\s\S]*?```/g, ' ');
}

const chartChecks = [];

function chartHtml(raw, ctx) {
  const { lang, cards } = ctx;
  const ru = lang === 'ru';
  const d = parseChart(raw);
  ctx.chartNo = (ctx.chartNo ?? 0) + 1;
  const chartName = `график ${ctx.pageLabel ?? 'страница'} #${ctx.chartNo}`;
  if (!d.source) {
    throw new Error(
      `${chartName}: нет source — подпись без источника не публикуется (${raw.trim().split(/\r?\n/).join(' | ')})`,
    );
  }
  if (!cards.has(d.source)) {
    throw new Error(
      `${chartName}: source «${d.source}» — карточки sources/${d.source}.md нет (опечатка в id убрала бы год и выборку из подписи)`,
    );
  }
  if (!d.values.length) {
    throw new Error(
      `график без values (${ru ? 'ru' : 'en'}): ${raw.trim().split(/\r?\n/).join(' | ')}`,
    );
  }
  if (!d.labels.length) {
    throw new Error(`график без labels: ${raw.trim().split(/\r?\n/).join(' | ')}`);
  }
  if (d.values.length !== d.labels.length) {
    throw new Error(
      `график: значений ${d.values.length}, подписей ${d.labels.length} — подписи не совпадают с барами (в блоке chart дробная часть пишется точкой: запятая разделяет значения)`,
    );
  }
  if (d.type === 'funnel') {
    if (!d.bases.length) {
      throw new Error(
        `график-воронка без bases: у каждого бара нужна база — all, у всех баров один и тот же знаменатель (${raw.trim().split(/\r?\n/).join(' | ')})`,
      );
    }
    if (d.bases.length !== d.values.length) {
      throw new Error(
        `график-воронка: значений ${d.values.length}, баз ${d.bases.length} — bases нужен для каждого бара`,
      );
    }
    const badBase = d.bases.find((b) => b !== 'all' && b !== 'treated');
    if (badBase) {
      throw new Error(`график-воронка: база «${badBase}» — допустимо только all`);
    }
    const treatedIdx = d.bases.indexOf('treated');
    if (treatedIdx >= 0) {
      throw new Error(
        `график-воронка: условная доля (из лечившихся) в бар не ставится: она дублирует следующий шаг воронки — вынеси в note (бар ${treatedIdx + 1} «${d.labels[treatedIdx] ?? d.values[treatedIdx]}»)`,
      );
    }
  } else if (d.bases.length) {
    throw new Error('bases допустим только для type: funnel');
  }
  const nums = d.values.map(chartRange);
  const bad = nums.find((n) => !Number.isFinite(n.lo) || !Number.isFinite(n.hi));
  if (bad) {
    throw new Error(`${chartName}: значение «${bad.raw}» не число (ось считается от нуля)`);
  }
  // Ось всегда от нуля. Отрицательное значение дало бы бар нулевой ширины:
  // «g −0,52» выглядел бы как «эффекта нет». Это отдельная задача с осью от
  // середины, а не молчаливая обрезка.
  const negative = nums.find((n) => n.lo < 0 || n.hi < 0);
  if (negative) {
    throw new Error(
      `${chartName} (${d.source}): отрицательное значение «${negative.raw}» — ось от нуля, бар соврал бы; ось от середины — отдельная задача`,
    );
  }
  // Перевёрнутый диапазон: left считался бы от верхней границы, а ширина была
  // бы отрицательной — бар уехал бы вправо и схлопнулся.
  const inverted = nums.find((n) => n.hi < n.lo);
  if (inverted) {
    throw new Error(
      `${chartName} (${d.source}): значение «${inverted.raw}» — границы диапазона переставлены (lo > hi)`,
    );
  }
  // В воронке бар — доля шага от нуля. Диапазон нарисовал бы плавающий отрезок
  // шириной в интервал; доверительный интервал шага идёт в note.
  if (d.type === 'funnel') {
    const ranged = nums.find((n) => n.hi !== n.lo);
    if (ranged) {
      throw new Error(
        `${chartName} (${d.source}): диапазон «${ranged.raw}» в type: funnel — бар воронки считается от нуля, интервал шага идёт в note`,
      );
    }
  }
  // Смесь точки и диапазона: isRange один на весь график, поэтому точка при
  // наличии диапазона получила бы width = hi − lo = 0 — бар нулевой ширины.
  const rangeCount = nums.filter((n) => n.hi !== n.lo).length;
  if (rangeCount > 0 && rangeCount < nums.length) {
    const point = nums.find((n) => n.hi === n.lo);
    throw new Error(
      `${chartName} (${d.source}): смешаны диапазон и точка — «${point.raw}» получил бы нулевую ширину. Раздели на два графика или приведи все значения к диапазону`,
    );
  }
  // График не вводит чисел, которых в тексте нет: каждое значение (и каждый
  // конец диапазона) ищется в своей теме дословно. Это печать, а не падение:
  // расхождение видит редактор, а сборка не блокируется.
  const missing = [];
  for (const n of nums) {
    const rawParts = n.raw.split(/\s*[–—-]\s*/);
    for (let k = 0; k < rawParts.length; k++) {
      const part = rawParts[k];
      if (!numberInText(ctx.sourceText ?? '', part, lang)) {
        missing.push(lang === 'ru' ? part.replace('.', ',') : part);
      }
    }
  }
  chartChecks.push({ page: ctx.pageLabel ?? 'страница', no: ctx.chartNo, source: d.source, total: nums.length, missing });
  // У воронки все бары — доли от всех случаев: одна ось, один знаменатель.
  // Условные доли (из лечившихся) сюда не попадают — для них есть note.
  const widths = nums;
  const peak = Math.max(...nums.map((n) => n.hi));
  // Ось всегда от нуля. Верх шкалы — круглое число, а не «максимум данных»:
  // 100 для процентов, иначе ближайшее кратное, чтобы деления были целыми.
  const top = peak > 100 ? Math.ceil(peak / 40) * 40 : peak > 10 ? 100 : Math.max(4, Math.ceil(peak / 4) * 4);
  const pct = (v) => `${((v / top) * 100).toFixed(2)}%`;
  const tick = (v) => String(Math.round(v * 100) / 100).replace('.', ru ? ',' : '.');
  const unitSuffix = d.unit ? (d.unit === '%' ? ' %' : ` ${d.unit}`) : '';
  const showVal = (n) => `${n.hi !== n.lo ? `${tick(n.lo)}–${tick(n.hi)}` : tick(n.lo)}${unitSuffix}`;
  const axisValue = (v) => `${tick(v)}${unitSuffix}`;
  const isRange = widths.some((n) => n.hi !== n.lo);
  const bars = widths
    .map((n, idx) => {
      const label = d.labels[idx] ?? d.values[idx];
      const width = isRange ? pct(n.hi - n.lo) : pct(n.hi);
      const left = isRange ? pct(n.lo) : '0';
      const cls = d.type === 'funnel' ? 'chart-bar chart-bar-funnel' : 'chart-bar';
      return `<div class="chart-row" aria-hidden="true"><span class="chart-label">${esc(label)}</span><span class="chart-track"><span class="${cls}" style="left:${left};width:${width}"></span></span><span class="chart-value">${esc(showVal(nums[idx]))}</span></div>`;
    })
    .join('');
  const axis = [0, top / 4, top / 2, (top * 3) / 4, top]
    .map((v) => `<span>${axisValue(v)}</span>`)
    .join('');
  const card = cards.get(d.source);
  const populationRaw =
    card && card.taken ? String(card.taken).split(' — ')[0].split(';')[0].split(',').slice(0, 2).join(',').trim() : '';
  // Подпись — выборка, а не второй абзац: длинный «taken» обрезаем по слову и
  // не оставляем раскрытую скобку.
  let population = populationRaw;
  let cut = false;
  if (population.length > 80) {
    population = population.slice(0, 80).replace(/\s+\S*$/, '');
    cut = true;
  }
  if ((population.match(/\(/g) ?? []).length > (population.match(/\)/g) ?? []).length) {
    population = population.slice(0, population.lastIndexOf('('));
    cut = true;
  }
  if (cut) population = `${population.replace(/[\s,;:–—-]+$/, '')}…`;
  const caption = [d.source, card && card.year ? String(card.year) : '', population]
    .filter(Boolean)
    .join(' · ');
  const rows = nums
    .map(
      (n, idx) =>
        `<tr><td>${esc(d.labels[idx] ?? '')}</td><td>${esc(showVal(n))}</td></tr>`,
    )
    .join('');
  // note — подпись под графиком и строка таблицы: условные доли, которые нельзя
  // ставить баром на общую ось, остаются видимыми, а не теряются.
  const noteText = d.note ? esc(d.note) : '';
  const noteBlock = noteText ? `<p class="chart-note" aria-hidden="true">${noteText}</p>` : '';
  const noteRow = noteText
    ? `<tfoot><tr><th>${ru ? 'Примечание' : 'Note'}</th><td>${noteText}</td></tr></tfoot>`
    : '';
  return `<figure class="chart" data-chart="${esc(d.type)}">
<figcaption class="chart-caption">${ru ? 'Источник' : 'Source'}: ${esc(caption)}</figcaption>
<div class="chart-axis chart-axis-top" aria-hidden="true">${axis}</div>
${bars}
<div class="chart-axis" aria-hidden="true">${axis}</div>
<table class="chart-table"><caption>${ru ? 'Те же данные таблицей' : 'The same data as a table'}</caption>
<thead><tr><th>${ru ? 'Что' : 'What'}</th><th>${ru ? 'Значение' : 'Value'}</th></tr></thead><tbody>${rows}</tbody>${noteRow}</table>
${noteBlock}
</figure>`;
}

// --- счёт для главной и для блоков «состав доказательств» / «чего нет» ---------

function evidenceHtml(st, lang) {
  const ru = lang === 'ru';
  const total = Object.values(st.levels).reduce((a, b) => a + b, 0);
  const chips = CHART_LEVELS.map(
    (l) => `<li><span class="badge badge-${l}">${l}</span> ${st.levels[l]}</li>`,
  ).join('');
  return `<section class="evidence" id="evidence"><h2>${ru ? 'Состав доказательств' : 'Evidence mix'}</h2>
<p class="meta">${ru ? `Утверждений со ссылкой на источник: ${st.claims}; карточек: ${st.cards}; меток уровня в тексте: ${total}.` : `Claims with a source link: ${st.claims}; cards: ${st.cards}; level tags in the text: ${total}.`}</p>
<ul class="levels">${chips}</ul>
<p class="meta">${ru ? 'Уровень ставится к каждому числу; meta и opinion в одном списке не уравниваются.' : 'Every number carries a level; meta and opinion are not equalised by appearing in one list.'}</p>
</section>
<section class="gaps" id="gaps"><h2>${ru ? 'Чего нет' : 'What is missing'}</h2>
<p>${ru ? `Вопросов без ответа («Не нашёл»): ${st.notFound}; из них ${st.closedDoors} — источник не открылся (403, подписка, обрыв).` : `Unanswered (“Not found”): ${st.notFound}; in ${st.closedDoors} of them a source would not open (403, paywall, cut connection).`}</p>
<p><a href="#not-found">${ru ? 'Список «Не нашёл» ниже' : 'The “Not found” list below'}</a> · <a href="${BASE}${lang}/">${ru ? 'Все темы' : 'All topics'}</a></p>
</section>`;
}

function loadCards() {
  const cards = new Map();
  if (!existsSync(SOURCES)) return cards;
  for (const f of readdirSync(SOURCES).filter((x) => x.endsWith('.md'))) {
    const slug = f.replace(/\.md$/, '');
    const { data, body } = frontMatter(readFileSync(join(SOURCES, f), 'utf8'));
    // «Что мы взяли» — единственное поле, без которого карточка не публикуется:
    // пустая страница источника выглядит как факт без источника.
    if (!String(data.taken ?? '').trim()) {
      throw new Error(`sources/${f} — нет «taken»: карточка без «что мы взяли» не публикуется`);
    }
    cards.set(slug, { ...data, body });
  }
  return cards;
}

// Порядок типов для индекса источников задан отдельно от LEVELS: у LEVELS
// case стоит перед review, а здесь обзоры идут раньше отдельных наблюдений.
// Это порядок показа, а не силы: страница доказательности говорит «тип — это
// не качество», и называть тот же порядок силой нельзя.
const TYPE_ORDER = ['meta', 'rct', 'cohort', 'review', 'case', 'opinion', 'unsure'];
const TYPE_LABEL = {
  meta: 'систематический обзор, мета-анализ',
  rct: 'рандомизированное контролируемое исследование',
  cohort: 'когорта, наблюдение, случай-контроль',
  review: 'обзор без метаанализа, гайд, консенсус',
  case: 'описание случая или серии случаев',
  opinion: 'экспертное мнение, редакционная статья',
  unsure: 'тип определить не удалось',
};
const sourceHref = (id) => `${BASE}ru/istochniki/${id}/`;
// Основа чтения — из front-matter, не из догадки по телу. unknown печатается
// прямо: «в каждой карточке написано» было неправдой, пока поле не заполняли.
const READ_VALUES = ['abstract', 'full', 'page', 'unknown'];
const asRuDate = (iso) => {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso ?? '');
};
const READ_LABEL = {
  abstract: 'аннотация',
  full: 'полный текст',
  page: 'страница целиком',
  unknown: 'Основа чтения не записана',
};
function readLine(card) {
  const read = String(card.read ?? 'unknown').trim();
  // Только метка из front-matter. Источник и дату называет тело карточки:
  // подбирать «Europe PMC» по телу — догадка, и она уже противоречила телам,
  // где стоит «через NCBI eutils, PMID сверен Europe PMC».
  return READ_LABEL[read] ?? READ_LABEL.unknown;
}
function readStats(cards) {
  let named = 0;
  for (const card of cards.values()) {
    const read = String(card.read ?? '').trim();
    if (read && read !== 'unknown') named++;
  }
  return { named, unknown: cards.size - named };
}
function pluralCards(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'карточка';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'карточки';
  return 'карточек';
}
function typeCounts(cards) {
  const counts = Object.fromEntries(TYPE_ORDER.map((t) => [t, 0]));
  for (const card of cards.values()) counts[card.type] = (counts[card.type] ?? 0) + 1;
  return counts;
}
function typesTable(cards) {
  const counts = typeCounts(cards);
  const rows = TYPE_ORDER.map(
    (t) =>
      `<tr><td><span class="badge badge-${t}">${t}</span></td><td>${esc(TYPE_LABEL[t])}</td><td>${counts[t]}</td></tr>`,
  ).join('');
  const data = TYPE_ORDER.map((t) => `${t}:${counts[t]}`).join(',');
  return `<table class="types" data-types="${data}"><thead><tr><th>Тип</th><th>Что за ним стоит</th><th>Карточек</th></tr></thead><tbody>${rows}</tbody></table>`;
}
// Темы, в которых цитируется каждая карточка: считается по topics/, не руками.
function cardTopicMap(topics) {
  const byCard = new Map();
  for (const t of topics) {
    const text = `${t.ru.body}\n${t.en?.body ?? ''}`;
    for (const m of text.matchAll(/\.\.\/sources\/([a-z0-9-]+)\.md/g)) {
      if (!byCard.has(m[1])) byCard.set(m[1], new Set());
      byCard.get(m[1]).add(t.slug);
    }
  }
  return byCard;
}
// Карточки, на которые ссылается for-app/. Нужно только для подписи
// «цитируется» в каталоге: страницы for-app/ не публикуются и не строятся.
function cardAppMap() {
  const byCard = new Set();
  if (!existsSync(APP)) return byCard;
  for (const d of readdirSync(APP)) {
    const dir = join(APP, d);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const text = readFileSync(join(dir, f), 'utf8');
      for (const m of text.matchAll(/\.\.\/sources\/([a-z0-9-]+)\.md/g)) byCard.add(m[1]);
    }
  }
  return byCard;
}
function sourceIndexPage({ cards, topicTitles, cardTopics, appOnly }) {
  const counts = typeCounts(cards);
  const total = cards.size;
  const parts = TYPE_ORDER.filter((t) => counts[t] > 0).map((t) => `${t} ${counts[t]}`);
  const inApp = appOnly ?? new Set();
  const groups = TYPE_ORDER.map((type) => {
    const list = [...cards.entries()]
      .filter(([, c]) => c.type === type)
      .sort((a, b) => Number(b[1].year ?? 0) - Number(a[1].year ?? 0) || String(a[1].title ?? '').localeCompare(String(b[1].title ?? ''), 'en'));
    return { type, list };
  }).filter((g) => g.list.length);
  const rows = groups
    .map((g) => {
      const head = `<tr class="type-head"><th colspan="5"><span class="badge badge-${g.type}">${g.type}</span> ${esc(TYPE_LABEL[g.type])} — ${g.list.length}</th></tr>`;
      return (
        head +
        g.list
          .map(([id, c]) => {
            const links = [...(cardTopics.get(id) ?? [])].sort().map((slug) => `<a href="${BASE}ru/${slug}/">${esc(topicTitles.get(slug) ?? slug)}</a>`);
            const cited = links.length
              ? links.join(', ')
              : inApp.has(id)
                ? '<span class="meta">только в for-app</span>'
                : '<span class="meta">темы пока нет</span>';
            return `<tr data-type="${esc(c.type)}" data-source="${esc(id)}"><td><a href="${sourceHref(id)}">${esc(c.title ?? id)}</a> <span class="src">${esc(id)}</span></td><td>${esc(c.year ?? '')}</td><td>${esc(c.type ?? '')}</td><td>${cited}</td><td>${citationInner(c) || '—'}</td></tr>`;
          })
          .join('')
      );
    })
    .join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Все источники — Пси-база</title><link rel="canonical" href="${SITE}ru/istochniki/">
<link rel="stylesheet" href="${BASE}style.css"></head><body>
<nav class="langs"><a href="${BASE}ru/">Все темы</a> · <span class="no-translation" lang="ru">EN — перевода нет</span></nav>
<header><h1>Все источники</h1>
<p class="meta">обновлено: строит сборка при каждом прогоне</p>
<p class="disclaimer">Не заменяет врача. При угрозе жизни — 112.</p></header>
<main>
<p class="meta" id="source-count" data-source-count="${total}">${total} ${pluralCards(total)}: ${parts.join(', ')}</p>
<p>Порядок — от обзоров и мета-анализов к отдельным наблюдениям, внутри типа — по году, затем по названию. Это порядок показа, а не рейтинг: тип говорит, какие выводы исследование в принципе позволяет, и не заменяет оценку качества (почему мы не считаем GRADE — <a href="${BASE}ru/dokazatelnost/">на странице о доказательствах</a>).</p>
<table class="sources"><thead><tr><th>Источник</th><th>Год</th><th>Тип</th><th>Цитируется в темах</th><th>PMID / DOI</th></tr></thead><tbody>${rows}</tbody></table>
</main>
<footer><p><a href="${BASE}ru/">Все темы</a> · <a href="${BASE}ru/kak-my-rabotaem/" lang="ru">Как мы работаем</a> · <a href="${BASE}">psybase</a></p></footer>
</body></html>`;
}
function sourceCardPage({ id, card, topicTitles, topicsCited, citationState, cards }) {
  const url = sourceHref(id);
  const cited = topicsCited.length
    ? `<ul>${topicsCited
        .map((slug) => `<li><a href="${BASE}ru/${slug}/">${esc(topicTitles.get(slug) ?? slug)}</a></li>`)
        .join('')}</ul>`
    : citationState === 'app'
      ? `<p class="meta">Ни в одной теме: карточка цитируется только в приложении «Опора».</p>`
      : citationState === 'research'
        ? `<p class="meta">Ни в одной теме: карточка собрана из сырья исследования (<code>research/</code>), темы пока нет.</p>`
        : `<p class="meta">Ни в одной теме: карточка пока нигде не цитируется — это ошибка, её должен поймать <code>node tools/status.mjs</code>.</p>`;
  const body = renderBody(card.body.split(/\r?\n/), { lang: 'ru', cards, typesTable: '' });
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(card.title ?? id)} — источник — Пси-база</title><link rel="canonical" href="${url}">
<link rel="stylesheet" href="${BASE}style.css"></head><body>
<nav class="langs"><a href="${BASE}ru/istochniki/">Все источники</a> · <span class="no-translation" lang="ru">EN — перевода нет</span></nav>
<header><h1>${esc(card.title ?? id)}</h1>
<p class="meta">${esc(card.year ?? '')} · <span class="badge badge-${esc(card.type ?? '')}">${esc(card.type ?? '')}</span> · язык оригинала: ${esc(card.lang ?? '—')} · сверено ${esc(asRuDate(card.accessed) || '—')}</p>
<p class="disclaimer">Не заменяет врача. При угрозе жизни — 112.</p></header>
<main>
<p class="cite">${citationInner(card) || 'идентификатор не указан'}</p>
<section><h2>Что мы взяли</h2>
<p>${esc(String(card.taken ?? '').trim())}</p>
<p class="meta">«Что мы взяли» — наша формулировка из источника, а не его аннотация; дословных кусков текста здесь нет.</p></section>
<section><h2>Чем читали</h2><p class="read" data-read="${esc(String(card.read ?? 'unknown').trim())}">${esc(readLine(card))}</p>${body.trim() || '<p class="meta">—</p>'}</section>
<section><h2>Цитируется в темах</h2>${cited}</section>
<p><a href="${BASE}ru/istochniki/">← все источники</a> · <a href="${BASE}ru/">все темы</a></p>
</main>
<footer><p><a href="${BASE}ru/istochniki/">Все источники</a> · <a href="${BASE}ru/">Все темы</a> · <a href="${BASE}ru/kak-my-rabotaem/" lang="ru">Как мы работаем</a></p></footer>
</body></html>`;
}
function citationInner(card) {
  const id = card.id ?? '';
  const doi = card.doi ?? '';
  const pmid = id.match(/^PMID\s+(\d+)$/i);
  const parts = [];
  if (pmid) parts.push(`PMID <a href="https://pubmed.ncbi.nlm.nih.gov/${pmid[1]}/" rel="noopener">${pmid[1]}</a>`);
  else if (/^https?:\/\//.test(id)) parts.push(`<a href="${esc(id)}" rel="noopener">источник</a>`);
  if (doi) parts.push(`DOI <a href="https://doi.org/${esc(doi)}" rel="noopener">${esc(doi)}</a>`);
  return parts.join(' · ');
}
function citation(card) {
  const inner = citationInner(card);
  return inner ? ` <span class="cite">${inner}</span>` : '';
}
function cite(html, cards) {
  return html.replace(/<li>(?:(?!<\/li>)[\s\S])*?<\/li>/g, (li) =>
    li.replace(/<span class="src" data-src="([a-z0-9-]+)">[\s\S]*?<\/span>/g, (m, slug) => {
      const card = cards.get(slug);
      return card ? `${m}${citation(card)}` : m;
    }),
  );
}
const CSS = `body{max-width:46rem;margin:0 auto;padding:1.5rem;font:16px/1.6 system-ui,sans-serif;color:#1b1b1b}h1{font-size:1.7rem;line-height:1.25}h2{margin-top:2rem;border-bottom:1px solid #ddd;padding-bottom:.2rem}.meta{color:#555;font-size:.9rem}.disclaimer{background:#fff4e5;border-left:4px solid #c77;padding:.7rem 1rem;margin:1rem 0}.age-marker{display:inline-block;border:1px solid #c77;background:#fff4e5;color:#8a2b2b;font-weight:600;padding:.05rem .45rem;margin:.2rem 0}.badge{font-size:.72rem;text-transform:uppercase;letter-spacing:.03em;background:#eee;border-radius:3px;padding:.05rem .35rem}.badge-meta{background:#d7f0d7}.badge-rct{background:#d7e8f7}.badge-cohort{background:#e7e2f7}.badge-case{background:#f7e7d7}.badge-review{background:#f2f2d0}.badge-opinion{background:#f7d7d7}.badge-unsure{background:#eee;color:#a00}.src{font-family:ui-monospace,monospace;font-size:.9em}.cite{color:#555;font-size:.85em}.not-found{background:#f6f6f6;padding:.2rem 1rem}nav.langs a{margin-right:.6rem}nav.langs .no-translation{color:#777;font-size:.9rem}.rt{color:#777;font-size:.85rem}footer{margin-top:3rem;border-top:1px solid #ddd;padding-top:.8rem;font-size:.85rem;color:#555}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #ccc;padding:.25rem .5rem}
.chart{margin:1.2rem 0;border:1px solid #ddd;padding:.8rem;break-inside:avoid}
.chart-caption{color:#555;font-size:.85rem;margin:0 0 .6rem}
.chart-row{display:flex;align-items:center;gap:.5rem;margin:.25rem 0}
.chart-label{flex:0 0 40%;font-size:.9rem}
.chart-track{position:relative;flex:1 1 auto;height:.9rem;background:#f2f2f2;border:1px solid #ddd}
.chart-bar{position:absolute;top:0;bottom:0;background:#8ab4d8;border-right:2px solid #1b1b1b}
.chart-bar-funnel{background:#6f9fc9}
.chart-value{flex:0 0 3.6rem;text-align:right;font-family:ui-monospace,monospace;font-size:.85rem}
.chart-axis{display:flex;justify-content:space-between;color:#666;font-size:.75rem;margin:.15rem 0 .5rem;padding-left:calc(40% + .5rem);padding-right:calc(3.6rem + .5rem)}
.chart-table{width:100%;font-size:.85rem;margin-top:.6rem}
.chart-table caption{text-align:left;color:#555;font-size:.8rem;padding-bottom:.2rem}
.evidence,.gaps{margin-top:2rem;border-top:1px solid #ddd;padding-top:.6rem}
.levels{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:.6rem;margin:.4rem 0}
.home-stats{border:1px solid #ddd;padding:.6rem .9rem;margin:1rem 0}
@media print{.chart,.evidence,.gaps,.home-stats{break-inside:avoid}.chart-bar{-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#ccc!important;border-right:1px solid #000}.chart-track{border:1px solid #000}}
@media(max-width:480px){body{padding:.9rem;font-size:15px}h1{font-size:1.35rem}h2{font-size:1.1rem}table{display:block;overflow-x:auto}td,th{padding:.2rem .35rem;font-size:.9rem}}
@media print{@page{margin:14mm}body{max-width:100%;padding:0;font-size:11pt;color:#000}nav.langs,footer{display:none}h1{font-size:16pt;break-after:avoid}h2{font-size:13pt;border-bottom:1px solid #000;break-after:avoid}.disclaimer{border-left:2px solid #000;background:#fff;padding:.3rem .6rem}.badge{border:1px solid #777;background:#fff!important;color:#000!important}.not-found{background:#fff;border:1px solid #999;break-inside:avoid}p,li{break-inside:avoid;orphans:2;widows:2}a{color:#000;text-decoration:underline}td,th{border:1px solid #000}}`;
function page({ lang, slug, title, updated, sections, cards, hasPair, stats, typesTable = '', readStats: readStatsText = '', age = '', sourceText = '' }) {
  const ru = `${BASE}ru/${slug}/`;
  const en = `${BASE}en/${slug}/`;
  const ctx = {
    lang,
    cards,
    typesTable,
    readStats: readStatsText,
    pageLabel: `${lang}/${slug}`,
    sourceText: proseOnly(sourceText),
    chartNo: 0,
  };
  const body = sections
    .map((s) => {
      if (!s.title) return `<section>${renderBody(s.lines, ctx)}</section>`;
      const nf = /^(Не нашёл|Not found)$/i.test(s.title);
      const isSources = /^(Источники|Sources)$/i.test(s.title);
      const html = renderBody(s.lines, ctx);
      // В списке «Источники» каждый пункт — ссылка на страницу карточки, а не
      // только пометка типа. В тексте ссылку не ставим: там число важнее
      // навигации, и карточка открывается с пометки типа.
      const inner = isSources
        ? cite(html, cards).replace(
            /<span class="src" data-src="([a-z0-9-]+)">([\s\S]*?)<\/span>(?: <span class="badge[^"]*">[a-z]+<\/span>)?/g,
            (m, id, label) => {
              const card = cards.get(id);
              const type = card?.type ? String(card.type) : '';
              const badge = type
                ? ` <span class="badge badge-${esc(type)}">${esc(type)}</span>`
                : '';
              return `<a class="src" href="${sourceHref(id)}">${label}</a>${badge}`;
            },
          )
        : html;
      return `<section${nf ? ' class="not-found"' : ''}><h2${nf ? ' id="not-found"' : ''}>${inline(s.title)}</h2>${inner}</section>`;
    })
    .join('\n');
  const disclaimer = lang === 'ru' ? 'Не заменяет врача. При угрозе жизни — 112.' : 'Not a substitute for a doctor. If life is in danger, call 112.';
  const updatedLabel = lang === 'ru' ? 'обновлено' : 'updated';
  // hreflang — только для настоящих пар; x-default всегда на RU
  const alternates = hasPair
    ? `<link rel="alternate" hreflang="ru" href="${SITE}ru/${slug}/"><link rel="alternate" hreflang="en" href="${SITE}en/${slug}/"><link rel="alternate" hreflang="x-default" href="${SITE}ru/${slug}/">`
    : '';
  // переключатель языка — только там, где вторая страница настоящая; иначе текст,
  // а не ссылка: ссылка на маршрут-редирект даёт петлю
  const langsNav = hasPair
    ? `<a href="${ru}"${lang === 'ru' ? ' aria-current="page"' : ''}>Русский</a><a href="${en}"${lang === 'en' ? ' aria-current="page"' : ''}>English</a>`
    : `<span class="no-translation" lang="ru">EN — перевода нет</span>`;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="canonical" href="${SITE}${lang}/${slug}/">
${alternates}
<link rel="stylesheet" href="${BASE}style.css"></head><body>
<nav class="langs">${langsNav}</nav>
<header><h1>${esc(title)}</h1>
<p class="meta">${updatedLabel}: ${esc(updated)}</p>
${age ? `<p class="age-marker">${esc(age)}</p>` : ''}
<p class="disclaimer">${disclaimer}</p></header>
<main>${body}
${stats ? evidenceHtml(stats, lang) : ''}
</main>
<footer><p><a href="${BASE}${lang}/">${lang === 'ru' ? 'Все темы' : 'All topics'}</a> · <a href="${BASE}ru/kak-my-rabotaem/" lang="ru">Как мы работаем</a> · <a href="${BASE}">psybase</a></p></footer>
</body></html>`;
}
// /en/<slug>/ для темы без перевода — страница-маршрут: canonical на RU, noindex,
// refresh 0 и видимая ссылка. Не копия текста: копия дала бы дубль в выдаче,
// а маршрут — нет. В sitemap такие адреса не попадают.
function routePage({ slug, title, updated }) {
  const ru = `${SITE}ru/${slug}/`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,follow">
<meta http-equiv="refresh" content="0;url=${BASE}ru/${slug}/">
<title>${esc(title)} — not translated</title><link rel="canonical" href="${ru}">
<link rel="stylesheet" href="${BASE}style.css"></head><body>
<h1>${esc(title)}</h1>
<p>This topic is not translated yet — <a href="${BASE}ru/${slug}/">open in Russian</a>.</p>
<p class="meta">updated: ${esc(updated)}</p>
</body></html>`;
}
function build() {
  const inputs = buildFingerprint(ROOT);
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  const cards = loadCards();
  const readCounts = readStats(cards);
  const readSummary = `Основа чтения названа у ${readCounts.named} из ${cards.size}; у ${readCounts.unknown} не записана`;
  const dirs = readdirSync(TOPICS).filter((d) => statSync(join(TOPICS, d)).isDirectory());
  const targets = FIXTURE ? dirs.filter((d) => d === '_example') : dirs;
  if (FIXTURE && !targets.length) throw new Error('фикстура topics/_example не найдена');
  // RU — канон, всегда. EN — только там, где перевод есть; иначе маршрут.
  const topics = [];
  let skipped = 0;
  for (const slug of targets) {
    const ruPath = join(TOPICS, slug, 'ru.md');
    const enPath = join(TOPICS, slug, 'en.md');
    if (!existsSync(ruPath)) throw new Error(`topics/${slug}: нет ru.md — RU канон обязателен`);
    const ru = frontMatter(readFileSync(ruPath, 'utf8'));
    if (!FIXTURE && String(ru.data.draft).trim() === 'true') {
      console.log(`пропущено (draft: true): topics/${slug}`);
      skipped++;
      continue;
    }
    if (!FIXTURE && !/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`слаг «${slug}» не годится: только a-z, 0-9 и дефис`);
    const ruSections = splitSections(ru.body);
    if (!ruSections.some((s) => /^(Не нашёл|Not found)$/i.test(s.title ?? ''))) throw new Error(`topics/${slug}/ru.md: нет раздела «Не нашёл»`);
    const en = existsSync(enPath) ? frontMatter(readFileSync(enPath, 'utf8')) : null;
    const enSections = en ? splitSections(en.body) : null;
    if (enSections && !enSections.some((s) => /^(Не нашёл|Not found)$/i.test(s.title ?? ''))) throw new Error(`topics/${slug}/en.md: нет раздела «Not found»`);
    topics.push({
      slug,
      ru,
      en,
      ruSections,
      enSections,
      ruStats: topicStats(ru),
      enStats: en ? topicStats(en) : null,
    });
  }

  const home = homeStats(topics, cards.size);

  // pages/ — каталог, не темы: страницы не входят в «Тем: N» на главной и не
  // получают счётчик источников. Пока только RU: en.md у страницы — ошибка,
  // иначе сборка молча потеряла бы перевод.
  const pages = [];
  if (existsSync(PAGES)) {
    for (const slug of readdirSync(PAGES).filter((d) => statSync(join(PAGES, d)).isDirectory())) {
      if (slug.startsWith('.')) continue;
      const ruPath = join(PAGES, slug, 'ru.md');
      if (!existsSync(ruPath)) throw new Error(`pages/${slug}: нет ru.md — страница без текста не собирается`);
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`pages: слаг «${slug}» не годится: только a-z, 0-9 и дефис`);
      if (existsSync(join(PAGES, slug, 'en.md'))) throw new Error(`pages/${slug}/en.md: страницы каталога пока только RU`);
      const ru = frontMatter(readFileSync(ruPath, 'utf8'));
      const fmSlug = String(ru.data.slug ?? '').trim();
      if (fmSlug !== slug) throw new Error(`pages/${slug}/ru.md: во front-matter slug «${fmSlug}», а папка «${slug}»`);
      if (!String(ru.data.title ?? '').trim()) throw new Error(`pages/${slug}/ru.md: во front-matter нет title`);
      // Страница доказательности обещает таблицу типов с числами из sources/.
      // Без {{types}} она молча останется без чисел, поэтому это ошибка сборки,
      // а не «страница без таблицы».
      if (slug === 'dokazatelnost' && !ru.body.includes('{{types}}')) {
        throw new Error(
          `pages/${slug}/ru.md: нет {{types}} — таблица типов не соберётся из sources/, а страница о доказательствах без чисел не публикуется`,
        );
      }
      pages.push({ slug, ru, sections: splitSections(ru.body) });
    }
  }

  let ruPages = 0;
  let enPages = 0;
  for (const t of topics) {
    const titleRu = t.ru.data.title ?? t.slug;
    mkdirSync(join(DIST, 'ru', t.slug), { recursive: true });
    writeFileSync(
      join(DIST, 'ru', t.slug, 'index.html'),
      page({
        lang: 'ru',
        slug: t.slug,
        title: titleRu,
        updated: t.ru.data.updated ?? '',
        sections: t.ruSections,
        cards,
        hasPair: Boolean(t.en),
        stats: t.ruStats,
        age: String(t.ru.data.age ?? ''),
        sourceText: t.ru.body,
      }),
      'utf8',
    );
    ruPages++;
    mkdirSync(join(DIST, 'en', t.slug), { recursive: true });
    if (!t.en) {
      writeFileSync(
        join(DIST, 'en', t.slug, 'index.html'),
        routePage({ slug: t.slug, title: titleRu, updated: t.ru.data.updated ?? '' }),
        'utf8',
      );
      continue;
    }
    writeFileSync(
      join(DIST, 'en', t.slug, 'index.html'),
      page({
        lang: 'en',
        slug: t.slug,
        title: t.en.data.title ?? t.slug,
        updated: t.en.data.updated ?? '',
        sections: t.enSections,
        cards,
        hasPair: true,
        stats: t.enStats ?? t.ruStats,
        age: String(t.en?.data.age ?? ''),
        sourceText: t.en.body,
      }),
      'utf8',
    );
    enPages++;
  }
  const topicSlugs = new Set(topics.map((t) => t.slug));
  const topicTitles = new Map(topics.map((t) => [t.slug, t.ru.data.title ?? t.slug]));
  const cardTopics = cardTopicMap(topics);
  const cardApps = cardAppMap();
  const cardPmid = new Map();
  for (const [slug, card] of cards) {
    const m = String(card.id ?? '').match(/PMID\s*(\d+)/i);
    if (m) cardPmid.set(slug, m[1]);
  }
  const citation = classifyCitations({
    cards: [...cards.keys()],
    topicRefs: cardTopics,
    appRefs: cardApps,
    researchPmids: readResearchPmids(join(ROOT, 'research')),
    cardPmid,
  });
  const citationState = new Map();
  for (const c of citation.inTopics) citationState.set(c, 'topics');
  for (const c of citation.appOnly) citationState.set(c, 'app');
  for (const c of citation.researchOnly) citationState.set(c, 'research');
  for (const c of citation.nowhere) citationState.set(c, 'nowhere');
  for (const id of cardTopics.keys()) {
    if (!cards.has(id)) throw new Error(`тема цитирует sources/${id}.md, а такой карточки нет — ссылка в никуда`);
  }
  // Страницы источников: индекс + страница на каждую карточку. Адрес — по
  // слагу карточки, поэтому «цитируется в темах» ведёт только на существующие
  // темы (проверено выше), а индекс собирается из того же списка файлов.
  mkdirSync(join(DIST, 'ru', 'istochniki'), { recursive: true });
  writeFileSync(
    join(DIST, 'ru', 'istochniki', 'index.html'),
    sourceIndexPage({ cards, topicTitles, cardTopics, appOnly: new Set(citation.appOnly) }),
    'utf8',
  );
  for (const [id, card] of cards) {
    mkdirSync(join(DIST, 'ru', 'istochniki', id), { recursive: true });
    writeFileSync(
      join(DIST, 'ru', 'istochniki', id, 'index.html'),
      sourceCardPage({ id, card, topicTitles, topicsCited: [...(cardTopics.get(id) ?? [])], citationState: citationState.get(id), cards }),
      'utf8',
    );
  }
  for (const p of pages) {
    if (topicSlugs.has(p.slug)) throw new Error(`pages/${p.slug} и topics/${p.slug}: один адрес /ru/${p.slug}/ на двоих`);
    mkdirSync(join(DIST, 'ru', p.slug), { recursive: true });
    writeFileSync(
      join(DIST, 'ru', p.slug, 'index.html'),
      page({
        lang: 'ru',
        slug: p.slug,
        title: p.ru.data.title,
        updated: p.ru.data.updated ?? '',
        sections: p.sections,
        cards,
        hasPair: false,
        stats: null,
        typesTable: typesTable(cards),
        readStats: readSummary,
        age: String(p.ru.data.age ?? ''),
        sourceText: p.ru.body,
      }),
      'utf8',
    );
  }
  const homeHtml = (lang) => {
    const ru = lang === 'ru';
    const num = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `<section class="home-stats"><h2>${ru ? 'Что есть в базе' : 'What the base contains'}</h2>
<p class="meta">${ru
      ? `Тем: ${num(home.topics)} · <a href="${BASE}ru/istochniki/">карточек источников: ${num(home.cards)}</a> · утверждений со ссылкой на источник: ${num(home.claims)} · вопросов без ответа: ${num(home.notFound)}, из них ${num(home.closedDoors)} — источник не открылся`
      : `Topics: ${num(home.topics)} · source cards: ${num(home.cards)} · claims with a source link: ${num(home.claims)} · unanswered: ${num(home.notFound)}, ${num(home.closedDoors)} of them a source would not open`}</p>
<p class="meta">${ru ? 'Числа считает сборка из файлов, руками не правятся.' : 'Numbers are computed by the build from the files, never typed by hand.'}</p>
</section>`;
  };
  const index = (lang) => {
    const items = topics
      .map((t) => {
        const titleRu = t.ru.data.title ?? t.slug;
        if (lang === 'ru') return `<li><a href="${BASE}ru/${t.slug}/">${esc(titleRu)}</a></li>`;
        if (t.en) return `<li><a href="${BASE}en/${t.slug}/">${esc(t.en.data.title ?? t.slug)}</a></li>`;
        // непереведённая тема видна в EN-индексе с пометкой: долг перевода не прячется
        return `<li><span lang="ru">${esc(titleRu)}</span> <span class="rt">(RU)</span> — <a href="${BASE}ru/${t.slug}/">open in Russian</a></li>`;
      })
      .join('');
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${lang === 'ru' ? 'Пси-база — все темы' : 'Psybase — all topics'}</title>
<link rel="canonical" href="${SITE}${lang}/"><link rel="alternate" hreflang="ru" href="${SITE}ru/"><link rel="alternate" hreflang="en" href="${SITE}en/"><link rel="stylesheet" href="${BASE}style.css"></head><body>
<h1>${lang === 'ru' ? 'Пси-база' : 'Psybase'}</h1>
<p class="disclaimer">${lang === 'ru' ? 'Не заменяет врача. При угрозе жизни — 112.' : 'Not a substitute for a doctor. If life is in danger, call 112.'}</p>
<nav class="langs"><a href="${BASE}ru/">Русский</a><a href="${BASE}en/">English</a></nav>
${homeHtml(lang)}
<ul>${items}</ul>
<nav class="pages-nav"><h2>${lang === 'ru' ? 'Ещё о базе' : 'More about the base'}</h2><ul>
<li><a href="${BASE}ru/istochniki/">${lang === 'ru' ? 'Все источники' : 'All sources'}</a>${lang === 'en' ? ' <span class="rt">(RU)</span>' : ''}</li>
${pages
  .map((p) => {
    const navTitle = lang === 'en' ? (p.ru.data.title_en ?? p.ru.data.title) : p.ru.data.title;
    return `<li><a href="${BASE}ru/${p.slug}/">${esc(navTitle)}</a>${lang === 'en' ? ' <span class="rt">(RU)</span>' : ''}</li>`;
  })
  .join('\n')}
</ul></nav>
</body></html>`;
  };
  for (const lang of ['ru', 'en']) mkdirSync(join(DIST, lang), { recursive: true });
  writeFileSync(join(DIST, 'style.css'), CSS, 'utf8');
  writeFileSync(join(DIST, 'ru', 'index.html'), index('ru'), 'utf8');
  writeFileSync(join(DIST, 'en', 'index.html'), index('en'), 'utf8');
  writeFileSync(
    join(DIST, 'index.html'),
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${BASE}ru/"><title>Пси-база</title><link rel="canonical" href="${SITE}ru/"><link rel="alternate" hreflang="ru" href="${SITE}ru/"><link rel="alternate" hreflang="en" href="${SITE}en/"><link rel="stylesheet" href="${BASE}style.css"></head><body><a href="${BASE}ru/">Пси-база</a></body></html>`,
    'utf8',
  );
  writeFileSync(join(DIST, '404.html'), `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Страница не найдена — Пси-база</title><link rel="stylesheet" href="${BASE}style.css"></head><body><h1>404</h1><p>Страницы нет. <a href="${BASE}ru/">Все темы</a> · <a href="${BASE}en/">All topics</a></p></body></html>`, 'utf8');
  writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`, 'utf8');
  // в карту только настоящие страницы: маршруты-редиректы не индексируются
  const urls = [
    `${SITE}ru/`,
    `${SITE}en/`,
    ...topics.map((t) => `${SITE}ru/${t.slug}/`),
    ...topics.filter((t) => t.en).map((t) => `${SITE}en/${t.slug}/`),
    ...pages.map((p) => `${SITE}ru/${p.slug}/`),
    `${SITE}ru/istochniki/`,
    ...cards.keys().map((id) => `${SITE}ru/istochniki/${id}/`),
  ];
  writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`, 'utf8');
  // Отпечаток входов для status.mjs: сравнение по содержимому, а не по mtime.
  // Лежит в корне и в git не попадает: dist/ остаётся ровно тем, что
  // публикуется, без служебного файла на сайте.
  if (!FIXTURE) {
    writeFileSync(join(ROOT, '.build.json'), JSON.stringify({ inputs }) + '\n', 'utf8');
  }
  const bytes = dirBytes(DIST);
  for (const f of filesUnder(DIST)) {
    const text = readFileSync(f, 'utf8');
    if (text.includes('{{')) {
      throw new Error(`${f.replace(DIST + '\\', '').replace(DIST + '/', '')} — остался незаменённый «{{…}}»: шаблон страницы не собран`);
    }
  }
  if (chartChecks.length) {
    let missTotal = 0;
    for (const c of chartChecks) {
      const head = `· график ${c.page} #${c.no} (${c.source})`;
      if (!c.missing.length) {
        if (c.total === 1) {
          console.log(`${head}: значение найдено в тексте дословно`);
        } else {
          const nWord = c.total < 5 ? 'значения' : 'значений';
          console.log(`${head}: все ${c.total} ${nWord} найдены в тексте дословно`);
        }
      } else {
        missTotal += c.missing.length;
        const word = c.missing.length === 1 ? 'значение' : 'значения';
        const tail = c.missing.length === 1 ? 'не найдено' : 'не найдены';
        console.log(
          `${head}: ${word} ${c.missing.map((m) => `«${m}»`).join(', ')} ${tail} в тексте дословно`,
        );
      }
    }
    const chartPages = new Set(chartChecks.map((c) => c.page)).size;
    console.log(`· графики: ${chartChecks.length} на ${chartPages} страницах, значений не найдено: ${missTotal}`);
  }
  console.log(`сборка: ${DIST}`);
  console.log(`страниц: ${ruPages + enPages} (RU ${ruPages}, EN ${enPages}, тем без перевода: ${ruPages - enPages}), пропущено draft: ${skipped}, размер: ${bytes} байт`);
  console.log(`страниц каталога: ${pages.length} (в «Тем: N» не входят, адрес ${BASE}ru/<slug>/)`);
  console.log(`страниц источников: ${cards.size + 1} (индекс + ${cards.size} карточек, адрес ${BASE}ru/istochniki/<id>/)`);
  console.log(`адреса: ${BASE}ru/<slug>/ для всех тем, ${BASE}en/<slug>/ — перевод или маршрут на RU`);
  if (FIXTURE) console.log('режим --fixture: topics/_example, во временную папку');
}
function filesUnder(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out;
}
function dirBytes(dir) {
  let n = 0;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    n += st.isDirectory() ? dirBytes(p) : st.size;
  }
  return n;
}
try {
  build();
} catch (err) {
  console.error(`✖ сборка остановлена: ${err.message}`);
  process.exit(1);
}