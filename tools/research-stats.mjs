#!/usr/bin/env node
// Статистика research/: утверждения, id, размер — без чтения файлов человеком.
// node tools/research-stats.mjs [--wave N] [--tsv <файл>] [--ids <файл.json>] [--patch <README.md>]
//
// id (PMID/DOI) извлекает этот же скрипт, а не человек и не временная регулярка:
// обрывки вроде `…/cd012956.pub2/pdf/full` нормализуются и печатаются отдельной
// строкой, а не молча попадают в таблицу.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const waveArg = args.includes('--wave') ? Number(opt('--wave')) : null;
const tsvOut = opt('--tsv');
const idsOut = opt('--ids');

const root = 'research';
const dirs = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
  .map((d) => d.name)
  .sort();

const skip = new Set(['README.md', 'queue.md', 'env-holes.md']);
const LEVELS = ['meta', 'rct', 'cohort', 'case', 'review', 'opinion', 'unsure'];

const pmidRe = /PMID[:\s]*(\d{5,9})\b/g;
// DOI: 10.<4–9 цифр>/<суффикс>; одна пара круглых скобок внутри допустима
// (10.1016/s2215-0366(25)00297-4 — обрыв на скобке был реальной ошибкой).
const doiRe = /10\.\d{4,9}\/(?:[^\s`"'<>|[\]{}]|\([^()\s]*\))+/g;
// хвост URL, который приклеивается к DOI в ссылке на PDF
// (cochranelibrary.com/cdsr/doi/10.1002/…/pdf/full)
const urlTail = /\/(pdf|full|fulltext|abstract|epdf|html?|meta|references|figures?|suppl(?:ementary)?)$/i;

const normalized = [];

const stripUnbalanced = (s) => {
  let out = s;
  for (const [o, c] of [['(', ')'], ['[', ']'], ['{', '}']]) {
    for (;;) {
      if (!out.endsWith(c)) break;
      const open = out.split(o).length - 1;
      const close = out.split(c).length - 1;
      if (close <= open) break;
      out = out.slice(0, -1); // закрывающая скобка из текста вокруг, не из DOI
    }
  }
  return out;
};

const cleanDoi = (raw) => {
  const trimmed = stripUnbalanced(raw.replace(/[.,;:]+$/, ''));
  let s = trimmed;
  for (;;) {
    const m = s.match(urlTail);
    if (!m) break;
    s = s.slice(0, m.index);
  }
  // точка/запятая в конце строки — обычная обрезка, о ней не сообщаем
  if (s !== trimmed) normalized.push(`${raw} → ${s}`);
  const open = (s.match(/\(/g) || []).length;
  const close = (s.match(/\)/g) || []).length;
  if (open !== close) normalized.push(`${raw} — несбалансированные скобки, проверять полной строкой`);
  return s.toLowerCase();
};

const extractPmids = (text) => new Set([...text.matchAll(pmidRe)].map((m) => m[1]));
const extractDois = (text) => new Set([...text.matchAll(doiRe)].map((m) => cleanDoi(m[0])));

const countClaims = (body) => {
  const lines = body.split('\n');
  const bullets = lines.filter((l) => /^- \S/.test(l.trim()) || /^\d+\. \S/.test(l.trim()));
  if (bullets.length) return { n: bullets.length, bullets };
  // проза: абзацы вместо списка
  const paras = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith('#'));
  return { n: paras.length, bullets: [] };
};

// раздел «## Заход N» целиком (до следующего «## Заход»)
const sectionText = (text, wave) => {
  const marker = '## Заход ' + wave;
  const i = text.indexOf(marker);
  if (i === -1) return '';
  const rest = text.slice(i + marker.length);
  const end = rest.search(/^## Заход /m);
  return end === -1 ? text.slice(i) : text.slice(i, i + marker.length + end);
};

const waveClaims = (text, wave) => {
  const sec = sectionText(text, wave);
  if (!sec) return 0;
  const wb = sec.split(/^#{2,3} /m).find((b) => b.startsWith('Что нашёл'));
  if (!wb) return 0;
  return countClaims(wb.split(/^#{2,3} /m)[0]).n;
};

const rows = [];
const tsv = [];
const pmidFiles = new Map();

for (const date of dirs) {
  const dir = path.join(root, date);
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.md') && !skip.has(n)).sort()) {
    const p = path.join(dir, f);
    const text = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
    const fm = text.slice(0, text.indexOf('\n---', 3));
    const get = (k) => {
      const m = fm.match(new RegExp('^' + k + ':\\s*(.*)$', 'm'));
      return m ? m[1].replace(/^["']|["']$/g, '') : '';
    };
    const passages = [...text.matchAll(/^## Заход (\d+)/gm)].map((m) => Number(m[1]));
    const lastWave = passages.length ? Math.max(...passages) : 0;

    // утверждения: строки "- " и "1. " внутри "### Что нашёл"
    const blocks = text.split(/^#{2,3} /m).filter((b) => b.startsWith('Что нашёл'));
    let claims = 0;
    const claimLines = [];
    for (const b of blocks) {
      const { n, bullets } = countClaims(b.split(/^#{2,3} /m)[0]);
      claims += n;
      for (const t of bullets) claimLines.push(t.replace(/^(- |\d+\. )/, ''));
    }

    const pmids = extractPmids(text);
    const dois = extractDois(text);
    for (const id of pmids) {
      const set = pmidFiles.get(id) || new Set();
      set.add(f);
      pmidFiles.set(id, set);
    }

    const bytes = fs.statSync(p).size;

    rows.push({
      file: date + '/' + f,
      lane: get('lane'),
      waves: passages.length,
      lastWave,
      inWave: waveArg ? waveClaims(text, waveArg) : null,
      claims,
      pmids: pmids.size,
      dois: dois.size,
      kb: Math.round(bytes / 1024),
      perClaim: claims ? Math.round(bytes / claims) : 0,
    });

    if (tsvOut) {
      for (const c of claimLines) {
        const pm = (c.match(/PMID[:\s]*(\d{5,9})/) || [])[1] || '';
        const dmRe = c.match(doiRe);
        const dm = dmRe ? cleanDoi(dmRe[0]) : '';
        const lv = (LEVELS.find((l) => new RegExp('\\b' + l + '\\b', 'i').test(c)) || '').toLowerCase();
        tsv.push([date + '/' + f, pm, dm, lv, c.replace(/\t/g, ' ')].join('\t'));
      }
    }
  }
}

const LANES = {
  1: 'ПРЛ: критерии, распространённость, течение, суицидальность',
  2: 'ПРЛ: лечение',
  3: 'ПРЛ: стигма и язык',
  4: 'Депрессия: эпидемиология, течение, пороги',
  5: 'Депрессия: лечение, эффекты, NNT',
  6: 'Тревожные: ГТР, социальное, избегание',
  7: 'Паника и агорафобия',
  8: 'Различение и коморбидность',
  9: 'Сон, ПТСР, ОКР, РПП, зависимости',
  10: 'Русскоязычный контекст',
  11: 'Препараты при ПРЛ: побочные и отмена',
  12: 'Антидепрессанты и суицидальность у молодых',
  13: 'Беременность и лактация',
  14: 'Пожилые',
  15: 'Подростки',
  16: 'Когнитивные искажения',
  17: 'Самоповреждение без суицидального намерения',
  18: '«Накат»: острые состояния и навыки',
  19: 'Шкалы тяжести',
};

const pad = (s, n) => String(s).padEnd(n);
const head =
  pad('файл', 52) + pad('lane', 5) + pad('зах.', 5) + pad('утв.', 5) + pad('+волна', 7) +
  pad('PMID', 6) + pad('DOI', 5) + pad('КБ', 4) + 'Б/утв';
console.log(head);
console.log('-'.repeat(head.length));
const T = { claims: 0, pmids: 0, dois: 0, kb: 0, inWave: 0 };
const waveCol = waveArg !== null;
for (const r of rows) {
  console.log(
    pad(r.file, 52) + pad(r.lane, 5) + pad(r.waves, 5) + pad(r.claims, 5) +
      pad(waveCol ? r.inWave : '', 7) + pad(r.pmids, 6) + pad(r.dois, 5) + pad(r.kb, 4) +
      r.perClaim,
  );
  T.claims += r.claims;
  T.pmids += r.pmids;
  T.dois += r.dois;
  T.kb += r.kb;
  T.inWave += r.inWave || 0;
}
console.log('-'.repeat(head.length));
console.log(
  `файлов ${rows.length}: утверждений ${T.claims}, PMID ${T.pmids} (с повторами между файлами), ` +
    `DOI ${T.dois}, ${T.kb} КБ` + (waveCol ? `, волна ${waveArg}: ${T.inWave}` : ''),
);

const dup = [...pmidFiles.entries()].filter(([, s]) => s.size >= 3);
console.log(`PMID в 3+ файлах: ${dup.length}`);
if (dup.length) for (const [id, s] of dup.slice(0, 10)) console.log(`  ${id}: ${[...s].join(', ')}`);

if (normalized.length) {
  console.log(`нормализовано id: ${normalized.length}`);
  for (const n of normalized.slice(0, 12)) console.log('  ' + n);
  if (normalized.length > 12) console.log(`  … ещё ${normalized.length - 12}`);
}

if (waveArg) {
  const over = rows.filter((r) => (r.inWave || 0) > 60);
  if (over.length) console.log('КАП 60 превышен: ' + over.map((r) => r.file).join(', '));
}

if (tsvOut) {
  fs.writeFileSync(tsvOut, tsv.join('\n') + '\n', 'utf8');
  console.log(`TSV: ${tsvOut} (${tsv.length} строк)`);
}

// --ids <файл.json>: id, попавшие в файлы в этой волне — всё, чего не было в HEAD,
// плюс (для файлов вне git) то, чего не было в тексте до раздела «## Заход N».
// Второе число в отчёте — сколько из них в самих утверждениях захода.
if (idsOut) {
  if (!waveArg) {
    console.error('--ids требует --wave N: иначе непонятно, какие id новые');
    process.exit(1);
  }
  const pmids = new Set();
  const dois = new Set();
  const claimPmids = new Set();
  const claimDois = new Set();
  let base = 'HEAD';
  for (const date of dirs) {
    const dir = path.join(root, date);
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.md') && !skip.has(n)).sort()) {
      const rel = date + '/' + f;
      const text = fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\uFEFF/, '');
      let head = '';
      try {
        head = execFileSync('git', ['show', base + ':' + root + '/' + rel], {
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'ignore'],
        }).replace(/^\uFEFF/, '');
      } catch {
        head = '';
      }
      const oldP = extractPmids(head);
      const oldD = extractDois(head);
      const sec = sectionText(text, waveArg);
      const newP = new Set([...extractPmids(text)].filter((id) => !oldP.has(id)));
      const newD = new Set([...extractDois(text)].filter((d) => !oldD.has(d)));
      for (const id of newP) pmids.add(id);
      for (const d of newD) dois.add(d);
      for (const id of extractPmids(sec)) claimPmids.add(id);
      for (const d of extractDois(sec)) claimDois.add(d);
    }
  }
  fs.writeFileSync(
    idsOut,
    JSON.stringify({ wave: waveArg, pmids: [...pmids].sort(), dois: [...dois].sort() }, null, 2) + '\n',
    'utf8',
  );
  console.log(
    `ID: ${idsOut} — новых относительно ${base}: PMID ${pmids.size}, DOI ${dois.size} ` +
      `(в утверждениях захода: PMID ${claimPmids.size}, DOI ${claimDois.size})`,
  );
}

// --patch README.md: переписать блок между <!-- stats:begin --> и <!-- stats:end -->
// Маркеров нет — падение, а не «создам раздел на глаз»: таблицу руками не правят,
// значит расхождение с файлами иначе не поймает никто.
if (args.includes('--patch')) {
  const target = opt('--patch');
  const BEGIN = '<!-- stats:begin -->';
  const END = '<!-- stats:end -->';
  const text = fs.readFileSync(target, 'utf8');
  const a = text.indexOf(BEGIN);
  const b = text.indexOf(END);
  if (a === -1 || b === -1 || b < a) {
    console.error(`патч не применён: в ${target} нет пары ${BEGIN} / ${END}`);
    process.exit(1);
  }
  const kbFmt = String(T.kb).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const sorted = [...rows].sort((x, y) => Number(x.lane) - Number(y.lane));
  const md = [
    '| lane | Направление | Файл | Зах. | Утв. | PMID | DOI | КБ |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const r of sorted) {
    const name = r.file.split('/').slice(1).join('/');
    md.push(
      `| ${r.lane} | ${LANES[Number(r.lane)] || name} | \`${name}\` | ${r.waves} | ${r.claims} | ${r.pmids} | ${r.dois} | ${r.kb} |`,
    );
  }
  md.push('');
  md.push(
    `**Итого: ${sorted.length} файлов, ${T.claims} утверждений; ${T.pmids} PMID (с повторами между ` +
      `файлами), ${T.dois} DOI, ${kbFmt} КБ; PMID в 3+ файлах: ${dup.length}.**`,
  );
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const next = text.slice(0, a) + [BEGIN, ...md, END].join(eol) + text.slice(b + END.length);
  if (next === text) {
    console.log(`README без изменений: ${target}`);
  } else {
    fs.writeFileSync(target, next, 'utf8');
    console.log(`README обновлён: ${target} (${sorted.length} строк таблицы)`);
  }
}
