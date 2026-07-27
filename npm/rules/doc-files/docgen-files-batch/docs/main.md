---
type: JS Module
title: main.mjs
resource: npm/rules/doc-files/docgen-files-batch/main.mjs
docgen:
  crc: 26d7897d
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 80
  issues: internal-name:generateOne,internal-name:runBatchPass,judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`selectTargets` визначає, які файли потребують оновлення, а `nativeBatchAvailable` — чи доступний batch-режим для поточного прогону. `runDocFilesGenCli` запускає генерацію документації, `runGenerationBatch` виконує її у batch-режимі, а `runDocFilesStampCli` оновлює службові позначки прогону. Після генерації `generateDirIndex` підтримує directory index в узгодженому стані, а `purgeOrphanedDocs` прибирає застарілі артефакти, щоб дерево документації лишалося чистим. Усе це працює fail-safe: помилки перехоплюються, назовні не кидаються, а проміжні результати зберігаються в межах одного прогону через кешування.

## Поведінка

Потік починається з відбору цілей: базовий режим бере лише застарілі або degraded-доки, які ще не отримували повторної спроби для поточної версії джерела; режим overwrite примусово бере все. Після цього preflight перевіряє, чи доступний native batch-шлях із локальним provider, і тільки тоді весь набір іде одним batch-запитом; якщо ні — прогін переходить у послідовний режим. Обидва шляхи працюють з одним і тим самим набором правил: помилки класифікуються однаково, кожен результат або записується як успішний/деградований, або потрапляє в помилки чи skipped, а зміни на диск фіксуються одразу, щоб наступний прогін підхопив лише те, що ще лишилося.

Batch-прогін і послідовний прогін сходяться в одному підсумку: статистика, перелік помилок, перелік пропусків і оновлені документи з новим CRC. У batch-режимі всі придатні файли готуються заздалегідь, а ті, що не проходять pre-send guard, одразу виходять зі статусом помилки або skip і не потрапляють у LLM. У послідовному режимі кожен файл обробляється окремо, з м’яким дедлайном для поступового добирання великих рунів; системні збої можуть зупинити прогін достроково, але вже записане лишається на диску. Для локального batch-шляху очікується провайдер `omlx` з базою `http://127.0.0.1:8000/v1/`, і результат кешується в межах прогону, щоб не перевіряти одне й те саме повторно.

Командний вхід `runDocFilesGenCli` спочатку чистить сирітські доки через `purgeOrphanedDocs`, потім відбирає цілі, запускає генерацію і наприкінці оновлює directory index через `generateDirIndex`. Якщо прогін переривається через системний аборт або дедлайн, це відображається окремо, але зроблені файли не губляться. `runDocFilesStampCli` працює окремо від генерації: він лише синхронізує наявні доки з джерелом і підтримує directory index у консистентному стані без звернення до LLM.

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

- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — runDocFilesGenCli — circuit-breaker / класифікація
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — 3 systemic підряд → abort, exit 2, решта не обробляється
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — permanent → skip, прогін триває, exit 0
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — ok між systemic скидає streak → без abort
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — selectTargets — stale + degraded-once guard
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — default: stale | degraded-not-cloud-avg → обрано; good | degraded-cloud-avg → пропущено
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — --overwrite → усі цілі незалежно від стану
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — foreign (рукописна дока): без --overwrite не ціль, з --overwrite — explicit перезапис
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — runGenerationBatch — м
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — дедлайн у минулому → перший файл обробляється, решта відкладається, штатний exit 0
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — без deadlineAt → увесь беклог, як раніше
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — deadlineAt прокидається у generateDoc — дедлайн ріже і файл у процесі
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — nativeBatchAvailable — детекція native-аддону (T8)
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — submitBatchImpl резолвиться → true, кешується (той самий impl не викликається вдруге)
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — submitBatchImpl кидає (аддон не зібраний) → false, послідовний фолбек
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — useCache=false: кожен виклик перевіряє заново (не залежить від попереднього результату)
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — runGenerationBatch — 2b-batch шлях (T8, native доступний)
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — N файлів одним submitBatchImpl-викликом (не по одному через generateDoc)
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — comment-only елементи штампуються без реального submitBatch
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — помилка ОДНОГО item-у не валить решту batch-у (permanent → skip, err → errors)
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — deadlineAt заданий → фолбек на послідовний шлях (batch не викликається)
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — forceSequential=true → фолбек на послідовний шлях навіть коли submitBatchImpl доступний
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — native-аддон недоступний (submitBatchImpl кидає) → послідовний фолбек, файли все одно оброблені
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — runDocFilesGenCli — foreign-доки (захист людського змісту)
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-batch.test.mjs` — docPath існує без docgen-frontmatter → skip із попередженням, генерація не викликається
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-stamp.test.mjs` — runDocFilesStampCli — збереження frontmatter-полів
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-stamp.test.mjs` — stamp оновлює crc і НЕ губить tier/judgeModel/model/score/issues
- `npm/rules/doc-files/docgen-files-batch/tests/docgen-files-stamp.test.mjs` — stamp доки без quality-полів не вигадує їх і зберігає tier
- `npm/rules/doc-files/docgen-files-batch/tests/generate-dir-index.test.mjs` — generateDirIndex — MD025/single-title
- `npm/rules/doc-files/docgen-files-batch/tests/generate-dir-index.test.mjs` — згенерований index.md без H1 у тілі; markdownlint не репортить MD025
- `npm/rules/doc-files/docgen-files-batch/tests/generate-dir-index.test.mjs` — контроль чутливості: frontmatter title + H1 у тілі → markdownlint репортить MD025
- `npm/rules/doc-files/docgen-files-batch/tests/generate-dir-index.test.mjs` — generateDirIndex — чужий index.md не перезаписується
- `npm/rules/doc-files/docgen-files-batch/tests/generate-dir-index.test.mjs` — людський index.md без frontmatter лишається недоторканим
- `npm/rules/doc-files/docgen-files-batch/tests/generate-dir-index.test.mjs` — index.md як дока source-файлу (type JS Module) лишається недоторканою
- `npm/rules/doc-files/docgen-files-batch/tests/generate-dir-index.test.mjs` — власний Directory Index перегенеровується; без інших док index не створюється

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- Кешує результати в межах одного прогону.
