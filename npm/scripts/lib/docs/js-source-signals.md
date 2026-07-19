---
type: JS Module
title: js-source-signals.mjs
resource: npm/scripts/lib/js-source-signals.mjs
docgen:
  crc: 4a8d80d5
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`auto-rules.mjs` викликає ці regex-only текстові сигнали на кожному зміненому файлі, без AST, щоб швидко збирати факти для авто-детекту правил у JS/TS/Vue-джерелах. Спільні функції `textHasBunSqlImport`, `extractVueScriptBlocks` і `contentForVueImportScan` живуть у `@7n/rules/scripts/lib/…` і використовуються також правилами `@7n/rules-lang-js` для `js-bun-db` та `vue`, щоб не дублювати одні й ті самі сигнали в різних місцях. Компонент read-only і не пише у ФС чи БД.

## Поведінка

- `textHasBunSqlImport` — визначає, чи в тексті є імпорт `sql` або `SQL` з `bun`.
- `extractVueScriptBlocks` — витягує з Vue SFC увесь код із `<script>`-блоків і склеює його в один текст.
- `contentForVueImportScan` — готує вміст до сканування: для `.vue` лишає тільки `<script>`-блоки, для інших файлів бере весь текст.

## Публічний API

- textHasBunSqlImport — знаходить у сирому тексті імпорт `sql` або `SQL` з `"bun"` для швидкого визначення, чи є в файлі доступ до Bun SQL API.
- extractVueScriptBlocks — дістає з Vue SFC лише вміст `<script>`, щоб аналіз не зачіпав template.
- contentForVueImportScan — для `.vue` бере тільки script-блоки, а для інших файлів — увесь текст, щоб сканувати саме релевантний код.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
