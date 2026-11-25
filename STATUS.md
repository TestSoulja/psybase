# Где остановились

Обновлено: 2026-11-25. Этот файл — первое, что читается в новой сессии.
Правило: **в конце каждой работы по исследованиям он обновляется**, иначе
`node tools/status.mjs` падает.

## Одной строкой

Корпус перенесён, 17 тем лежат в `legacy/inbox/`, ссылки проверены. Пять тем
сконвертированы: 6.30 «Депрессия» → `topics/depressiya/`, 6.31 «Поведенческая
активация» → `topics/povedencheskaya-aktivaciya/`, 6.32 «Антидепрессанты» →
`topics/antidepressanty/` (RU + EN + for-app), `topics/prl/` — «Пограничное
расстройство личности», RU-only, 22 источника + `for-app/prl/` и 6.33
«Депрессия и ПРЛ» → `topics/depressiya-i-prl/` (только RU). Всего 64
карточки источников в `sources/`. Следующая тема не назначена: в очереди
6.20–6.29. Сырьё
спринта (`research/2026-11-25/`) — волны возобновлены 25.11.2026, идёт цикл
волн (`research/queue.md`), последняя — 8-я: 1157 утверждений, 129 из них
в волне 8.

Кроме тем на сайте есть каталог: `/ru/istochniki/` — индекс всех 64 карточек
и отдельная страница на каждую, и `/ru/dokazatelnost/` — «Как мы оцениваем
доказательства». В «Тем: N» они не входят; числа и адреса собирает `build.mjs`,
страж сверяет их с `sources/` и `dist/`.

Сайт выложен: <https://testsoulja.github.io/psybase/> — ветка `gh-pages`,
источник Pages = `gh-pages` / root, выкладка через `scripts/deploy-pages.ps1`.
Живое состояние — отдельным блоком ниже; ветку проверять только
`git ls-remote --heads origin gh-pages`: локальная `gh-pages` отстаёт.

## Прод сейчас

Проверено 25.11.2026 (curl и подсчёт по HTML, не вывод скрипта выкладки):

| Что | Значение |
|---|---|
| `gh-pages` на origin | содержимое `dd35569`, голова `7cbcd39` (пустой коммит-триггер) |
| живой сайт | сборка `70b73bc` |
| `/ru/depressiya/` на живом | 17 717 байт, `aria-hidden` — 0, `chart-note` — 0, баров воронки — 3 |
| `dist/ru/depressiya/index.html` | 17 918 байт, `aria-hidden` — 10, `chart-note` — 1, баров воронки — 2 |

Те же четыре числа с живого — тремя строками PowerShell:

```powershell
$u = 'https://testsoulja.github.io/psybase/ru/depressiya/?cb=' + [DateTime]::UtcNow.Ticks
$h = (Invoke-WebRequest $u -UseBasicParsing).Content
"bytes: {0}; aria-hidden: {1}; chart-note: {2}; funnel-bars: {3}" -f ([Text.Encoding]::UTF8.GetByteCount($h)), ([regex]::Matches($h,'aria-hidden="true"')).Count, ([regex]::Matches($h,'class="chart-note"')).Count, ([regex]::Matches((($h -split '<figure[^>]*data-chart="funnel"[^>]*>')[1] -split '</figure>')[0],'class="chart-row"')).Count
```

Запуск 25.11.2026: `bytes: 17717; aria-hidden: 0; chart-note: 0; funnel-bars: 3` —
совпало с таблицей.

То есть живое противоречит README: в сборке уже два бара, примечание и скрытие
визуальной части от скринридера, а на сайте — три бара и ни того, ни другого.

Причина: у GitHub Pages и Actions `partial_outage` (status.github.com):
`deploy` на `dd35569` упал, повторные пуши новый run не создают.

После восстановления: один пустой пуш в `gh-pages`, дождаться сборки, затем
проверить на живом ровно эти четыре числа. Автоматизация
`aut_2138264c4001THgYn6rS5jwkyO` (каждые 10 минут, до 22:09) присылает те же
числа; если Pages не поднимется до 21:50, она присылает итог для записи сюда
и выключается, а не исчезает по таймеру.

Вычитка (0План0, 74 находки, ничего не правилось) и следующие за ней точечные
правки 25.11.2026: определение полипрагмазии в `white-2026` взято из методов
(больше одного препарата одновременно ≥ 14 дней), расхождение с аннотацией
(«≥ 1») названо в карточке и в двух темах; у воронки `kessler-2003` теперь
обязательные `bases` (все бары — доля от всех случаев), условная доля 41,9 %
вынесена в `note` под графиком, а не стоит баром; у графиков появилась единица «%»;
`paz-otero`: 60,7 % — скрининг CAARS-S:L, не диагноз. Правила языка —
`docs/style.md` (12 пунктов).

