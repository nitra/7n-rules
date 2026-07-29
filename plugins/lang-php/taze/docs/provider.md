---
type: JS Module
title: provider.mjs
resource: plugins/lang-php/taze/provider.mjs
docgen:
  crc: daf0054f
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 90
  issues: internal-name:collectComposerDiff,judge-refine:kept-original,judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

PHP-провайдер оновлень працює з кореневим composer.json: `findComposerManifest` знаходить маніфест, `bumpComposerDependencies` піднімає прямі залежності через Composer і мережеву резолюцію пакетів, `buildComposerDependencyPrompt` формує самодостатні LLM-запити щодо залежностей. `backupComposerManifest` і `cleanupComposerBackups` надають точки інтеграції для керування резервними копіями без власних операцій запису в цьому файлі.

## Поведінка

findComposerManifest відкриває PHP-гілку оновлення лише для кореневого composer.json; вкладені workspaces свідомо не входять у цей скоуп. Перед змінами backupComposerManifest зберігає стан маніфеста й lock-файла, щоб оркестратор міг порівняти версії після bump-у.

bumpComposerDependencies отримує прямі залежності з маніфеста й послідовно просить Composer підняти кожну до актуальної сумісної версії. Дані йдуть із репозиторію та мережевої резолюції пакетів, зокрема через https://packagist.org/packages/, а результатом стає оновлений PHP-стан проєкту для подальшої класифікації змін. Провал одного пакета не зупиняє обробку решти, щоб не втрачати корисний прогрес.

Для major-оновлень buildComposerDependencyPrompt формує один самодостатній запит до LLM на пакет: у нього потрапляє шлях маніфеста, назва пакета та перехід версій, а результат іде в ітеративний етап адаптації коду. Запит також може спрямовувати до офіційного джерела Composer https://getcomposer.org/download/ для перевірки контексту інструмента.

cleanupComposerBackups завершує потік і прибирає тимчасові копії після того, як оркестратор використав їх для аналізу. Усі ці дії працюють як PHP-провайдер у ширшому npm-контексті проєкту, де package.json визначає доступність інструментів запуску, а стан між кроками передається через файли репозиторію та результати Composer.

## Публічний API

- buildComposerDependencyPrompt — Промпт ОДНОГО ітеративного виклику для PHP-пакета (кроки 4-6 SKILL.md, PHP-гілка) для ОДНОГО
major-пакета. Кроки 1-3/7/8 виконує оркестратор ядра детерміновано, без LLM.
- findComposerManifest — Знаходить кореневий `composer.json` (той самий root-only автодетект-конвенція, що й
`rules/php/project/main.mjs`). v1: один кореневий файл, без обходу вкладених workspaces —
окрема фіча, не цей скоуп.
- backupComposerManifest — Бекапить composer.json + composer.lock (крок 1 SKILL.md, PHP-гілка) — потрібно для
класифікації major/minor через `collectComposerDiff` після bump-у.
- cleanupComposerBackups — Прибирає бекапи composer.json/composer.lock після завершення (крок 7 SKILL.md, PHP-гілка).
- bumpComposerDependencies — Піднімає кожну пряму залежність composer.json через `composer require <pkg> --with-all-dependencies
--no-interaction` (крок 2 SKILL.md, PHP-гілка) — Composer, як і `uv`, **не має** єдиної команди
"підняти все до latest, навіть через major": `composer update` (навіть із `--with-all-dependencies`)
лишається в межах ІСНУЮЧОГО constraint-у в composer.json (напр. `^7.4` ніколи не перескочить на
`8.x` через `update`) — офіційно задокументована поведінка Composer, на відміну від
`bunx taze -w -r latest`/`cargo upgrade --incompatible allow`. `composer require <pkg>` без
версії, навіть якщо пакет вже присутній, змушує Composer заново резолвити НАЙНОВІШУ версію, що
задовольняє stability-налаштування, і переписати constraint у composer.json — той самий підхід,
що й "запросити пакет знову" для форс-бампу, паралель до `uv remove`+`uv add` (там Composer не
потребує окремого `remove` — сам `require` перезаписує constraint без проміжного стану).
`--dev` для записів `require-dev`. Провал одного пакета (мережа/резолюція) не втрачає прогрес
по інших — Composer сам не застосовує часткову зміну composer.json при провалі `require`.

## Сценарії використання

- `plugins/lang-php/taze/tests/provider.test.mjs` (phpProvider (форма контракту); buildComposerDependencyPrompt) — валідний EcosystemProvider за assertEcosystemProvider ядра; available: composer відсутній → ok:false з причиною; available: composer є → ok:true; містить пакет, маніфест і версії; не змішує з Rust/Python/npm-командами інших гілок; ще 7

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
