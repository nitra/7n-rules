---
type: JS Module
title: fix-workflows.mjs
resource: npm/rules/ga/workflows/fix-workflows.mjs
docgen:
  crc: 5f7fc736
---

## Огляд

T0-autofix для `ga/workflows`: детерміновані текстові правки GitHub Actions workflow-файлів без
участі LLM, керовані structured fix-hint детектора (поле `data.kind` у violation). Виконується у
fix-фазі перед LLM-ладдером; правки незворотні (поза rollback), а коректність підтверджує
повторний прогін детектора.

## Поведінка

- **checkout-persist-credentials** — у кожен крок `actions/checkout`, де бракує
  `persist-credentials: false`, дописує цей ключ: створює блок `with:` (відступ за колонкою
  `uses:`) або додає ключ у наявний `with:`. Кілька checkout-кроків у файлі обробляються всі.
- **unmatched-paths-glob** — прибирає з `on.<event>.paths` (push / pull_request) list-елементи,
  що відповідають застарілим glob-ам із fix-hint; видалення обмежене блоком `paths:`, тож
  однойменні значення деінде не зачіпаються.

Правки текстові — коментарі, форматування й порожні рядки зберігаються, diff мінімальний.

## Публічний API

- `patterns` — масив T0-патернів (`id` / `test` / `apply`), що його споживає центральний fix-pipeline.
- `addPersistCredentials`, `removePathsGlobs` — чисті трансформери вмісту файлу: повертають новий
  текст або `null`, якщо змін немає.

## Гарантії поведінки

- Жодного запису без фактичної зміни вмісту; перед записом реєструється pre-image через `recordWrite`.
- Регулярні вирази лінійні (без ReDoS); парсинг list-елементів — рядковими операціями.
- Не-checkout кроки та значення поза блоком `paths:` лишаються недоторканими.
