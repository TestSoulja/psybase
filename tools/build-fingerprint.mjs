import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * Отпечаток входов сборки.
 *
 * `status.mjs` раньше сравнивал mtime: `git checkout` после теста менял время
 * файла, и dist/ объявлялся устаревшим при том же содержимом. Теперь сборка
 * пишет в dist/.build.json хеш содержимого входов, а страж пересчитывает его.
 * Время файла не участвует: правка текста меняет хеш, checkout — нет.
 *
 * В отпечаток входят ровно те файлы, которые читает build.mjs: тексты тем и
 * страниц, карточки источников, for-app/ (подпись «цитируется» в каталоге),
 * research/ (PMID для той же подписи) и сам код сборки с его модулями.
 */

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const INPUT_DIRS = ['topics', 'pages', 'sources', 'for-app', 'research'];
const INPUT_FILES = [
  'tools/build.mjs',
  'tools/build-fingerprint.mjs',
  'tools/stats.mjs',
  'tools/citations.mjs',
];

function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
  }
}

export function buildInputFiles(root = ROOT) {
  const files = [];
  for (const d of INPUT_DIRS) walk(join(root, d), files);
  for (const f of INPUT_FILES) {
    const p = join(root, f);
    if (existsSync(p)) files.push(p);
  }
  const rel = (p) => relative(root, p).split(sep).join('/');
  return files.sort((a, b) => (rel(a) < rel(b) ? -1 : rel(a) > rel(b) ? 1 : 0));
}

export function buildFingerprint(root = ROOT) {
  const hash = createHash('sha256');
  for (const p of buildInputFiles(root)) {
    hash.update(relative(root, p).split(sep).join('/'));
    hash.update('\0');
    // Переводы строк не считаются содержимым: git checkout на Windows может
    // переписать CRLF↔LF, не меняя ни одного символа текста.
    hash.update(readFileSync(p, 'utf8').replace(/\r\n/g, '\n'));
    hash.update('\0');
  }
  return hash.digest('hex');
}
