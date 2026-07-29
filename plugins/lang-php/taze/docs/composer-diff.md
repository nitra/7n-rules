---
type: JS Module
title: composer-diff.mjs
resource: plugins/lang-php/taze/composer-diff.mjs
docgen:
  crc: cd7046c6
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Модуль відокремлює реальні Composer-пакети від платформних вимог, щоб зміни в залежностях оцінювалися за тим самим правилом у всіх місцях, де потрібна Composer-логіка.

`parseComposerVersion` нормалізує версію пакета до придатного для порівняння вигляду. `isRealComposerPackage` визначає, чи запис описує справжню Composer-залежність, а не службову вимогу платформи. `diffComposerJson` порівнює два `composer.json` і виділяє відмінності між ними. `collectComposerDiff` зводить ці відмінності в узгоджений набір для подальшої обробки. `listDirectComposerDependencies` повертає прямі залежності, щоб працювати саме з видимими зв’язками між пакетами.

## Поведінка

parseComposerVersion зводить версійний constraint до найконсервативнішого числового ядра, яке далі використовує diffComposerJson для порівняння залежностей між двома станами composer.json. Для не-semver значень ядро відсутнє, тож такі записи не беруть участі в оцінці зміни версії.

isRealComposerPackage відсікає платформні вимоги й залишає лише справжні пакети з дерева залежностей, щоб diffComposerJson і listDirectComposerDependencies працювали тільки з тими залежностями, які можна піднімати окремо.

diffComposerJson бере два розпарсені стани composer.json, застосовує спільні правила парсингу та фільтрації і повертає розділені результати для major-змін і менш ризикових оновлень; саме цей формат потім агрегує collectComposerDiff.

collectComposerDiff зчитує поточний composer.json і його backup-варіант із кореня репозиторію, де цей файл виступає джерелом істини; якщо одна зі сторін відсутня, порівняння не виконується. Успішний результат містить загальну кількість змін і кількість порівняних маніфестів, а також зведений diff, який далі можна використовувати в taze-процесі. Поведінка розрахована на той самий кореневий контекст, що й інші мовні плагіни, і не зачіпає package.json напряму.

listDirectComposerDependencies читає прямі залежності з require і require-dev, застосовує спільне відсікання платформних псевдопакетів і віддає плоский список для подальшого per-package проходу. Це дає узгоджене джерело для обходу залежностей без змішування технічних і реальних пакетів.

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