## Очередь приёмки: `legacy/inbox/`

| § | Файл | Ссылок | Ссылки | Приёмка |
|---|---|---|---|---|
| 6.20 | `06-20-lekarstva.md` | 8 | проверены | ждёт конвертации |
| 6.21 | `06-21-samopovrezhdenie.md` | 7 | проверены | ждёт конвертации |
| 6.22 | `06-22-plan-bezopasnosti.md` | 9 | проверены | ждёт конвертации |
| 6.23 | `06-23-validaciya.md` | 12 | проверены | ждёт конвертации |
| 6.24 | `06-24-aleksitimiya.md` | 9 | проверены | ждёт конвертации |
| 6.25 | `06-25-son.md` | 20 | проверены | ждёт конвертации |
| 6.26 | `06-26-sdvg.md` | 10 | проверены | ждёт конвертации |
| 6.27 | `06-27-autizm.md` | 12 | проверены | ждёт конвертации |
| 6.28 | `06-28-cifrovye-2024-2026.md` | 18 | проверены | ждёт конвертации |
| 6.29 | `06-29-yazyk-i-stigma.md` | 10 | проверены | ждёт конвертации |
| 6.30 | `06-30-depressiya.md` | 6 | проверены | сконвертирована → `topics/depressiya/` |
| 6.31 | `06-31-povedencheskaya-aktivaciya.md` | 10 | проверены | сконвертирована → `topics/povedencheskaya-aktivaciya/` |
| 6.32 | `06-32-antidepressanty.md` | 9 | проверены | сконвертирована → `topics/antidepressanty/` |
| 6.33 | `06-33-depressiya-i-prl.md` | 14 | проверены | сконвертирована → `topics/depressiya-i-prl/` |
| 6.34 | `06-34-trevozhnye.md` | 6 | проверены | ждёт конвертации |
| 6.35 | `06-35-panika.md` | 18 | проверены | ждёт конвертации |
| 6.37 | `06-37-transdiagnosticheskiy.md` | 13 | проверены | ждёт конвертации |

Проверка 25.11.2026: **194 уникальных идентификатора** (PMID + DOI), 7 были
помечены — и все 7 оказались настоящими: 6 подтверждены через `doi.org`
handle API, седьмой (`10.1016/S0196-0644(89)80515-3`) doi.org не ответил, но
статья подтверждена PMID 2499228. Выдуманных ссылок в корпусе нет.
Подробности ловушки — `docs/env.md`.

## Готовые темы: `topics/`

- `topics/depressiya/` — «Депрессия», пара `ru.md` + `en.md`, 7 источников:
  `sources/who-2025-depression.md`, `kessler-2003-ncsr`, `eaton-2008-baltimore`,
  `wiedlocha-2024-bpd-mdd`, `li-2025-criticism`, `nhs-depression-overview` — все
  карточки в `sources/`. Исходник — `legacy/inbox/06-30-depressiya.md`.
  `parity.mjs`: 5 заголовков и 69 чисел в обеих версиях; «Не нашёл» /
  «Not found» заполнены. Пара для приложения — `for-app/depressiya/`.
- `topics/povedencheskaya-aktivaciya/` — «Поведенческая активация», пара
  `ru.md` + `en.md`, 10 источников (все карточки в `sources/`), пара для
  приложения — `for-app/povedencheskaya-aktivaciya/`. `parity.mjs`: 5 заголовков
  и 97 чисел. Исходник — `legacy/inbox/06-31-povedencheskaya-aktivaciya.md`.
- `topics/antidepressanty/` — «Антидепрессанты», пара `ru.md` + `en.md`,
  19 источников (все карточки в `sources/`), разделы «Смена препарата» и
  «Доза — не то же, что препарат», пара для приложения —
  `for-app/antidepressanty/`. `parity.mjs`: 5 заголовков и 152 числа.
  Исходник — `legacy/inbox/06-32-antidepressanty.md`. Все 19 DOI —
  `responseCode 1`, 19 PMID сверены Europe PMC (`hitCount 1`).
