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
function renderBody(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
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
const CSS = `body{max-width:46rem;margin:0 auto;padding:1.5rem;font:16px/1.6 system-ui,sans-serif;color:#1b1b1b}h1{font-size:1.7rem;line-height:1.25}h2{margin-top:2rem;border-bottom:1px solid #ddd;padding-bottom:.2rem}.meta{color:#555;font-size:.9rem}.disclaimer{background:#fff4e5;border-left:4px solid #c77;padding:.7rem 1rem;margin:1rem 0}.badge{font-size:.72rem;text-transform:uppercase;letter-spacing:.03em;background:#eee;border-radius:3px;padding:.05rem .35rem}.badge-meta{background:#d7f0d7}.badge-rct{background:#d7e8f7}.badge-cohort{background:#e7e2f7}.badge-case{background:#f7e7d7}.badge-review{background:#f2f2d0}.badge-opinion{background:#f7d7d7}.badge-unsure{background:#eee;color:#a00}.src{font-family:ui-monospace,monospace;font-size:.9em}.cite{color:#555;font-size:.85em}.not-found{background:#f6f6f6;padding:.2rem 1rem}nav.langs a{margin-right:.6rem}footer{margin-top:3rem;border-top:1px solid #ddd;padding-top:.8rem;font-size:.85rem;color:#555}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.25rem .5rem}`;
function page({ lang, slug, title, updated, sections, cards, hasPair }) {
  const other = lang === 'ru' ? 'en' : 'ru';
  const ru = `${BASE}ru/${slug}/`;
  const en = `${BASE}en/${slug}/`;
  const body = sections
    .map((s) => {
      if (!s.title) return `<section>${renderBody(s.lines)}</section>`;
      const nf = /^(Не нашёл|Not found)$/i.test(s.title);
      const isSources = /^(Источники|Sources)$/i.test(s.title);
      const html = renderBody(s.lines);
      const inner = isSources ? cite(html, cards) : html;
      return `<section${nf ? ' class="not-found"' : ''}><h2${nf ? ' id="not-found"' : ''}>${inline(s.title)}</h2>${inner}</section>`;
    })
    .join('\n');
  const disclaimer = lang === 'ru' ? 'Не заменяет врача. При угрозе жизни — 112.' : 'Not a substitute for a doctor. If life is in danger, call 112.';
  const updatedLabel = lang === 'ru' ? 'обновлено' : 'updated';
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="canonical" href="${SITE}${lang}/${slug}/">
<link rel="alternate" hreflang="${other}" href="${SITE}${other}/${slug}/">
<style>${CSS}</style></head><body>
<nav class="langs">${hasPair ? `<a href="${ru}"${lang === 'ru' ? ' aria-current="page"' : ''}>Русский</a><a href="${en}"${lang === 'en' ? ' aria-current="page"' : ''}>English</a>` : ''}</nav>
<header><h1>${esc(title)}</h1>
<p class="meta">${updatedLabel}: ${esc(updated)}</p>
<p class="disclaimer">${disclaimer}</p></header>
<main>${body}</main>
<footer><p><a href="${BASE}${lang}/">${lang === 'ru' ? 'Все темы' : 'All topics'}</a> · <a href="${BASE}">psybase</a></p></footer>
</body></html>`;
}
function build() {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  const cards = loadCards();
  const dirs = readdirSync(TOPICS).filter((d) => statSync(join(TOPICS, d)).isDirectory());
  const targets = FIXTURE ? dirs.filter((d) => d === '_example') : dirs;
  if (FIXTURE && !targets.length) throw new Error('фикстура topics/_example не найдена');
  const pages = [];
  let skipped = 0;
  for (const slug of targets) {
    const files = { ru: join(TOPICS, slug, 'ru.md'), en: join(TOPICS, slug, 'en.md') };
    for (const lang of ['ru', 'en']) {
      if (!existsSync(files[lang])) throw new Error(`topics/${slug}: нет ${lang}.md — пара обязательна`);
    }
    const docs = Object.fromEntries(['ru', 'en'].map((l) => [l, frontMatter(readFileSync(files[l], 'utf8'))]));
    if (!FIXTURE && String(docs.ru.data.draft).trim() === 'true') {
      console.log(`пропущено (draft: true): topics/${slug}`);
      skipped++;
      continue;
    }
    if (!FIXTURE && !/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`слаг «${slug}» не годится: только a-z, 0-9 и дефис`);
    const sectionsByLang = { ru: splitSections(docs.ru.body), en: splitSections(docs.en.body) };
    for (const l of ['ru', 'en']) if (!sectionsByLang[l].some((s) => /^(Не нашёл|Not found)$/i.test(s.title ?? ''))) throw new Error(`topics/${slug}/${l}.md: нет раздела «Не нашёл» / «Not found»`);
    for (const lang of ['ru', 'en']) {
      const dir = join(DIST, lang, slug);
      mkdirSync(dir, { recursive: true });
      const html = page({
        lang,
        slug,
        title: docs[lang].data.title ?? slug,
        updated: docs[lang].data.updated ?? '',
        sections: sectionsByLang[lang],
        cards,
        hasPair: true,
      });
      writeFileSync(join(dir, 'index.html'), html, 'utf8');
      pages.push({ lang, slug, title: docs[lang].data.title ?? slug });
    }
  }
  const index = (lang) => {
    const items = pages.filter((p) => p.lang === lang);
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>psybase</title>
<link rel="canonical" href="${SITE}${lang}/"><style>${CSS}</style></head><body>
<h1>${lang === 'ru' ? 'Пси-база' : 'Psybase'}</h1>
<p class="disclaimer">${lang === 'ru' ? 'Не заменяет врача. При угрозе жизни — 112.' : 'Not a substitute for a doctor. If life is in danger, call 112.'}</p>
<nav class="langs"><a href="${BASE}ru/">Русский</a><a href="${BASE}en/">English</a></nav>
<ul>${items.map((p) => `<li><a href="${BASE}${lang}/${p.slug}/">${esc(p.title)}</a></li>`).join('')}</ul>
</body></html>`;
  };
  mkdirSync(join(DIST, 'ru'), { recursive: true });
  mkdirSync(join(DIST, 'en'), { recursive: true });
  writeFileSync(join(DIST, 'ru', 'index.html'), index('ru'), 'utf8');
  writeFileSync(join(DIST, 'en', 'index.html'), index('en'), 'utf8');
  writeFileSync(
    join(DIST, 'index.html'),
    `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${BASE}ru/"><link rel="canonical" href="${SITE}ru/"></head><body><a href="${BASE}ru/">Пси-база</a></body></html>`,
    'utf8',
  );
  writeFileSync(join(DIST, '404.html'), `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>404</title><style>${CSS}</style></head><body><h1>404</h1><p>Страницы нет. <a href="${BASE}ru/">Все темы</a> · <a href="${BASE}en/">All topics</a></p></body></html>`, 'utf8');
  writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`, 'utf8');
  const urls = [`${SITE}ru/`, `${SITE}en/`, ...pages.map((p) => `${SITE}${p.lang}/${p.slug}/`)];
  writeFileSync(
    join(DIST, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${u}</loc></url>`)
      .join('\n')}\n</urlset>\n`,
    'utf8',
  );
  const bytes = dirBytes(DIST);
  console.log(`сборка: ${DIST}`);
  console.log(`страниц: ${pages.length} (тем: ${pages.length / 2}), пропущено draft: ${skipped}, размер: ${bytes} байт`);
  console.log(`адреса: ${BASE}ru/<slug>/ и ${BASE}en/<slug>/`);
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