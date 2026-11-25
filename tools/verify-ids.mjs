#!/usr/bin/env node
// Сверка id из research-stats.mjs --ids: PMID — Europe PMC (hitCount 1),
// DOI — doi.org/api/handles (responseCode 1). Пакетами по 40, повторы при 503.
// node tools/verify-ids.mjs ids-wave6.json
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const file = process.argv[2];
if (!file) {
  console.error('нужен файл из research-stats.mjs --wave N --ids <файл.json>');
  process.exit(1);
}
const { wave = null, pmids = [], dois = [] } = JSON.parse(fs.readFileSync(file, 'utf8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Node fetch в этой среде зависает — ходим curl'ом с жёстким таймаутом.
const bin = process.platform === 'win32' ? 'curl.exe' : 'curl';
const curl = async (url) => {
  for (let i = 1; i <= 4; i++) {
    try {
      const out = execFileSync(bin, ['-sS', '--max-time', '40', url], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      if (out && !/503 Service Temporarily Unavailable/.test(out)) return out;
    } catch {}
    await sleep(8000);
  }
  return '';
};

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

let ok = 0;
const bad = [];
for (const batch of chunk(pmids, 40)) {
  const q = '(' + batch.map((id) => 'EXT_ID:' + id).join(' OR ') + ') AND SRC:MED';
  const url =
    'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=' +
    encodeURIComponent(q) +
    '&format=json&pageSize=100&resultType=lite';
  const body = await curl(url);
  const hit = Number((body.match(/"hitCount":(\d+)/) || [])[1] || -1);
  if (hit === batch.length) {
    ok += batch.length;
    console.log(`PMID ${batch[0]}…${batch[batch.length - 1]}: ${hit}/${batch.length} ✔`);
    continue;
  }
  console.log(`PMID ${batch[0]}…${batch[batch.length - 1]}: hitCount=${hit} из ${batch.length} ✖ — по одному`);
  for (const id of batch) {
    const u =
      'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=' +
      encodeURIComponent('EXT_ID:' + id + ' AND SRC:MED') +
      '&format=json&pageSize=1&resultType=lite';
    const h = Number(((await curl(u)).match(/"hitCount":(\d+)/) || [])[1] || -1);
    if (h === 1) {
      ok++;
      console.log(`  ${id}: 1 ✔`);
    } else {
      bad.push(`PMID ${id} (hitCount=${h})`);
      console.log(`  ${id}: ${h} ✖`);
    }
  }
}

let doiOk = 0;
const rinc = [];
for (const d of dois) {
  // скобки кодируются целиком: иначе DOI вида 10.1016/s2215-0366(25)00297-4 рвётся
  const body = await curl('https://doi.org/api/handles/' + encodeURIComponent(d));
  const rc = Number((body.match(/"responseCode":(\d+)/) || [])[1] || -1);
  if (rc === 1) {
    doiOk++;
    console.log(`DOI ${d}: 1 ✔`);
  } else if (rc === 100 && /^10\.(24411|33978)\//i.test(d)) {
    // РИНЦ/eLibrary: в глобальной handle-системе не резолвится — это класс, не подделка.
    // Источник ищется по названию и странице журнала; в утверждение идёт название+год.
    rinc.push(d);
    console.log(`DOI ${d}: 100 — класс РИНЦ (не ошибка, см. research/env-holes.md)`);
  } else {
    bad.push(`DOI ${d} (responseCode=${rc})`);
    console.log(`DOI ${d}: ${rc} ✖`);
  }
}

console.log('-'.repeat(70));
console.log(`волна ${wave ?? '?'}: PMID ${ok}/${pmids.length} hitCount 1, DOI ${doiOk}/${dois.length} responseCode 1`);
if (rinc.length) console.log(`DOI класса РИНЦ (не резолвятся по определению): ${rinc.length}`);
if (bad.length) {
  console.log('ПРОБЛЕМЫ:');
  for (const b of bad) console.log('  ' + b);
  process.exitCode = 1;
}
