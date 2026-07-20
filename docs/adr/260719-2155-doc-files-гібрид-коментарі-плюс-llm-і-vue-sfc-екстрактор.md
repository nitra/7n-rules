---
type: ADR
title: doc-files — гібрид «скриптовий рендер коментарів + LLM лише на прогалини» і Vue SFC-екстрактор
description: Перехід doc-files від повного LLM-перефразування до детермінованого рендера покритого JSDoc/rustdoc з LLM тільки для непокритих частин; першим кроком — Vue SFC-екстрактор у плагіні lang-js через vue/compiler-sfc як optional peer.
---

**Status:** Proposed
**Date:** 2026-07-19

## Context and Problem Statement

Конвеєр `doc-files` генерує файлову документацію локальною min-моделлю (~4b), проганяючи ВЕСЬ вміст файлу через LLM з інструкцією «переформулювати своїми словами» — навіть коли автор уже написав якісний JSDoc/rustdoc. Мовні екстрактори (фаза 5b spec lang-plugins-extraction) парсять коментарі у структуровані факти (`header`, `exports[].desc`, `@param`, `@returns`), але ці факти йдуть лише як сировина для LLM-переписування. Наслідки:

- локальна 4b-модель спотворює авторський текст (задокументовано: маркує write-модулі як read-only, рамблить; CRC-гейт неточність не ловить);
- токени витрачаються на перефраз того, що вже написано;
- стимул інвертований — якісний JSDoc не зменшує роботу моделі.

Окрема прогалина: `.vue` (SFC зі `<script setup>`) декларується розширенням у `plugins/lang-js` (`contributes.docFiles.extensions`), але `extractFacts` повертає для нього `unsupported: true` → файл іде whole-file шляхом `oneShotDoc` (один LLM-виклик на весь сирий SFC, без факт-листа, без скорера, `score: null`). Python — так само `unsupported` (плагін `lang-python` взагалі не має `doc-files/`-хендлера).

Референс-інструменти екосистем (JSDoc, TypeDoc, API Extractor, documentation.js; rustdoc + doctests; vue-docgen-api, vue-component-meta) — усі детерміновані рендерери: сигнатури з коду, описи дослівно з коментарів, нуль фабрикації. AI-гібриди (ai-docs, doc-comments-ai) викликають LLM лише для символів без коментарів.

## Considered Options

Архітектура генерації:

- Гібрид Stage 1-3: детермінований рендер покритого + gap-детект + LLM лише на прогалини.
- Статус-кво: повне LLM-переписування з critic/refine-петлями.
- Повністю детермінований рендер без LLM (як TypeDoc) — без синтетичних секцій «Поведінка»/«Огляд».

Vue-парсер:

- `vue/compiler-sfc` subpath-експорт пакета `vue` (уже hoisted у монорепо, версійно синхронний з Vue-проєктами).
- Окремий пакет `@vue/compiler-sfc` напряму.
- Regex-вирізання `<script setup>`-блоку без нової залежності.
- Типо-обізнані `vue-component-meta` / `vue-docgen-api`.

Тип залежності в `plugins/lang-js`:

- `peerDependencies` + `peerDependenciesMeta.optional: true` — компілятор резолвиться в runtime, без нього `.vue` лишається `unsupported`.
- Звичайна `dependency` — тягне Vue в усі consumer-проєкти, включно з не-Vue.

## Decision Outcome

Chosen option: «Гібрид Stage 1-3 + `vue/compiler-sfc` як optional peer у `plugins/lang-js`», because детермінований рендер прибирає спотворення авторського тексту й різко зменшує токени, LLM зберігає додану вартість лише там, де вона реальна (синтетичні секції, непокриті символи), а optional peer не нав'язує Vue-залежність не-Vue-проєктам і при відсутності пакета деградує до поточної поведінки, а не ламається.

### Stage 1 — скриптовий рендер (0 токенів, 0 галюцинацій)

Усе покрите коментарями рендериться шаблоном без LLM: header файлу → «Призначення/Огляд»-заготовка; JSDoc-описи експортів → «Публічний API» як `name — desc` дослівно; Rust `//!` → «Огляд», `///` → «Публічний API». Прецедент у кодовій базі вже є — захищена секція «Призначення» (Варіант B) read-only і не переписується моделлю.

### Stage 2 — gap-детект (0 токенів)

Детермінований прохід по факт-листу: експорти без `desc`/із заглушкою («опис.»), відсутній header, відсутня поведінкова секція. Аналог `eslint-plugin-jsdoc` (`require-description`) / компіляторного `missing_docs` у Rust.

### Stage 3 — LLM лише для прогалин

Модель викликається виключно на: (1) експорти/айтеми без опису; (2) синтетичні секції «Поведінка» (крос-функціональний наратив) і «Огляд» (роль файлу в системі), яких у коментарях немає за визначенням. AI-фрагменти маркуються наявним `degraded`-механізмом у frontmatter.