- `topics/_example/` — пример структуры (`draft: true`), не факт, не публиковать.
- `topics/prl/` — «Пограничное расстройство личности (ПРЛ)», только RU
  (`en.md` нет — долг перевода), 22 источника, `sources: 22`; пара для
  приложения — `for-app/prl/` (11 источников, из них четыре цифровых).
  Собрана из сырья волн 7–8 (`research/prl-digest.md`), не из `legacy/inbox/`.
  `parity.mjs` пары не находит и пропускает; `status.mjs` сверяет
  `sources: 22` с числом различных карточек в тексте. 95 PMID волны 8
  найдены в NCBI esummary, 86 DOI — `responseCode 1`; Europe PMC в этой
  сессии не отвечал (таймауты), поэтому PMID сверялись через eutils.
- `topics/depressiya-i-prl/` — «Депрессия и ПРЛ», только RU (`en.md` нет —
  долг перевода), 10 источников, `sources: 10`. Собрана из сырья волн
  (`research/2026-11-25/komorbidnost-i-razlichenie.md`,
  `research/2026-11-25/prl-differenciaciya.md`), не из `legacy/inbox/`.
  Внутри: доли в обе стороны (10–30 % / более 80 %, с оговоркой «вторичная
  цифра»), сетевая модель коморбидности, что меняется в лечении, и отдельный
  абзац о том, почему 23,2 % и 13 % — числа ошибок диагноза, а не
  распространённости. `parity.mjs` пары не находит и пропускает; `status.mjs`
  сверяет `sources: 10` с числом различных карточек в тексте. 4 новых PMID
  и 4 DOI сверены (`hitCount 1`, `responseCode 1`).

## Дыры и пустые поиски

Сюда идёт и то, чего в корпусе нет, и то, что искали и не нашли: пустой поиск —
результат. Каждая строка с датой, иначе следующая сессия повторит тот же поиск.
Дата — дата записи. Для трёх строк, перенесённых 25.11.2026 из прежней
таблицы, настоящая дата поиска не сохранилась.

