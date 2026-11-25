#!/usr/bin/env node
/**
 * Сверка STATUS.md с диском.
 *
 * Журнал состояния полезен ровно до тех пор, пока совпадает с файлами.
 * Этот скрипт падает, если:
 *   - в legacy/inbox/ есть файл, которого нет в таблице STATUS.md;
 *   - в STATUS.md есть тема, файла которой нет;
 *   - в topics/ появилась папка, не отмеченная в STATUS.md.
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

if (problems.length) {
  console.log('✖ STATUS.md расходится с диском:');
  for (const p of problems) console.log(`   ${p}`);
  process.exit(1);
}

console.log(`✔ STATUS.md совпадает с диском: ${inboxFiles.length} файлов в очереди, ${topics.length} папок тем`);