### Vue SFC-екстрактор (перший інкремент, у plugin-архітектурі)

- `plugins/lang-js/package.json`: `"peerDependencies": { "vue": "^3.0.0" }` + `peerDependenciesMeta.vue.optional: true`.
- `plugins/lang-js/doc-files/extractors.mjs`: top-level `await import('vue/compiler-sfc')` у try/catch — `extractFacts` лишається синхронною (ядро `docgen-gen` її не `await`-ить), а падіння імпорту (peer не встановлено) не валить handler-модуль цілком (інакше catch у `loadDocFilesExtractors` мовчки прибрав би і JS/TS-екстрактор).
- Новий `plugins/lang-js/doc-files/vue.mjs`: `parse()` → `descriptor.scriptSetup ?? descriptor.script`; переюз JS-хелперів (`extractFileHeader`, `extractExports`, `extractImports`, `extractMarkers`) над `scriptBlock.content`; props/emits/exposed з `compileScript().bindings` + JSDoc над `defineProps`/`defineEmits`/`defineExpose` → у `facts.exports`; `<!-- @slot -->` з template → `facts.slots`. Невалідний SFC чи відсутній script-блок → fallback `unsupported`, не краш батчу.
- `extractUnitsVue`: `extractUnitsJs` над `scriptBlock.content` з корекцією номерів рядків на `scriptBlock.loc.start.line` (SFC-компілятор рахує рядки відносно блоку, anchors/CRC мають вказувати на рядки файлу).
- Ядро (`npm/rules/doc-files/docgen-gen`, `docgen-prompts`) — без змін: диспетчер `unsupported ? oneShotDoc : orchestratedDoc` і секція «Публічний API» з `facts.exports` уже generic по мові.
- Тести — `plugins/lang-js/doc-files/tests/vue.test.mjs`: object-based і generic `defineProps<Props>()`, `defineEmits`, `defineExpose`, `@slot`, файл без `<script>`, header не протікає з `<template>`.

### Consequences

- Good, because нуль спотворень у покритій коментарями частині — авторський текст канонічний, копіюється дослівно.
- Good, because різко менше токенів на файл: LLM бачить лише непокриті символи й факти, не весь файл.
- Good, because правильний стимул — чим краще команда пише JSDoc/rustdoc, тим менше роботи LLM.
- Good, because `.vue` отримує повний orchestrated-шлях (факт-лист, anchors, скорер, degraded-ретрай) замість whole-file one-shot без оцінки якості.
- Good, because optional peer деградує граційно: без установленого `vue` поведінка ідентична поточній (`unsupported` → one-shot).
- Bad, because заборона «дослівних сигнатур» вимагає узгодження: у Stage 1 рендериться лише `name — desc`, тип props допустимий тільки як факт із `defineProps<Props>()`-декларації, не з генерації.
- Bad, because зростає число станів конвеєра (покрито/прогалина/unsupported) — складніші тести й скорер.
- Bad, because top-level await у handler-модулі — тонкий контракт: майбутній рефактор на статичний import мовчки зламає JS/TS-екстрактор у не-Vue-проєктах.
- Bad, because Python лишається поза обсягом (немає `doc-files/`-хендлера в `lang-python`) — гібрид покриє його лише після появи екстрактора.

## More Information

- Плагінна архітектура: `plugins/lang-js/doc-files/extractors.mjs` (диспетчер `extractFacts`, `.vue` у `extensions`), `plugins/lang-rust/doc-files/`, `npm/rules/doc-files/docgen-scan/lang-extensions.mjs` (маніфест-читання розширень, `loadDocFilesExtractors`), `npm/rules/doc-files/docgen-gen/main.mjs` (диспетчер `unsupported`/`orchestratedDoc`).
- `@vue/compiler-sfc@3.5.39` уже в корені `node_modules` (hoisted транзитивно з `demo/` і `npm/schemas/vendor/`) — але це чужа залежність, тому власна peer-декларація обовʼязкова.
- Порядок упровадження: (1) Vue-екстрактор (закриває найбільшу прогалину, не чіпає ядро), (2) Stage 1-2 рендер+gap-детект у ядрі, (3) Stage 3 — звуження LLM-промптів до прогалин.
- Повʼязані ADR: `260617-2125-okf-сумісний-frontmatter-і-директорійні-індекси-у-doc-files.md`; spec lang-plugins-extraction (фази 4-5b).
- Досліджені референси: JSDoc/TypeDoc/API Extractor/documentation.js, eslint-plugin-jsdoc, rustdoc JSON (`rustdoc-types`, nightly) / `syn` на stable, cargo-rdme, vue-docgen-api, vue-component-meta, ai-docs, doc-comments-ai.
