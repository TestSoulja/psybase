#!/usr/bin/env node
/**
 * Сборка статики: topics/<slug>/{ru,en}.md -> dist/{ru,en}/<slug>/index.html.
 * Без зависимостей; for-app/ не публикуется; сырой HTML не пропускается.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = '/psybase/'; // единственная константа адреса
const SITE = 'https://testsoulja.github.io' + BASE;
const FIXTURE = process.argv.includes('--fixture');
const DIST = FIXTURE ? join(tmpdir(), 'psybase-fixture-' + process.pid) : join(ROOT, 'dist');
const TOPICS = join(ROOT, 'topics');
const SOURCES = join(ROOT, 'sources');
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function frontMatter(text) {
  const m = text.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const data = {};
  for (const line of m ? m[1].split(/\r?\n/) : []) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    let v = line.slice(i + 1).trim();
    if (/^".*"$/.test(v)) v = v.slice(1, -1);
    data[line.slice(0, i).trim()] = v;
  }
  return { data, body: m ? text.replace(/^\uFEFF/, '').slice(m[0].length) : text };
}
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
  if (src) return `<span class="src" data-src="${src[1]}">${label}</span>${badge}`;
  if (/^https?:\/\//.test(href)) return `<a href="${esc(href)}" rel="noopener">${label}</a>${badge}`;
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
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
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
const CHART_LEVELS = ['meta', 'rct', 'cohort', 'case', 'review', 'opinion', 'unsure'];

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
function chartRange(raw) {
  const m = String(raw).match(/^([\d.]+)\s*[–—-]\s*([\d.]+)$/);
  if (m) return { lo: toNum(m[1]), hi: toNum(m[2]), raw };
  const v = toNum(raw);
  return { lo: v, hi: v, raw };
}

function chartHtml(raw, ctx) {
  const { lang, cards } = ctx;
  const ru = lang === 'ru';
  const d = parseChart(raw);
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
    throw new Error(`график: значение «${bad.raw}» не число (ось считается от нуля)`);
  }
  // У воронки все бары — доли от всех случаев: одна ось, один знаменатель.
  // Условные доли (из лечившихся) сюда не попадают — для них есть note.
  const widths = nums;
  const peak = Math.max(...nums.map((n) => n.hi));
  // Ось всегда от нуля. Верх шкалы — круглое число, а не «максимум данных»:
  // 100 для процентов, иначе ближайшее кратное, чтобы деления были целыми.
  const top = peak > 100 ? Math.ceil(peak / 40) * 40 : peak > 10 ? 100 : Math.max(4, Math.ceil(peak / 4) * 4);
  const pct = (v) => `${Math.max(0, Math.min(100, (v / top) * 100)).toFixed(2)}%`;
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
      return `<div class="chart-row"><span class="chart-label">${esc(label)}</span><span class="chart-track"><span class="${cls}" style="left:${left};width:${width}"></span></span><span class="chart-value">${esc(showVal(nums[idx]))}</span></div>`;
    })
    .join('');
  const axis = [0, top / 4, top / 2, (top * 3) / 4, top]
    .map((v) => `<span>${axisValue(v)}</span>`)
    .join('');
  const card = cards.get(d.source);
  const population = card && card.taken ? String(card.taken).split(' — ')[0].split(',').slice(0, 2).join(',').trim() : '';
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
  const noteBlock = noteText ? `<p class="chart-note">${noteText}</p>` : '';
  const noteRow = noteText
    ? `<tfoot><tr><th>${ru ? 'Примечание' : 'Note'}</th><td>${noteText}</td></tr></tfoot>`
    : '';
  return `<figure class="chart" data-chart="${esc(d.type)}">
<figcaption class="chart-caption">${ru ? 'Источник' : 'Source'}: ${esc(caption)}</figcaption>
<div class="chart-axis chart-axis-top">${axis}</div>
${bars}
<div class="chart-axis">${axis}</div>
<table class="chart-table"><caption>${ru ? 'Те же данные таблицей' : 'The same data as a table'}</caption>
<thead><tr><th>${ru ? 'Что' : 'What'}</th><th>${ru ? 'Значение' : 'Value'}</th></tr></thead><tbody>${rows}</tbody>${noteRow}</table>
${noteBlock}
</figure>`;
}

// --- счёт для главной и для блоков «состав доказательств» / «чего нет» ---------
function blockItems(sec) {
  if (!sec) return [];
  const text = sec.lines.join('\n').trim();
  if (!text) return [];
  const bullets = text.split('\n').filter((l) => /^\s*(?:[-*]|\d+\.)\s+/.test(l));
  if (bullets.length) return bullets.map((l) => l.replace(/^\s*(?:[-*]|\d+\.)\s+/, ''));
  return text.split(/\n\s*\n/).filter((p) => p.trim());
}

function topicStats(doc) {
  const body = doc.body;
  const sections = splitSections(body);
  const find = (re) => sections.find((s) => re.test(s.title ?? ''));
  const levels = Object.fromEntries(CHART_LEVELS.map((l) => [l, 0]));
  for (const m of body.matchAll(/`(meta|rct|cohort|case|review|opinion|unsure)`\)/g)) levels[m[1]]++;
  const claims = sections
    .filter((s) => !/^(Источники|Sources|Не нашёл|Not found|Не открылось|Not opened)$/i.test(s.title ?? ''))
    .flatMap((s) => s.lines.join('\n').split(/\n\s*\n/))
    .filter((p) => /\]\(\.\.\/sources\/[a-z0-9-]+\.md/.test(p)).length;
  const cards = new Set([...body.matchAll(/\.\.\/sources\/([a-z0-9-]+)\.md/g)].map((m) => m[1]));
  const notFoundItems = blockItems(find(/^(Не нашёл|Not found)$/i));
  // «не открылось» отдельным разделом в темах не ведётся — считаем упоминания
  // недоступного источника внутри «Не нашёл»: это и есть закрытые двери базы.
  const closedDoors = notFoundItems.filter((t) =>
    /не открыт|не открылось|not opened|нет доступа|no access|подписк|paywall/i.test(t),
  ).length;
  return {
    levels,
    claims,
    cards: cards.size,
    notFound: notFoundItems.length,
    closedDoors,
  };
}

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

function splitSections(body) {
  const secs = [];
  let cur = { title: null, lines: [] };
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^##\s+(.*)$/);
    if (m) {
      secs.push(cur);
      cur = { title: m[1].trim(), lines: [] };
    } else {
      cur.lines.push(line);
    }
  }
  secs.push(cur);
  return secs.filter((s) => s.title || s.lines.join('').trim());
}
function loadCards() {
  const cards = new Map();
  if (!existsSync(SOURCES)) return cards;
  for (const f of readdirSync(SOURCES).filter((x) => x.endsWith('.md'))) {
    const { data } = frontMatter(readFileSync(join(SOURCES, f), 'utf8'));
    cards.set(f.replace(/\.md$/, ''), data);
  }
  return cards;
}
function citation(card) {
  const id = card.id ?? '';
  const doi = card.doi ?? '';
  const pmid = id.match(/^PMID\s+(\d+)$/i);
  const parts = [];
  if (pmid) parts.push(`PMID <a href="https://pubmed.ncbi.nlm.nih.gov/${pmid[1]}/" rel="noopener">${pmid[1]}</a>`);
  else if (/^https?:\/\//.test(id)) parts.push(`<a href="${esc(id)}" rel="noopener">источник</a>`);
  if (doi) parts.push(`DOI <a href="https://doi.org/${esc(doi)}" rel="noopener">${esc(doi)}</a>`);
  return parts.length ? ` <span class="cite">${parts.join(' · ')}</span>` : '';
}
function cite(html, cards) {
  return html.replace(/<li>(?:(?!<\/li>)[\s\S])*?<\/li>/g, (li) =>
    li.replace(/<span class="src" data-src="([a-z0-9-]+)">[\s\S]*?<\/span>/g, (m, slug) => {
      const card = cards.get(slug);
      return card ? `${m}${citation(card)}` : m;
    }),
  );
}
const CSS = `body{max-width:46rem;margin:0 auto;padding:1.5rem;font:16px/1.6 system-ui,sans-serif;color:#1b1b1b}h1{font-size:1.7rem;line-height:1.25}h2{margin-top:2rem;border-bottom:1px solid #ddd;padding-bottom:.2rem}.meta{color:#555;font-size:.9rem}.disclaimer{background:#fff4e5;border-left:4px solid #c77;padding:.7rem 1rem;margin:1rem 0}.badge{font-size:.72rem;text-transform:uppercase;letter-spacing:.03em;background:#eee;border-radius:3px;padding:.05rem .35rem}.badge-meta{background:#d7f0d7}.badge-rct{background:#d7e8f7}.badge-cohort{background:#e7e2f7}.badge-case{background:#f7e7d7}.badge-review{background:#f2f2d0}.badge-opinion{background:#f7d7d7}.badge-unsure{background:#eee;color:#a00}.src{font-family:ui-monospace,monospace;font-size:.9em}.cite{color:#555;font-size:.85em}.not-found{background:#f6f6f6;padding:.2rem 1rem}nav.langs a{margin-right:.6rem}nav.langs .no-translation{color:#777;font-size:.9rem}.rt{color:#777;font-size:.85rem}footer{margin-top:3rem;border-top:1px solid #ddd;padding-top:.8rem;font-size:.85rem;color:#555}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #ccc;padding:.25rem .5rem}
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
function page({ lang, slug, title, updated, sections, cards, hasPair, stats }) {
  const ru = `${BASE}ru/${slug}/`;
  const en = `${BASE}en/${slug}/`;
  const ctx = { lang, cards };
  const body = sections
    .map((s) => {
      if (!s.title) return `<section>${renderBody(s.lines, ctx)}</section>`;
      const nf = /^(Не нашёл|Not found)$/i.test(s.title);
      const isSources = /^(Источники|Sources)$/i.test(s.title);
      const html = renderBody(s.lines, ctx);
      const inner = isSources ? cite(html, cards) : html;
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
<p class="disclaimer">${disclaimer}</p></header>
<main>${body}
${stats ? evidenceHtml(stats, lang) : ''}
</main>
<footer><p><a href="${BASE}${lang}/">${lang === 'ru' ? 'Все темы' : 'All topics'}</a> · <a href="${BASE}">psybase</a></p></footer>
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
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  const cards = loadCards();
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

  const home = { topics: topics.length, cards: cards.size, claims: 0, closedDoors: 0, notFound: 0 };
  for (const t of topics) {
    home.claims += t.ruStats.claims;
    home.closedDoors += t.ruStats.closedDoors;
    home.notFound += t.ruStats.notFound;
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
      }),
      'utf8',
    );
    enPages++;
  }
  const homeHtml = (lang) => {
    const ru = lang === 'ru';
    const num = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `<section class="home-stats"><h2>${ru ? 'Что есть в базе' : 'What the base contains'}</h2>
<p class="meta">${ru
      ? `Тем: ${num(home.topics)} · карточек источников: ${num(home.cards)} · утверждений со ссылкой на источник: ${num(home.claims)} · вопросов без ответа: ${num(home.notFound)}, из них ${num(home.closedDoors)} — источник не открылся`
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
  ];
  writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`, 'utf8');
  const bytes = dirBytes(DIST);
  console.log(`сборка: ${DIST}`);
  console.log(`страниц: ${ruPages + enPages} (RU ${ruPages}, EN ${enPages}, тем без перевода: ${ruPages - enPages}), пропущено draft: ${skipped}, размер: ${bytes} байт`);
  console.log(`адреса: ${BASE}ru/<slug>/ для всех тем, ${BASE}en/<slug>/ — перевод или маршрут на RU`);
  if (FIXTURE) console.log('режим --fixture: topics/_example, во временную папку');
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