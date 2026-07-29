---
type: JS Module
title: main.mjs
resource: npm/rules/doc-files/docgen-files-batch/main.mjs
docgen:
  crc: 7531d04c
  model: omlx/gemma-4-e2b-it-4bit
  tier: local-min
  score: 35
  issues: no-overview,short-behavior,internal-name:generateOne,internal-name:runBatchPass,best-of-2:retry-lost
---

## Публічний API

- selectTargets — Цілі генерації:
  - default      → застарілі (stale) АБО degraded-доки, які ще не доретраювали при цьому CRC;
  - `--overwrite` → усі.
Degraded-док отримує рівно ОДИН доретрай на версію джерела: після невдалого доретраю
(лишився degraded) штампується `retried: true` і його більше не чіпають до зміни джерела
(нова версія → CRC-mismatch → stale → лічильник скидається). Конвеєр сходиться без прапора.
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

`deadlineAt` (epoch ms): м'який дедлайн fix-pipeline — перед стартом КОЖНОГО
наступного файлу (перший стартує завжди) батч звіряється з дедлайном і, коли час
вийшов, завершується штатно з частковим прогресом. Той самий дедлайн прокидається
у generateDoc: per-call LLM-таймаути ріжуться під залишок бюджету, тож і файл
У ПРОЦЕСІ обривається на дедлайні (transient-помилка), а не живе батчем-зомбі
поверх наступного rung-а. Зроблене записано по одному файлу (durable, свіжий
CRC) — наступний прогін підбирає решту за CRC.
T8 (2b-batch, рішення Р): коли доступний native-аддон `@7n/llm-lib` (`nativeBatchAvailable`)
і рунг БЕЗ `deadlineAt` (fix-pipeline рунги лишаються на послідовному шляху —
там дедлайн підтримується), увесь `targets` іде ОДНИМ `submitBatch` через
`runBatchPass` замість цього циклу по одному файлу. Zero-native споживачі
(аддон не зібраний/платформа не підтримується) автоматично лишаються на
послідовному шляху нижче — жодної відмінності в CLI/skill/hook-контракті.
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
