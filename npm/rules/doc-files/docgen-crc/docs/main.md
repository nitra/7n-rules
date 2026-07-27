---
type: JS Module
title: main.mjs
resource: npm/rules/doc-files/docgen-crc/main.mjs
docgen:
  crc: b39afb7c
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Модуль визначає актуальність документації через `documentationCrc`, `QUALITY_THRESHOLD` і `DOCGEN_RENDER_REVISION`, щоб відокремлювати свіжі тексти від застарілих за збереженим CRC та оцінкою якості. Також він працює з frontmatter через `parseDocFrontmatter`, `buildDocFrontmatter`, `stampDoc`, `readDocCrc`, `readDocQuality`, `readDocModel`, `readDocTier` і `staleness`, щоб узгоджувати службові поля документації між файлами.

## Поведінка

QUALITY_THRESHOLD задає поріг, нижче якого дока вважається недостатньо якісною для довіри; значення використовується разом зі збереженою оцінкою, а не окремо від неї. DOCGEN_RENDER_REVISION="2" фіксує версію детермінованого рендеру, щоб зміна шаблону або сценарію генерації автоматично робила наявну доку застарілою навіть без правок у source.

crc32 дає базовий стабільний CRC у hex, а documentationCrc збирає цілісний доказовий CRC для доки: source, пов’язані тести та рендер-ревізія входять в один ланцюжок, тому будь-яка зміна у вхідних даних або способі рендеру змінює підсумок. Саме цей підсумок є еталоном для перевірки актуальності доки.

parseDocFrontmatter відокремлює службові метадані від тіла доки й зберігає сумісність зі старими файлами, де якісні поля могли бути відсутні. На цій базі buildDocFrontmatter формує новий frontmatter, де спочатку йдуть OKF-поля, а потім службовий блок для CRC, model, tier та quality, щоб різні парсери могли читати основні дані без залежності від внутрішнього простору імен. stampDoc використовує цей шлях для повного перевипуску frontmatter у вже існуючому markdown-файлі.

readDocCrc, readDocQuality, readDocModel і readDocTier — це зчитування тих самих метаданих у різних зрізах: CRC, оцінки якості, моделі-генератора та tier. Вони не винаходять новий стан, а повертають те, що вже зафіксовано у frontmatter, або null-подібні значення, коли відповідних полів немає.

staleness порівнює збережений CRC доки з актуальним evidence і повертає лише два практичні стани: доки немає або evidence не збігається з тим, що записано у файлі. Усі інші випадки трактуються як свіжі, тож спільне правило для всього модуля просте: дока вважається валідною лише тоді, коли її frontmatter узгоджений із джерелом, пов’язаними тестами та ревізією рендеру.

## Публічний API

- QUALITY_THRESHOLD — Поріг degraded: дока зі `score` нижче вважається неякісною.
- DOCGEN_RENDER_REVISION — Версія детермінованих правил рендеру. Підвищуємо її, коли зміна промптів,
шаблонів або post-processing повинна перегенерувати навіть незмінений source.
Входить у CRC, тому окремий стан у frontmatter не потрібен.
- crc32 — CRC32 вмісту у hex (8 символів, з провідними нулями). Делегує у нативний
`node:zlib.crc32` — без ручної бітової арифметики.
- documentationCrc — CRC повного evidence для файлової доки: source, повʼязані тести й версія
детермінованого рендеру. Тому зміна usage-сценарію або шаблону робить доку
stale навіть без редагування самого source.
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

- `npm/rules/doc-files/docgen-crc/tests/docgen-crc.test.mjs` (crc32; frontmatter) — детермінований, 8-символьний hex; різний вміст → різний CRC; той самий — однаковий для рядка і Buffer; відомий вектор: CRC32; buildDocFrontmatter → парситься назад (без quality — score:null); model: повний id пишеться після crc і парситься назад; ще 16
- `npm/rules/doc-files/tests/main.test.mjs` (lint — детект (read-only detector)) — ci (files=undefined): ловить відсутню доку у дереві; ci: свіжа дока → 0 violations; quick: змінене джерело без доки → violation; порожній набір → 0; quick: не шукає сирітські docs поза explicit files; quick: реверс-мапінг — змінена дока веде до перевірки джерела; ще 6

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
