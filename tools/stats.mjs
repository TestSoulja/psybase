/**
 * Счёт тем — один источник чисел для сборки и стражей.
 *
 * build.mjs печатает эти числа на главной (home: topics, cards, claims, notFound),
 * status.mjs сверяет с ними английскую шпаргалку. Пока формулы жили в двух
 * местах, страж мог «сходиться» с копией, а не со сборкой.
 */
export const LEVELS = ['meta', 'rct', 'cohort', 'case', 'review', 'opinion', 'unsure'];

export function frontMatter(text) {
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

export function splitSections(body) {
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

export function blockItems(sec) {
  if (!sec) return [];
  const text = sec.lines.join('\n').trim();
  if (!text) return [];
  const bullets = text.split('\n').filter((l) => /^\s*(?:[-*]|\d+\.)\s+/.test(l));
  if (bullets.length) return bullets.map((l) => l.replace(/^\s*(?:[-*]|\d+\.)\s+/, ''));
  return text.split(/\n\s*\n/).filter((p) => p.trim());
}

export function topicStats(doc) {
  const body = doc.body;
  const sections = splitSections(body);
  const find = (re) => sections.find((s) => re.test(s.title ?? ''));
  const levels = Object.fromEntries(LEVELS.map((l) => [l, 0]));
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

export function homeStats(topics, cards) {
  const home = { topics: topics.length, cards, claims: 0, closedDoors: 0, notFound: 0 };
  for (const t of topics) {
    home.claims += t.ruStats.claims;
    home.closedDoors += t.ruStats.closedDoors;
    home.notFound += t.ruStats.notFound;
  }
  return home;
}
