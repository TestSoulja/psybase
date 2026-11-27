// Аудит отстающих тем: считает то, что видно на диске, без оценок.
// Запуск: node research/2026-11-27/audit-temy.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const TOPICS = {
  prl: ['prl-differenciaciya', 'prl-lechenie', 'prl-opredelenie-i-rasprostranennost', 'prl-preparaty-pobochnye-i-otmena', 'prl-semya-i-vlidaciya', 'prl-stigma-i-yazyk', 'prl-suicidalnost-i-samopovrezhdenie', 'prl-techenie-vozrast'],
  depressiya: ['depressiya-epidemiologiya', 'depressiya-lechenie', 'komorbidnost-i-razlichenie'],
  'depressiya-i-prl': ['depressiya-epidemiologiya', 'depressiya-lechenie', 'komorbidnost-i-razlichenie'],
  'povedencheskaya-aktivaciya': ['nakat-i-navyki'],
  antidepressanty: ['depressiya-lechenie', 'antidepressanty-i-suicidalnost-u-molodyh'],
  razlichenie: ['komorbidnost-i-razlichenie', 'prl-differenciaciya'],
};

const read = (p) => readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const norm = (s) => s.replace(/\u00a0/g, ' ');

function front(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  const out = {};
  if (m) for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].replace(/^"|"$/g, '');
  }
  return out;
}

function sectionItems(text, title) {
  const start = text.indexOf(`## ${title}`);
  if (start < 0) return 0;
  const rest = text.slice(start + title.length + 3);
  const next = rest.search(/\n## /);
  const body = next < 0 ? rest : rest.slice(0, next);
  return (body.match(/^- /gm) || []).length;
}

// Проценты: «12 %», «12%», «12,5 %». Приводим к виду «12.5».
function percents(text) {
  const set = new Set();
  for (const m of text.matchAll(/(\d+(?:[.,]\d+)?)\s?%/g)) set.add(m[1].replace(',', '.'));
  return set;
}

const pct = (s) => `${s.size}`;

// Карточки: PMID -> слаг.
const pmidToSlug = new Map();
for (const f of readdirSync(join(ROOT, 'sources'))) {
  if (!f.endsWith('.md')) continue;
  const text = read(join(ROOT, 'sources', f));
  const id = (front(text).id || '') + ' ' + (front(text).doi || '');
  for (const m of id.matchAll(/(?:PMID\s*)?(\d{5,9})/g)) {
    if (/PMID/.test(id) && !pmidToSlug.has(m[1])) pmidToSlug.set(m[1], f.slice(0, -3));
  }
}

const cardTaken = new Map();
for (const f of readdirSync(join(ROOT, 'sources'))) {
  if (!f.endsWith('.md')) continue;
  const text = read(join(ROOT, 'sources', f));
  cardTaken.set(f.slice(0, -3), (front(text).taken || '').replace(/\s+/g, ' '));
}

const rows = [];
const details = [];
for (const [slug, journals] of Object.entries(TOPICS)) {
  const topicPath = join(ROOT, 'topics', slug, 'ru.md');
  const topic = read(topicPath);
  const cited = new Set([...topic.matchAll(/\.\.\/sources\/([a-z0-9-]+)\.md/g)].map((m) => m[1]));
  let jLines = 0;
  let jText = '';
  const jPmids = new Set();
  for (const j of journals) {
    const p = join(ROOT, 'research', '2026-11-25', `${j}.md`);
    if (!existsSync(p)) continue;
    const t = read(p);
    jLines += t.split('\n').length;
    jText += '\n' + t;
    for (const m of t.matchAll(/\bPMID[\s:]*(\d{5,9})\b/g)) jPmids.add(m[1]);
  }
  const uncited = [...jPmids]
    .map((id) => ({ id, slug: pmidToSlug.get(id) }))
    .filter((x) => x.slug && !cited.has(x.slug));
  const noCard = [...jPmids].filter((id) => !pmidToSlug.has(id));
  const jP = percents(jText);
  const tPn = percents(topic);
  const missingP = [...jP].filter((n) => !tPn.has(n)).sort((a, b) => Number(a) - Number(b));
  rows.push({
    slug,
    cards: cited.size,
    lines: topic.split('\n').length,
    pct: pct(tPn),
    notFound: sectionItems(topic, 'Не нашёл'),
    jLines,
    jPct: pct(jP),
    jPmids: jPmids.size,
    jPmidsWithCard: jPmids.size - noCard.length,
    jPmidsNoCard: noCard.length,
    uncitedCards: uncited.length,
    uncitedPct: missingP.length,
  });
  details.push({ slug, uncited, missingP, noCard });
}

const head = '| Тема | Карточек в теме | Строк | Чисел «%» | Пунктов «Не нашёл» | Строк в журналах | Чисел «%» в журналах | PMID в журналах | из них с карточкой | без карточки | Карточек из журналов не в теме | Чисел «%» из журналов не в теме |\n|---|---|---|---|---|---|---|---|---|---|---|---|';
console.log(head);
for (const r of rows) {
  console.log(`| \`${r.slug}\` | ${r.cards} | ${r.lines} | ${r.pct} | ${r.notFound} | ${r.jLines} | ${r.jPct} | ${r.jPmids} | ${r.jPmidsWithCard} | ${r.jPmidsNoCard} | ${r.uncitedCards} | ${r.uncitedPct} |`);
}
console.log('\n## Не процитированные карточки и их числа\n');
for (const d of details) {
  console.log(`### ${d.slug}\n`);
  console.log(d.uncited.length ? d.uncited.map((x) => `- \`${x.slug}\` (PMID ${x.id}) — ${cardTaken.get(x.slug) || 'taken не записан'}`).join('\n') : '- нет');
  console.log('');
}
console.log('## Счёт чисел «%» из журналов, которых нет в теме (диагностика, не список к переносу)\n');
for (const d of details) console.log(`- \`${d.slug}\`: ${d.missingP.length}`);
console.log('\n## PMID из журналов без карточки (их числа не переносятся)\n');
for (const d of details) {
  console.log(`- \`${d.slug}\`: ${d.noCard.length}${d.noCard.length ? ' — ' + d.noCard.join(', ') : ''}`);
}
