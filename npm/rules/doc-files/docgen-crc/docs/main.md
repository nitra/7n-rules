---
type: JS Module
title: main.mjs
resource: npm/rules/doc-files/docgen-crc/main.mjs
docgen:
  crc: fdddffc3
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:error
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`crc32` обчислює детермінований 8-символьний hex CRC для рядка або Buffer; `documentationCrc` і `parseDocFrontmatter` зв’язують вміст документа з його frontmatter. `buildDocFrontmatter` і `stampDoc` записують fresh metadata для `CRC`, `model`, `tier` та `quality`, причому `stampDoc` ще й керує маркером `degraded`. `readDocCrc`, `readDocModel`, `readDocTier` і `readDocQuality` відновлюють ці значення з доки, а `QUALITY_THRESHOLD` задає дефолтний поріг 70. `staleness` порівнює source і doc, щоб відрізняти `missing`, `crc-mismatch` і `fresh`.

## Поведінка

QUALITY_THRESHOLD задає дефолтний поріг оцінки якості для читання й маркування доки; у перевірених сценаріях цей поріг дорівнює 70.

crc32 дає детермінований 8-символьний hex для рядка або Buffer; однаковий вміст завжди дає той самий CRC, а різний — інший; відомий вектор `123456789` зводиться до `cbf43926`.

documentationCrc обчислює CRC для поведінкової документації не лише з джерела, а й з пов’язаного evidence тестів, якщо він є; без пов’язаних тестів лишається сумісним із CRC самого source, тож зміна лише сценарію використання робить доку застарілою.

parseDocFrontmatter відокремлює frontmatter від тіла доки й повертає нормалізовані метадані; якщо frontmatter немає, тіло лишається без змін, а метадані відсутні; старі доки без частини полів читаються як сумісні: відсутні `model`, `tier`, `score`, `issues` та `judgeModel` стають порожніми значеннями.

buildDocFrontmatter формує frontmatter так, щоб спочатку були OKF-поля джерела, а потім вкладений блок якості та генератора; `model` і `tier` додаються лише коли вони є, а `issues` скорочуються до YAML-безпечних кодів і мають обмеження на кількість; quality може співіснувати з model, причому score та issues зберігаються й читаються назад без втрат.

stampDoc переоформлює існуючу MD-доку: знімає старий frontmatter і додає свіжий, не змінюючи тіло; коли quality є, у frontmatter лишається degraded-сигнал разом із score/issues, а коли quality зникає — цей стан теж знімається; `model` переноситься у новий frontmatter разом із рештою актуальних метаданих.

readDocCrc повертає CRC, уже записаний у frontmatter; якщо доки немає або CRC не зафіксований, результат `null`.

readDocQuality читає збережену оцінку доки; за відсутності доки або score повертає `score: null`, порожній список issues і `judgeModel: null`; коли якість записана, значення відновлюються назад без втрат.

readDocModel повертає збережену модель генератора або `null`, якщо доки немає чи поле не записане.

readDocTier повертає tier моделі генератора або `null`, якщо доки немає чи поле не записане.

staleness порівнює evidence source з CRC, записаним у відповідній доці: коли доки немає, стан `missing`; коли CRC не збігається, `crc-mismatch`; при збігу дока свіжа; для пов’язаних тестів у evidence враховується й їхній вплив на CRC доки, тому зміна сценарію використання може зробити документацію stale навіть без зміни source.

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

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
