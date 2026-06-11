---
docgen:
  source: npm/scripts/utils/ast-scan-utils.mjs
  crc: 0f9b4a21
---

# ast-scan-utils.mjs

## Огляд

Цей файл містить утиліти для AST-сканерів JavaScript та TypeScript, що використовуються для аналізу коду та виявлення потенційних проблем. Він надає інструменти для обробки AST, перетворення даних та взаємодії з різними типами вузлів, забезпечуючи основу для створення правил безпеки та аналізу коду. Ці утиліти спрощують розробку сканерів, усуваючи необхідність повторного написання boilerplate-коду.

## Поведінка

langFromPath: Визначає мову (js, jsx, ts, tsx) на основі розширення файлу.
offsetToLine: Перетворює байтове зміщення в номер рядка для текстового файлу.
normalizeSnippet: Стискає текстовий фрагмент до 180 символів, видаляючи пробіли.
isFunctionNode: Визначає, чи є вузол AST функцією (FunctionDeclaration, FunctionExpression, ArrowFunctionExpression).
walkAstWithAncestors: Рекурсивно обходить AST, збираючи предки вузла.
parseProgramOrNull: Парсує файл JS/TS та повертає програму або null, якщо є помилки.
parseProgramAndCommentsOrNull: Парсує файл JS/TS та повертає програму та список коментарів, або null, якщо є помилки.
isJoinCall: Визначає, чи є виклик `join` у TemplateLiteral.
templateQuasisText: Збирає текст quasis з TemplateLiteral.
isSqlListContextTemplate: Визначає, чи є TemplateLiteral контекстом SQL-списку (IN/VALUES).
requireCallModule: Витягує ім'я модуля з аргументу виклику `require`.
dynamicImportModule: Витягує ім'я модуля з аргументу виклику `import`.

## Публічний API

- langFromPath — Визначає мову Oxc на основі розширення файлу.
- offsetToLine — Перетворює зміщення в буфер на номер рядка.
- normalizeSnippet — Форматує текст повідомлення про порушення, видаляючи зайві пробіли.
- isFunctionNode — Визначає, чи є вузол у абстрактному синтаксичному дереві (AST) функцією.
- walkAstWithAncestors — Рекурсивно обходить AST, враховуючи контекст (чи знаходиться вузол всередині функції).
- parseProgramOrNull — Парсить файл та повертає AST, якщо успішно, або `null` у разі помилки.
- parseProgramAndCommentsOrNull — Парсить файл та повертає об'єкт з AST та коментарями, або `null` у разі помилки.
- isJoinCall — Визначає, чи є виклик `.join` (для динамічних списків SQL).
- templateQuasisText — Витягує текст з `quasis` у `TemplateLiteral`, ігноруючи вирази.
- isSqlListContextTemplate — Визначає, чи є `TemplateLiteral` контекстом SQL-списку (наприклад, `IN` або `VALUES`).
- requireCallModule — Перевіряє, чи є виклик `require` з рядковим ім'ям.

## Гарантії поведінки

- `langFromPath` повертає назву мови JavaScript або TypeScript на основі розширення файлу.
- `langFromPath` повертає `null`, якщо розширення файлу не підтримується.
- `offsetToLine` перетворює зміщення в коді на номер рядка.
- `offsetToLine` повертає `null`, якщо зміщення недійсне.
- `normalizeSnippet` стискає текст сніпета.
- `normalizeSnippet` повертає `null`, якщо не вдалося стиснути сніпет.
- `isFunctionNode` визначає, чи є вузол AST функцією.
- `isFunctionNode` повертає `true` якщо вузол є функцією, інакше `false`.
- `walkAstWithAncestors` обходить AST, враховуючи предки вузлів.
- `walkAstWithAncestors` не повертає значень.
- `parseProgramOrNull` парсує програму та повертає її як AST або `null`, якщо парсинг не вдається.
- `parseProgramOrNull` повертає `null`, якщо програма не може бути успішно розпарсена.
- `parseProgramAndCommentsOrNull` парсує програму
