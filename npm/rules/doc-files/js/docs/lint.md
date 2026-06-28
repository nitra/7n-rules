---
type: JS Module
title: lint.mjs
resource: npm/rules/doc-files/js/lint.mjs
docgen:
  crc: 1497e0d6
---

Модуль надає CLI- та rule-entrypoint для перевірки файлової документації. Він знаходить застарілі або відсутні `docs/<stem>.md`, виявляє orphan-доки й у rule-fix режимі виконує детерміноване CRC-оновлення без звернення до LLM.

## Поведінка

- `lint-doc-files` лишається детектором: повертає помилку, якщо для заданого scope є `missing` або `crc-mismatch`.
- `--json`, `--hook`, `--git` і `--degraded` делегуються у спеціалізовані режими scanner-а.
- Rule-entrypoint перед повторною перевіркою штампує stale-доки поточним CRC, створює мінімальну доку для відсутнього файлу й прибирає згенеровані orphan-доки.
- Після repair модуль повторно сканує дерево та репортить лише ті порушення, які не вдалося закрити.

## Публічний API

- `runLintDocFilesSteps(argv)` — синхронний детект для повного або точкового scope.
- `runLintDocFilesCli(argv)` — CLI-обгортка з підтримкою режимів правила.
- `main(cwd)` — entrypoint для агрегатора правил `@nitra/cursor fix doc-files`.
