# Закрытые двери Research

Проверено 2026-11-25. Один раз на источник, без повторных стен в каждом файле.
В файле направления — строка «см. `research/env-holes.md`», а не новый пересказ.

| Источник | Что отдаёт | Не пытаться заново |
|---|---|---|
| nice.org.uk (NG222, CG192, CG113, CG159, NG225, CG78, CG31, CG28) | 403 на HTML и PDF | да, 403 стабильный |
| pubmed.ncbi.nlm.nih.gov | требует cookies | нет, только Europe PMC / eutils |
| psychiatryonline.org / AJP | 403 | да |
| Wiley (onlinelibrary) | 403 на часть статей | да, если id в списке файла |
| ScienceDirect / Elsevier | 403, `isOpenAccess: N` | да |
| jaacap.org | Cloudflare | да, искать копию (hdl, репозиторий) |
| europepmc.org/books, nihr (HTA) | 403 / AWS WAF CAPTCHA | да |
| NCBI Bookshelf | JS-проверка, reCAPTCHA | да |
| iris.who.int (CDDR 2024) | обрыв на 16 368 байтах при любом Range | да, нужен офлайн-экземпляр |
| Europe PMC `fullTextXML` | периодически 500, но не постоянно | проверить 1 раз, дальше NCBI `efetch` |
| Europe PMC search | серии 503 | повторить 2–3 раза с паузой, потом eutils |
| eprints.leedsbeckett.ac.uk | таймаут 120 с | да |
| OpenAlex | closed / 451 через r.jina.ai | да |
| DOI из РИНЦ/eLibrary (`10.24411/…`, `10.33978/…`) | `doi.org` → `responseCode 100` | да; это не подделка, а класс — источник ищется по названию и странице журнала (КиберЛенинка); в утверждение ставится название+год, не DOI |

Обходы, которые работают: NCBI eutils `esummary`/`efetch`, `pmc.ncbi.nlm.nih.gov/articles/PMC…`,
Cambridge Core (часть PDF без подписки), репозитории вузов (hdl), `doi.org/api/handles`.
DOI с круглыми скобками обрезается регуляркой — сверять полную строку.
