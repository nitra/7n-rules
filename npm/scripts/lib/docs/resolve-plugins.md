---
type: JS Module
title: resolve-plugins.mjs
resource: npm/scripts/lib/resolve-plugins.mjs
docgen:
  crc: 8a22c0a5
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 60
---

## Огляд

Резолв плагінів `@7n/rules`: які пакети-плагіни активні у проєкті, де їхні `rules/`,
які capabilities вони дають і які handlers надають.

Джерело правди — поле `plugins: string[]` у `.n-rules.json`. Явний `[]` = «плагіни
вимкнено» (автодетект не застосовується). Якщо поля немає взагалі — повний автодетект
(`detectPluginsFromRepo`). Якщо `plugins` непорожній і складається **виключно** з пакетів
за конвенцією `@7n/rules-<category>-<name>` (напр. `ci`, `lang`) — автодетект домішує
лише ті категорії, яких у списку немає (ADR `260719-2154-per-category-автодетект-плагінів`);
будь-який сторонній (не `@7n/rules-*`) пакет у списку вимикає backfill повністю — змішаний
чи повністю кастомний список означає ручне керування, без сюрпризів. Файлові сигнали
автодетекту: `.github/workflows/*.yml` → `@7n/rules-ci-github`; `azure-pipelines.yml` →
`@7n/rules-ci-azure`, а без них — fallback за `repository.url` кореневого package.json
(`github.com` / `dev.azure.com`).

Установка: `ensurePluginInstalled` — плагін стає devDependency через `bun add -d` (bun сам
резолвить актуальну версію; зміна видима у diff package.json). Фейл установки (offline,
пакет ще не опублікований) — warning + graceful skip, ніколи не hard-fail: лінт/синк
мають працювати без мережі. Hot-path (hook) НЕ встановлює — лише резолвить уже встановлені
(`allowInstall: false`).

Маніфест плагіна — блок `"n-rules"` у його package.json:
`{ "requiresPluginApi": 2, "capabilities": ["ci:github"], "slots": { "provides": [...] } }`.
`capabilities` живлять гейт концернів (`concern.json` → `requires.capability`) і
`requires.capabilities` у slot contributions. Composition-контракт (rules, handlers,
doc-files-розширення, skill-фрагменти) повністю на universal slot bus (`plugin-slots.mjs`,
spec 2026-07-27-universal-plugin-slots-lang-php-extraction, Фаза 2 — full migration): цей
модуль лишається відповідальним ЛИШЕ за низькорівневий резолв — які пакети активні, де їхній
`packageRoot`, який у них `n-rules`-маніфест (сире `capabilities`/`requiresPluginApi`/`slots`),
без жодної нормалізації composition-полів.

Сумісність plugin API (Фаза 0, §10 тієї ж спеки): маніфест може декларувати число
`requiresPluginApi`. Якщо воно більше за `PLUGIN_API_VERSION` цього core — плагін несумісний і
пропускається у `resolvePlugins()` із warning (окрім `quiet:true`, де пропуск тихий). Відсутнє
або нечислове поле — сумісний (та ж перевірка діє і для плагінів, що ще не дійшли до
`requiresPluginApi: 2` — цей модуль сам їх не гейтує за версією v2, це робить
`plugin-slots.mjs` окремо для slot graph).

## Публічний API

- KNOWN_CI_PLUGINS — Відомі CI-плагіни для автовизначення: сигнал у дереві репо → npm-пакет.
- KNOWN_LANG_PLUGINS — Відомі мовні плагіни: файловий сигнал екосистеми → npm-пакет. `maxDepth` —
до якої глибини шукати сигнал: python — лише корінь (uv-провайдер v1
обробляє тільки кореневий pyproject.toml; js — кореневий package.json); rust — до 3 рівнів, бо в
монорепо Cargo.toml часто вкладений (Tauri `app/src-tauri/Cargo.toml`),
а провайдер обробляє всі знайдені маніфести; php — до 2 рівнів (nested Composer workspaces,
ADR `2026-07-27-nested-composer-workspace-detection`: типові `services/api/composer.json`,
`backend/composer.json`), бо `vendor/<vendor>/<package>/composer.json` лежить на глибині 3 і
лишається поза детектом навіть без покладання на skip-теку `vendor` нижче (яка вже відсікає
весь `vendor/**` явно, незалежно від глибини).
- detectPluginsFromRepo — Автодетект плагінів за станом репозиторію: CI-плагіни (файлові сигнали з
fallback на `repository.url`) + мовні плагіни (лише файлові сигнали —
маніфест екосистеми в корені або, для rust, у підтеках до 3 рівнів; URL-fallback для мов безглуздий).
- pluginCategory — Категорія плагіна за naming convention `@7n/rules-<category>-<name>` (напр. `ci`, `lang`).
`null` — пакет поза цією конвенцією (сторонній/кастомний плагін); такий пакет ніколи не
зʼявляється сам через автодетект і, якщо присутній у явному `config.plugins`, вимикає
per-категорійний backfill для всього списку (див. `resolvePluginList`).
- resolvePluginList — Список плагінів проєкту: явний `config.plugins` або автодетект.

