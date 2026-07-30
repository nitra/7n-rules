---
type: JS Module
title: main.mjs
resource: npm/rules/doc-files/docgen-files-batch/main.mjs
docgen:
  crc: c378cd5b
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 40
  issues: internal-name:parseGenArgs,internal-name:generateOne,internal-name:runBatchPass,internal-name:recordBatchOutcome,internal-name:reportStats,internal-name:runSequentialPass,best-of-2:retry-error
---

## Огляд

Файл відповідає за автоматизовану генерацію та управління документацією на основі вихідного коду. Він використовує функцію `selectTargets` для вибору цілей генерації, забезпечує визначення формату розміру через `fmtSize` та перевіряє доступність нативної пакетної обробки через `nativeBatchAvailable`. Дозволяє очищати застарілі документи за допомогою `purgeOrphanedDocs` та керувати прогонами генерації (послідовними чи пакетними) через `runGenerationBatch`. Процес генерації підтримує кешування протягом одного прогону та має локальні fail-safe гілки для мінімізації ризиків.

## Поведінка

При запуску через `runDocFilesGenCli`, функція `parseGenArgs` зчитує аргументи командного рядка, визначаючи ліміти та режими. Далі, `purgeOrphanedDocs` очищає сирітські доки та оновлює індекс. `selectTargets` визначає цілі генерації документації на основі встановлених режимів та результатів сканування. Основний потік ініціюється `runGenerationBatch`, який керує логікою генерації. Він спочатку викликає `nativeBatchAvailable`, щоб визначити можливість пакетної обробки. Якщо аддон доступний, то `runBatchPass` використовується для пакетного прогону; інакше ініціюється послідовний прогін через `runSequentialPass`. Під час очікування batch CLI залишається у foreground, кожні 30 секунд показує heartbeat із моделлю та часом очікування і дозволяє користувачу скасувати процес через Ctrl-C. Автоматичного timeout для doc-files немає. Зібрані дані про успішні та некоректні файли акумулюються, а `reportStats` надає підсумковий звіт. Для оновлення метаданих в існуючих документах використовується `runDocFilesStampCli`, який взаємодіє з `generateDirIndex` для синхронізації індексу.

## Публічний API

- selectTargets — Цілі генерації:
  - default      → застарілі (stale) АБО degraded-доки, які ще не доретраювали при цьому CRC;
  - `--overwrite` → усі.
Degraded-док отримує рівно ОДИН доретрай на версію джерела: після невдалого доретраю
(лишився degraded) штампується `retried: true` і його більше не чіпають до зміни джерела
(нова версія → CRC-mismatch → stale → лічильник скидається). Конвеєр сходиться без прапора.
- fmtSize — Діагностика розміру джерела (для дослідження, що роздуває контекст):
байти + груба оцінка токенів (~bytes/4). Без size-guard-гейта — лише вивід.
- nativeBatchAvailable — Чи доступний native-аддон `@7n/llm-lib` для 2b-batch (T8, рішення Р). Викликає
`submitBatchImpl` з порожнім `items` — це не робить жодного LLM-виклику
(Rust-крейт повертає порожній результат до резолву моделі), лише перевіряє,
що napi-аддон завантажується. Zero-native споживачі (аддон не зібраний/не
підтримувана платформа) отримують `false` і йдуть у послідовний фолбек.
- generateDirIndex — Генерує/оновлює `index.md` у директорії `docs/` — OKF Directory Index із таблицею
всіх наявних doc-файлів у цій директорії. Не зачіпає `index.md` при відсутності
інших doc-файлів.
- purgeOrphanedDocs — Видаляє сирітські доки (source-файл не існує) і оновлює/прибирає index.md.
Якщо після видалення в docs/-директорії лишились тільки index.md або нічого — очищує її.
- runDocFilesGenCli — `doc-files gen` — згенерувати документацію для застарілих/відсутніх док.
- runGenerationBatch — Спільне ядро генерації: preflight локального бекенда → послідовний прогін
`targets` через `generateOne` з circuit-breaker'ом (K systemic-збоїв підряд →
abort) → підсумковий звіт. Перевикористовують і батч-CLI (`runDocFilesGenCli`),
і opportunistic lint-крок doc-files (scoped-набір змінених файлів).

T8 (2b-batch, рішення Р): коли доступний native-аддон `@7n/llm-lib`
(`nativeBatchAvailable`), увесь `targets` іде ОДНИМ `submitBatch` через
`runBatchPass` замість циклу по одному файлу. Очікування не має автоматичного
timeout і не відʼєднується від CLI: heartbeat підтверджує активний foreground
процес, а Ctrl-C свідомо скасовує його. Zero-native споживачі (аддон не
зібраний або платформа не підтримується) автоматично лишаються на послідовному
шляху — без відмінностей у CLI/skill/hook-контракті.
- runDocFilesStampCli — `doc-files stamp` — детерміновано (пере)штампувати frontmatter `source`+`crc`
у НАЯВНИХ доках без виклику LLM. Для міграції док, які ще не мають CRC.
Поля `model`, `tier` та якості (`score`/`issues`/`judgeModel`) при цьому зберігаються
з наявного frontmatter.

## Сценарії використання

- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` (runDocFilesGenCli — circuit-breaker / класифікація; selectTargets — stale + degraded-once guard) — 3 systemic підряд → abort, exit 2, решта не обробляється; permanent → skip, прогін триває, exit 0; ok між systemic скидає streak → без abort; default: stale | degraded-not-cloud-avg → обрано; good | degraded-cloud-avg → пропущено; --overwrite → усі цілі незалежно від стану; ще 14
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-stamp.test.mjs` (runDocFilesStampCli — збереження frontmatter-полів) — stamp оновлює crc і НЕ губить tier/judgeModel/model/score/issues; stamp доки без quality-полів не вигадує їх і зберігає tier
- `npm/rules/doc-files/docgen-files-batch/tests/generate-dir-index.test.mjs` (generateDirIndex — MD025/single-title; generateDirIndex — чужий index.md не перезаписується) — згенерований index.md без H1 у тілі; markdownlint не репортить MD025; контроль чутливості: frontmatter title + H1 у тілі → markdownlint репортить MD025; людський index.md без frontmatter лишається недоторканим; index.md як дока source-файлу (type JS Module) лишається недоторканою; власний Directory Index перегенеровується; без інших док index не створюється

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Кешує результати в межах одного прогону.
