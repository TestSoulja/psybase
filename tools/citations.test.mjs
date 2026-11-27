import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCitations } from './citations.mjs';

// Одна и та же раскладка на все случаи: карточки отличаются только местом
// цитирования, поэтому падение теста сразу показывает, какая ветка сломалась.
const fixture = () => ({
  cards: ['topic-one', 'topic-two', 'app-only', 'research-only', 'nowhere', 'no-pmid'],
  topicRefs: new Map([
    ['topic-one', new Set(['t1'])],
    ['topic-two', new Set(['t1', 't2'])],
  ]),
  appRefs: new Set(['app-only']),
  researchPmids: new Set(['11111111']),
  cardPmid: new Map([
    ['topic-one', '10000001'],
    ['topic-two', '10000002'],
    ['app-only', '10000003'],
    ['research-only', '11111111'],
    ['nowhere', '10000005'],
    // no-pmid намеренно отсутствует в карте
  ]),
});

test('карточка, на которую ссылается тема, попадает в inTopics', () => {
  const { inTopics } = classifyCitations(fixture());
  assert.deepEqual(inTopics, ['topic-one', 'topic-two']);
});

test('карточка из двух тем попадает ещё и в multiTopic', () => {
  const { multiTopic } = classifyCitations(fixture());
  assert.deepEqual(multiTopic, ['topic-two']);
});

test('карточка только из for-app попадает в appOnly и не в researchOnly', () => {
  const { appOnly, researchOnly } = classifyCitations(fixture());
  assert.deepEqual(appOnly, ['app-only']);
  assert.ok(!researchOnly.includes('app-only'));
});

test('карточка с PMID, который есть в research/, попадает в researchOnly', () => {
  const { researchOnly } = classifyCitations(fixture());
  assert.deepEqual(researchOnly, ['research-only']);
});

test('карточка без тем, for-app и research попадает в nowhere', () => {
  const { nowhere } = classifyCitations(fixture());
  assert.ok(nowhere.includes('nowhere'));
});

test('карточка без PMID и без ссылок попадает в nowhere (ветка стража)', () => {
  const { nowhere } = classifyCitations(fixture());
  assert.ok(nowhere.includes('no-pmid'));
  assert.ok(!nowhere.includes('research-only'));
});
