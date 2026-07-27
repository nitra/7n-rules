---
type: JS Module
title: plugin-slots.mjs
resource: npm/scripts/lib/plugin-slots.mjs
docgen:
  crc: 8634f51d
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 75
---

## Огляд

Universal typed slot bus для плагінів `@7n/rules` (spec
`2026-07-27-universal-plugin-slots-lang-php-extraction`, Фаза 1 — контракт і broker; Фаза 2 —
усі first-party core consumers переведені на нього, legacy `contributes`-шлях видалено).

Один плагін-маніфест (`package.json#n-rules`) може декларувати `slots.provides` (contributions —
immutable дані чи посилання на package-relative resource) і `slots.consumes` (consumers — які
версії слоту surface вміє матеріалізувати, і через який handler-модуль). Цей модуль:

- резолвить усі `requiresPluginApi === 2` плагіни (через наявний {@link resolvePlugins}) у один
  immutable граф contributions/consumers/diagnostics (`resolveSlotGraph`, СИНХРОННО — той самий
  hot-path-контракт, що мав ще legacy doc-files-розширення до Фази 2: hook на кожен файл не може
  платити за динамічний import);
- валідує envelope (slot/version/id regex, рівно один з resource/value, безпечність шляху —
  без абсолютних шляхів, `..`-сегментів і symlink escape за межі packageRoot);
- НІКОЛИ не читає вміст `resource` і не імпортує consumer-handler під час discovery — це
  принципово унеможливлює runtime-цикли contributions→contributions (рішення І spec, §2);
  імпорт відбувається лише в {@link loadSlotConsumer}, яку викликає сам surface, що знає, який
  slot він матеріалізує.

Плагін без `requiresPluginApi === 2` не потрапляє у граф — з Фази 2 це означає, що жодна
first-party поверхня (rules, taze, coverage, doc-files, skill-фрагменти) його НЕ бачить: warning
diagnostic, а не мовчазна деградація. Це не перехідний стан, а цільова поведінка §9.2.

## Публічний API

- resolveSlotGraph — Резолвить один immutable slot graph для проєкту — СИНХРОННО, один filesystem/plugin scan на
`(projectRoot, config, allowInstall)` (кешовано на процес, той самий ключ, що й
{@link resolvePlugins}). Hot-path-контракт: без await, без динамічного import — читає лише те,
що вже на диску (existsSync/realpathSync), ніколи не викликає consumer-handler.

Плагін без `requiresPluginApi === 2` НЕ входить у граф (§9.2) — з Фази 2 (legacy `contributes`
повністю видалено) це означає, що жодна first-party поверхня його не бачить: warning
diagnostic, а не мовчазна деградація до старого шляху.

Три послідовні проходи (винесені у {@link acceptPlugin}/{@link collectPluginContributions}/
{@link collectPluginConsumers}/{@link appendVersionMismatchDiagnostics} — інакше єдина функція
перевищує поріг когнітивної складності лінтера): (1) capabilities УСІХ наявних плагінів
— ПОВНІСТЮ, до валідації жодної contribution (інакше плагін A раніше у списку з
`requires.capabilities` на capability плагіна B, пізнішого у списку, хибно вважав би її
неактивною); (2) acceptance + envelope validation кожного плагіна; (3) version-mismatch
діагностика на вже повному наборі contributions/consumers.
- getSlotContributions — Contributions одного слоту, відфільтровані за підтримуваними версіями і активними
capabilities графа — capability-гейт застосовується ТУТ, тобто ДО того, як викликач прочитає
`resourcePath` (spec §12 acceptance: "capabilities застосовуються до contributions до
завантаження resource"). Синхронна — жодного I/O, лише фільтр вже готового графа.
- getSlotConsumers — Consumers одного слоту (без фільтра версій — викликач сам звіряє свій набір версій).
- resolveRulesDirs — Rules-каталоги для всіх поверхонь ядра (Фаза 2, spec §5.1.1/§5.1.4): ядро першим (його
правила/концерни виграють колізії), далі `rules.directory@1` contributions у порядку графа
(resolved plugin order → manifest order). Замінює legacy `resolveRulesDirs`
(`resolve-plugins.mjs`, видалено) — та сама сигнатура/форма результату, тепер повністю на
slot graph: плагін-contributor більше не мусить фізично мати `rules/` за конвенцією, лише
валідний `rules.directory@1` resource (будь-який безпечний package-relative шлях).
- getActiveCapabilities — Активні capabilities від усіх доступних плагінів (spec §5.1.11) — та сама сигнатура/семантика,
що legacy `getActiveCapabilities` (`resolve-plugins.mjs`, видалено), тепер живиться з
{@link resolveSlotGraph}: `graph.capabilities` уже агрегує capabilities УСІХ наявних плагінів
(не лише тих, що увійшли у slot graph — гейт `requiresPluginApi` тут не застосовний, capability
gate має лишатись коректним і під час поетапної Фази 2-міграції). Повертає ту саму (кешовану на
графі) мутабельну референцію `Set` — викликачі лише читають (`.has`), не мутують.
- loadSlotConsumer — ЄДИНЕ місце динамічного import consumer-handler-а (spec §3.4: "module import відбувається лише
в loadSlotConsumer()"). Викликається САМИМ surface-ом, коли він реально матеріалізує contributions
цього слоту — ніколи під час discovery (`resolveSlotGraph`). Перевіряє форму default-експорту
(§3.3): обʼєкт, стабільний `id`, функція `validate`.
- clearSlotResolveCache — Скидає кеш slot graph (для тестів).

## Сценарії використання

- `npm/scripts/lib/tests/plugin-slots.test.mjs` (resolveSlotGraph — sync-контракт і кеш; resolveSlotGraph — requiresPluginApi gate (§9.2)) — повертає звичайний обʼєкт синхронно, без Promise; повторний виклик з тими самими аргументами — та сама (кешована) референція; clearSlotResolveCache() скидає кеш — наступний виклик повертає нову референцію; граф заморожений (top-level) — Array.prototype.push на замороженому масиві кидає; плагін без requiresPluginApi не входить у граф — warning diagnostic, contributions ігноруються; ще 36

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Кешує результати в межах одного прогону.