| Дата | Где искал | Запрос | Результат | Вывод |
|---|---|---|---|---|
| 2026-11-25 | — | §6.36 «экспозиция при тревожных расстройствах» | **не начата**: агент отменён, файла нет | тема отсутствует в корпусе |
| 2026-11-25 | `nice.org.uk` | CG78 / NG222 / NG225 / CG113 | **не прочитаны**: сайт отдаёт 403 из этой среды | нужен браузер или человек; формулировки не цитировать |
| 2026-11-25 | индексы (какие именно — в исходной записи не указано) | русскоязычные исследования стигмы | из корпуса, 0 совпадений — индекс и запрос не зафиксированы | не подтверждено: нужен новый поиск с записанным индексом и запросом; переносить английские числа нельзя |
| 2026-11-25 | Europe PMC (сырьё: `research/2026-11-25/svyazannoe-son-ptsr-okr-rpp-zavisimosti.md`) | `TITLE:"eating disorders" AND TITLE:"major depressive disorder" AND TITLE:"comorbidity"`; `TITLE:"eating disorders" AND TITLE:"depression" AND (TITLE:"comorbidity" OR TITLE:"prevalence")`; `TITLE:"anorexia nervosa" AND TITLE:"depression" AND TITLE:"comorbidity"`; `TITLE:"bulimia nervosa" AND TITLE:"depression" AND TITLE:"comorbidity"`; `TITLE:"depression" AND TITLE:"eating disorders" AND ABSTRACT:"meta-analysis"`; `TITLE:"eating disorders" AND TITLE:"depression" AND ABSTRACT:"lifetime"` | 0 / 5 / 1 / 0 / 0 / 6 записей, из них подходящих **0** (единственный «мета-анализ» — про ОКР, PMID 34858219) | доли депрессии при РПП в проверенном виде **нет**; запрос по `ABSTRACT` для этой связки остаётся невыполненным, цифру не подставлять |
| 2026-11-25 | Europe PMC (сырьё: `research/2026-11-25/depressiya-lechenie.md`) | `TITLE:"number needed to treat" AND TITLE:depress*`; `ABSTRACT:"number needed to treat" AND ABSTRACT:"baseline severity"`; `ABSTRACT:"number needed to treat" AND ABSTRACT:antidepressant AND ABSTRACT:severity`; `NNT AND SSRI AND "baseline severity"`; `AUTH:"Cuijpers" AND "number needed to treat"` | 20 / 10 / 24 / 54 / 76 записей; NNT по стратам исходной тяжести — **0**; у Montgomery & Möller 2009 (PMID 19357527) NNT обсуждается, числа в абстракте нет | **источника нет**, пункт закрыт; NNT самому из RR/OR не считать — это не разрешено правилами базы |
| 2026-11-25 | Europe PMC (сырьё: `research/2026-11-25/trevozhnye.md`) | `TITLE:benzodiazepine AND (TITLE:dependence OR TITLE:"long-term use") AND ABSTRACT:"generalized anxiety disorder"`; `ABSTRACT:"benzodiazepine dependence" AND ABSTRACT:"generalized anxiety disorder"` | 3 / 7 записей, перекрёстной таблицы «ГТР × зависимость» **нет**; ближайшее — 61,2% ГТР среди длительных потребителей (PMID 17457292) и 9,5% зависимости у 65+ (PMID 23810753), но по разным выборкам | доля зависимости от бензодиазепинов **именно при ГТР** не найдена; складывать две разные доли нельзя |
| 2026-11-25 | Europe PMC (сырьё: `research/2026-11-25/kognitivnye-iskazheniya.md`) | `ABSTRACT:"cross-lagged" AND (ABSTRACT:"interpretation bias" OR ABSTRACT:"negative bias") AND ABSTRACT:depress*` | hitCount 5; панельных RI-CLPM-работ по этому конструкту в рецензируемой литературе **0**, единственная прямая работа — препринт PsyArXiv 10.31234/osf.io/pefnw_v6 (n=581, 14-дневный дневник) | связь «предвзятость → симптомы» на уровне устойчивых различий есть, предиктивных связей «день ко дню» нет; пока это препринт, в тему не идёт без журнальной версии |
| 2026-11-25 | Europe PMC (Q4 «Смена препарата»; сырьё: `research/2026-11-25/prl-preparaty-pobochnye-i-otmena.md`) | `TITLE:antidepressant AND (TITLE:switching OR TITLE:switch)`; `ABSTRACT:"switch" AND ABSTRACT:"adverse events" AND ABSTRACT:antidepressant`; `TITLE:"discontinuation emergent"` | 100 / 42 / 4 записи, из них отобрано 1 / 2 / 1 и добавлены два уже собранных обзора отмены; доли «стало хуже именно после переключения» **нет** ни в одной; попутно — частота переключений 15,0 % (PMID 41452123), проверка шкалы DESS (PMID 42814111), 3 случая быстрого переключения МАОИ (PMID 40679804); обзоры отмены 2024/2025 (PMID 38851198, 40632531) дали 31 % против 17 % и головокружение OR 5,52 | **Q4 сделан**: раздел «Смена препарата» в `topics/antidepressanty/`, 6 карточек; доля ухудшения после смены не найдена, РКИ стратегий по нежелательным явлениям нет, данных при ПРЛ отдельно нет; 6.33 сконвертирована следом |
| 2026-11-25 | Europe PMC (Q5 «Доза») | `(TITLE:"dose increase" OR TITLE:"dose escalation") AND (TITLE:antidepressant OR TITLE:SSRI OR TITLE:serotonin)`; `TITLE:"activation syndrome" AND (TITLE:SSRI OR TITLE:antidepressant OR TITLE:serotonergic)`; `(ABSTRACT:jitteriness OR ABSTRACT:"activation syndrome") AND ABSTRACT:antidepressant` | 7 / 2 / 32 записи, отобрано 1 / 0 / 3 (PMID 29873954; 29061415, 19478285, 25419134); доли «стало хуже именно после повышения дозы» **нет**; измерены частота активации 27,7 % за 6 недель и 7,0 % за месяц, разброс обзора 4–65 %, связь с высокой дозой OR 2,68, повышение дозы по эффективности SMD 0,053 | **Q5 сделан**: абзац «Доза — не то же, что препарат» в `topics/antidepressanty/`, 4 карточки; доля ухудшения после повышения дозы не найдена |
| 2026-11-25 | `sources/` — основа чтения | не поиск, а учёт: у карточки появилось поле `read` | **22 карточки с `read: unknown`** — в теле не сказано, аннотацию читали или полный текст; страница карточки так и пишет: «Основа чтения не записана» | долг: дописать основу в тело и заменить `unknown`; до этого число «названа у 42 из 64» на странице доказательности честнее прежнего «в каждой карточке написано» |

