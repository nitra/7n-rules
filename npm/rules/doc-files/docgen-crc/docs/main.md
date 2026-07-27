---
type: JS Module
title: main.mjs
resource: npm/rules/doc-files/docgen-crc/main.mjs
docgen:
  crc: d4e4c192
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Модуль працює з Markdown frontmatter як зі сховищем службових відомостей документа: витягує їх через `parseDocFrontmatter`, формує через `buildDocFrontmatter`, позначає через `stampDoc` і оцінює актуальність через `staleness`. Для контролю стану доки він читає окремі поля за допомогою `readDocCrc`, `readDocQuality`, `readDocModel` і `readDocTier`, а `documentationCrc` та `crc32` використовує для обчислення контрольної суми. `QUALITY_THRESHOLD` задає межу, нижче якої якість вважається недостатньою.

## Поведінка

`QUALITY_THRESHOLD` задає межу, нижче якої дока вважається недостатньо якісною для стабільного стану; це правило впливає на оцінку, але не змінює саме обчислення CRC.

`crc32` є базовим примітивом для всіх перевірок цілісності: з нього формується короткий hex-ідентифікатор, який далі зберігається у frontmatter або використовується для порівняння актуальності.

`documentationCrc` об’єднує source з пов’язаними тестами, якщо такий evidence доступний, і повертає єдиний CRC для доки; без пов’язаних тестів лишається сумісним зі старим варіантом, де враховується лише source.

`parseDocFrontmatter` відокремлює службові метадані доки від її тіла та нормалізує відсутні поля до безпечних значень, щоб інші читачі могли працювати і зі старими, і з новими документами.

`buildDocFrontmatter` збирає канонічний frontmatter для доки на основі source, CRC і якості, тримаючи OKF-поля на верхньому рівні, а службові дані — у вкладеному `docgen:`.

`stampDoc` застосовує цей канонічний frontmatter до Markdown-документа: забирає старий блок, якщо він є, і замінює його свіжими даними з поточного source та оцінки.

`readDocCrc`, `readDocQuality`, `readDocModel` і `readDocTier` працюють як читачі збереженого стану доки: вони беруть дані з frontmatter, не залежачи від тіла документа, і повертають відсутні значення як `null` або порожні списки там, де це сумісно зі старими файлами.

`staleness` зводить усе разом: порівнює збережений CRC доки з актуальним evidence CRC і визначає, чи дока відсутня, чи стала застарілою, чи лишається свіжою.

## Публічний API

- QUALITY_THRESHOLD — Поріг degraded: дока зі `score` нижче вважається неякісною.
- crc32 — CRC32 вмісту у hex (8 символів, з провідними нулями). Делегує у нативний
`node:zlib.crc32` — без ручної бітової арифметики.
- documentationCrc — CRC повного evidence для файлової доки. Без повʼязаних тестів лишається
back-compatible CRC самого source; за наявності тестів додає їхні шляхи та
вміст, тому зміна usage-сценарію детерміновано робить доку stale.
- parseDocFrontmatter — Парсить frontmatter файлової доки. Без блоку — `data:null` і `body` дорівнює входу.
Поля `model`/`score`/`issues` опційні (back-compat зі старими доками): без них —
`model:null`, `score:null`, `issues:[]`.
- buildDocFrontmatter — Будує OKF-сумісний frontmatter-блок: OKF-поля верхнього рівня + вкладений `docgen:`
з CRC/model/quality. OKF-поля виводяться першими, щоб будь-який OKF-парсер міг їх
читати незалежно від `docgen:`-простору назв.
- stampDoc — (Пере)штампує frontmatter у md-доку: знімає наявний блок і додає свіжий.
- readDocCrc — CRC, збережений у frontmatter доки; `null` — доки немає або CRC відсутній.
- readDocQuality — Якість, збережена у frontmatter доки.
- readDocModel — Модель-генератор, збережена у frontmatter доки; `null` — доки немає або поле відсутнє
(старі доки до введення `model`).
- readDocTier — Tier моделі-генератора зі frontmatter доки; `null` — доки немає або поле відсутнє.
- staleness — Стан застарілості доки відносно evidence: source + повʼязані тести.
`missing` — доки немає; `crc-mismatch` — evidence CRC ≠ CRC у доці; інакше свіжа.

## Сценарії використання

- `npm/rules/doc-files/docgen-crc/tests/docgen-crc.test.mjs` (crc32; frontmatter) — детермінований, 8-символьний hex; різний вміст → різний CRC; той самий — однаковий для рядка і Buffer; відомий вектор: CRC32; buildDocFrontmatter → парситься назад (без quality — score:null); model: повний id пишеться після crc і парситься назад; ще 15
- `npm/rules/doc-files/tests/main.test.mjs` (lint — детект (read-only detector)) — ci (files=undefined): ловить відсутню доку у дереві; ci: свіжа дока → 0 violations; quick: змінене джерело без доки → violation; порожній набір → 0; quick: не шукає сирітські docs поза explicit files; quick: реверс-мапінг — змінена дока веде до перевірки джерела; ще 6

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
