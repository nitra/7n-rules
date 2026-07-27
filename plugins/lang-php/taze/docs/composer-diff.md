---
type: JS Module
title: composer-diff.mjs
resource: plugins/lang-php/taze/composer-diff.mjs
docgen:
  crc: 4cd0cabb
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 95
  issues: anchor-miss:package.json,judge:error
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл зводить стан `composer.json` у структурований diff, щоб передати результат далі для пакетного bump-проходу. Також він відбирає лише реальні Composer-пакети через `isRealComposerPackage` і збирає прямі залежності через `listDirectComposerDependencies`.

## Поведінка

parseComposerVersion ідентифікує лише ліву числову гілку версійного constraint; далі diffComposerJson використовує цей спрощений зріз разом з isBreaking, щоб відокремити зміни, які виглядають як major, від решти змін. Для нечислових або платформних значень результатом лишається безпечне пропускання або порожнє значення, а не помилка.

collectComposerDiff зводить порівняння до пари snapshot-файлів у корені репозиторію: актуального composer.json і його backup-версії з тим самим суфіксом, який використовується в проєкті для резервних копій; якщо один із файлів недоступний або невалідний, порівняння завершується порожнім diff без падіння. На виході формується агрегат із major-розбіжностями, кількістю minor/patch-змін і підрахунком, скільки маніфестів реально було зіставлено.

listDirectComposerDependencies працює з тим самим джерелом даних і відбирає лише прямі залежності з composer.json, уже очищені від платформних псевдо-пакетів, щоб їх можна було використовувати як вхід для per-package bump-проходу. Сукупно ці функції тримають один спільний контракт: читання стану з composer.json, порівняння з backup-копією, ігнорування не-пакетних вимог та повернення структурованого результату без запису в сховище.

## Публічний API

- parseComposerVersion — Парсить Composer-версійний constraint (1-3 компоненти, відсутні → 0). Не претендує на повний
розбір усіх Composer-версійних форм (OR-набори `||`, wildcard `.*`, `dev-`/`branch-alias`) —
бере лише ліву числову гілку, достатню для caret-класифікації major vs minor/patch.
- isRealComposerPackage — Чи є ключ `require`/`require-dev` реальним Composer-пакетом (`vendor/package`), а не
платформним псевдо-пакетом (`php`, `ext-json`, `lib-openssl`, `composer-plugin-api`,
`composer-runtime-api`) — платформні вимоги не мають окремого дерева версій, яке можна
підняти через `composer require`, тому виключені з diff/bump.
- diffComposerJson — Порівнює два розпарсені composer.json і повертає зміни залежностей — той самий контракт,
що й `diffCargoToml`/`diffPyprojectDeps` інших мовних плагінів.
- collectComposerDiff — Збирає diff по composer.json: порівнює `<cwd>/composer.json` з
`<cwd>/composer.json<backupSuffix>` — той самий контракт, що й `collectUvDiff`/`collectCargoDiff`.
- listDirectComposerDependencies — Дістає `{name, dev}` кожної прямої залежності з `require`/`require-dev` поточного
composer.json (платформні псевдо-пакети — виключені, `isRealComposerPackage`) — вхід для
per-пакетного bump-циклу.

## Сценарії використання

- `plugins/lang-php/taze/tests/composer-diff.test.mjs` (parseComposerVersion; isRealComposerPackage) — 1-3 компоненти, відсутні → 0; знімає операторні префікси (^/~/>=/v); wildcard — бере лише числову ліву гілку; OR-набір — бере першу альтернативу; не-версія → null; ще 14

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