Список 22 карточек с `read: unknown` (по одной строке, чтобы долг не растворился):
`bach-2022-icd11-pd`, `brodsky-2025-dbt-vs-ssri`, `eaton-2008-baltimore`,
`gonzalez-2021-stepps`, `grant-2008-nesarc`, `guillen-2024-family-connections`,
`huo-2026-prevalence-men`, `jorgensen-2024-5-year`, `klein-2021-internet-self-management`,
`lak-2025-suicidality`, `leichsenring-2024-bpd-review`, `li-2025-criticism`,
`paz-otero-2026-adhd`, `pesic-2026-borderline-name`, `potter-2006-manipulative`,
`ramos-suarez-2026-prevalence`, `shen-2018-misdiagnosis`, `stoffers-2022-pharmacotherapy`,
`storebo-2020-psychotherapy`, `vikstrom-2026-relatives`, `zanarini-2018-web-psychoeducation`,
`zanarini-2024-24-year`.

## Дальше (не в этом шаге)

1. **6.33 сконвертирована 25.11.2026** → `topics/depressiya-i-prl/` (только RU,
   без `for-app`). Следующая тема не назначена: в очереди ждут 6.20–6.29,
   выбор — за владельцем. Порядок конвертации тот же, что с 6.30–6.33:
   открыть и сверить источники → карточки в `sources/` → `topics/<slug>/ru.md`
   (+ `en.md`, если перевод есть) → `for-app/<slug>/` → «Не нашёл» → проверить
   → отметить в «Приёмке».
2. **Спринт 2026-11-25 — сырьё (волны возобновлены 25.11.2026):**
   `research/2026-11-25/` — 23 файла направлений, восемь волн, **1157 утверждений**
   по `tools/research-stats.mjs` (до волны 7 было 1061; волна 8 добавила 129,
   плюс четыре дописки). Расхождения считаются отдельно: 513 записей,
   482 уникальных по набору id. Сверка: **473 PMID после волны 4 — все
   `hitCount 1`**; волна 5 — **40 PMID 40/40**, **32 DOI 32/32**; волна 6 —
   **29 PMID 29/29**, **29 DOI**: 26 резолвятся, 3 русских — класс РИНЦ
   (`10.24411/…`, `10.33978/…`), помечены в файле. После волны 4 было 359 DOI,
   357 `responseCode 1`, два отвергнуты и помечены (`10.1002/14651858.cd005653.pub3`
   и `10.4088/jcp.v65s0502` — handle не найден). Волны 5 и 6: по **+126
   утверждений**; волна 7: **+107 утверждений, 22 PMID 22/22, 18 DOI 18/18**;
   волна 8: **129 утверждений, 95 PMID 95/95** (NCBI esummary — Europe PMC
   не отвечал), **86 DOI 86/86** (`responseCode 1`). Дублей PMID в 3+ файлах
   нет (40279864 в трёх файлах — один мета-анализ), кап 60 не превышен. Цикл,
   очередь и стопы — `research/queue.md` и `research/README.md`; закрытые
   двери — `research/env-holes.md`; id извлекает и сверяет
   `tools/research-stats.mjs --ids` и `tools/verify-ids.mjs`. Дальше — конвертация в `topics/`.
   **Не покрыто:** ЭСТ и физическая активность отдельными направлениями, NICE
   (403 во всех попытках), DSM-5-TR и CDDR (платно / обрыв на 16 368 байтах),
   полные тексты платных статей, эпидемиология РФ.
3. Шаг C сделан частично: 6 карточек в `sources/` под тему 6.30, журнала
   источников и стража «PMID ↔ карточка» пока нет; у сырья `research/` карточек нет.
4. Страж пары README: после перевода `README.en.md` файлы станут структурно
   параллельны, и `parity.mjs` можно научить сравнивать их как пару —
   «перевод с датой» перестанет быть обещанием.
5. Pages включён 25.11.2026 (`gh-pages` / root, адрес в README и здесь).
   Блок «В каком состоянии база» переписан под две темы и живой сайт; блок
   «Нашли ошибку» сверен — Issue и 112 на месте, менять нечего.

## Не делать (решения владельца, 25.11.2026)

- не предлагать новые метки дневника и «Холод» — снято;
- не переделывать раздел контактов — под вопросом, решения нет;
- исследования не дублировать в `BGAssistant`: одна копия, здесь;
- базу не превращать в «проверь себя»: никаких опросников с подсчётом.

## Как это обновлять

1. Закончил тему — поменял её статус в таблице на `сконвертирована`.
2. Добавил файл в `legacy/inbox/` — добавил строку.
3. Сделал поиск с пустым результатом — добавил строку с датой, индексом и точным запросом.
4. `node tools/status.mjs` — проверяет, что списки и файлы совпадают.
