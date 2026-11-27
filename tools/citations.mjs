import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Классификация карточек источников по месту цитирования.
 *
 * Правило записано в docs/schema.md: карточка цитируется, если на неё
 * ссылаются из topics/<slug>/ или for-app/<slug>/ либо её PMID стоит в
 * research/<дата>/*.md. Одна функция на всех: status.mjs и build.mjs не
 * должны считать это каждый по-своему.
 *
 * Ожидаемые аргументы:
 *   cards         — массив слагов карточек;
 *   topicRefs     — Map: слаг карточки -> Set слагов тем;
 *   appRefs       — Set слагов карточек, на которые ссылается for-app/;
 *   researchPmids — Set PMID (строк), встречающихся в research/;
 *   cardPmid      — Map: слаг карточки -> PMID (строка) из front-matter.
 */
export function classifyCitations({ cards, topicRefs, appRefs, researchPmids, cardPmid }) {
  const list = [...cards];
  const inApp = appRefs instanceof Set ? appRefs : new Set(appRefs ?? []);
  const hasTopic = (c) => (topicRefs.get(c)?.size ?? 0) > 0;
  const inResearch = (c) => Boolean(cardPmid.get(c) && researchPmids.has(cardPmid.get(c)));

  const inTopics = list.filter(hasTopic);
  const multiTopic = inTopics.filter((c) => topicRefs.get(c).size > 1);
  const appOnly = list.filter((c) => !hasTopic(c) && inApp.has(c));
  const researchOnly = list.filter((c) => !hasTopic(c) && !inApp.has(c) && inResearch(c));
  const nowhere = list.filter((c) => !hasTopic(c) && !inApp.has(c) && !inResearch(c));

  return { inTopics, multiTopic, appOnly, researchOnly, nowhere };
}

// PMID, упомянутые в research/. Тот же разбор, что был в status.mjs:
// только строки «PMID 12345», BOM снимается, файлы обходятся рекурсивно.
export function readResearchPmids(researchDir) {
  const pmids = new Set();
  if (!existsSync(researchDir)) return pmids;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) {
        const text = readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
        for (const m of text.matchAll(/\bPMID\s+(\d{5,9})\b/g)) pmids.add(m[1]);
      }
    }
  };
  walk(researchDir);
  return pmids;
}