Явний `plugins` непорожній і складається **виключно** з пакетів `@7n/rules-<category>-*` —
автодетект домішує лише категорії, відсутні в списку (ADR
`260719-2154-per-category-автодетект-плагінів`); категорія, присутня хоч одним пакетом,
лишається зафіксованою користувачем. Якщо `plugins` містить хоча б один сторонній
(не `@7n/rules-*`) пакет — це сигнал ручного керування, backfill вимикається повністю
(як і раніше: список повертається як є). Явний `[]` — «плагіни вимкнено», без backfill.
Поле відсутнє взагалі — повний автодетект.

Результат кешується на процес за `(projectRoot, declared)` — виклик з `resolvePlugins`
(через `resolveSlotGraph`/`resolveRulesDirs` у `plugin-slots.mjs` тощо) і прямий виклик у
sync-CLI інакше дублювали б і файловий скан, і warning про backfill.
  ігнорується при cache hit — warning друкується щонайбільше раз на `(root, declared)` за процес
- KNOWN_PLUGIN_RANGES — Сумісний semver-range для first-party плагінів: обмежує автоматичну інсталяцію (`ensurePluginInstalled`)
поточною core-сумісною лінією, щоб майбутній несумісний major/minor плагіна не встановився
мовчки поверх старого core (Фаза 0, spec 2026-07-27-universal-plugin-slots-lang-php-extraction.md
§10). Для `0.x`-пакетів — caret на поточний minor (`^0.23`, а не голий `^0`, який під caret-
семантикою розгортається у весь діапазон `0.x`); для `>=1` — caret на поточний major (`^2`).
Невідомий (сторонній, не з цієї таблиці) пакет інсталюється без обмеження версії — як і раніше.
Ranges відповідають лініям із `requiresPluginApi: 2` (перші релізи: core 1.52.0, ci 2.0.0,
lang-js 0.23.0, lang-python 0.11.0, lang-rust 0.14.0, lang-php 0.2.x) — старіші лінії
new-core виключає зі slot graph, тож автоматична інсталяція не має їх приносити.
- ensurePluginInstalled — Гарантує, що плагін встановлений: якщо `node_modules/<pkg>` нема — `bun add -d <pkg>`
(дописує devDependency і ставить). Для first-party пакетів з `KNOWN_PLUGIN_RANGES` версія
обмежується сумісним range (`<pkg>@^<major>` або `@^<major>.<minor>` для `0.x`); сторонні
пакети встановлюються без обмеження, bun сам резолвить latest. Фейл — warning + false, без
винятку.
- resolvePlugins — Повний резолв плагінів проєкту (з кешем на процес).
  лише вже встановлені пакети, без `bun add`; `quiet` — без warning-ів (hook на кожен файл)
- getUnavailableDeclaredPlugins — Задекларовані у `config.plugins` пакети, недоступні в `node_modules` (не встановлені).
Не встановлює нічого (`allowInstall: false`) і не друкує — чистий предикат для
explicit CLI-діагностики (напр. doc-files: 0 кандидатів через невстановлений плагін),
яка сама вирішує, коли й де показати попередження. Автодетектовані (не задекларовані
явно) плагіни тут не враховуються — сигнал стосується саме явного `.n-rules.json`.
- clearPluginResolveCache — Скидає кеш резолву (для тестів).

## Сценарії використання

- `npm/scripts/lib/tests/resolve-plugins.test.mjs` (detectPluginsFromRepo; pluginCategory) — .github/workflows з yml → ci-github; azure-pipelines.yml → ci-azure; обидва файлові сигнали → обидва плагіни; порожній .github/workflows → fallback на repository.url (dev.azure.com); repository як string з github.com → ci-github (+ lang-js за package.json); ще 35

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
- Кешує результати в межах одного прогону.
- Свідомо пропускає шляхи: `.github`, `.git`, `node_modules`.
