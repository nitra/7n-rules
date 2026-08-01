# Фаза 8 — інверсія entrypoint: мінідизайн і скелет `rules-cli` (зріз 1)

**Дата:** 2026-08-01
**Статус:** погоджено — зріз 1 реалізується цим самим PR
**Зв'язані документи:** `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`
(фаза 8 — «інверсія entrypoint: Rust CLI», рішення Р1–Р10),
`docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` (node-free plugin
host — передумова інверсії), `npm/bin/n-rules-cli.mjs` (чинний JS-роутер),
`npm/scripts/lib/native.mjs` (протокол JS → native, дзеркало якого тут
обертається), `docs/specs/2026-08-01-wasm-ast-strategy.md` (жанровий прецедент:
спайк → мінідизайн → батчі).

## 1. Мета

Стартувати фазу 8 спеки rules-v2: справжній Rust-бінар CLI (`crates/rules-cli`),
який із першого зрізу є **drop-in** заміною JS-entrypoint — кожна підкоманда
або виконується повністю нативно, або чесно делегується в чинний
`npm/bin/n-rules.js` із тим самим argv і exit-кодом. JS-шар лишається надовго
для LLM-контурів та інтерактивних флоу (роздiл 2 — інвентаризація), але
перестає бути обовʼязковою точкою входу: миграція йде покомандно, перелік
делегованих команд скорочується до нуля (фаза 8 спеки міграції).

## 2. Інвентаризація CLI-поверхні `n-rules`

Класи: **(а)** оркестрація в JS, але обчислювальне ядро вже native під капотом
(через `rules-napi`); **(б)** чистий JS, портовний у Rust без архітектурних
передумов; **(в)** JS назавжди/надовго — LLM-контури, агентні ранери,
інтерактив, plugin-слоти з JS-модулями.

| Команда | Що робить | Клас | Примітка для міграції |
|---|---|---|---|
| `(без підкоманди)` — sync | скаффолдинг `.cursor/`, `.claude/`, `CLAUDE.md`, `.n-rules.json`, `bun i`, npm self-upgrade | (б) | детермінований, але великий: мутації FS + мережа; пізній зріз |
| `lint` (+ legacy-аліаси `lint-ga`/`lint-text`/`lint-rego`/`lint-k8s`/`lint-docker`) | delta/full/scoped lint, fix-by-default | (а)+(в) | детект-контур уже native (buildPlan, batch builtin-концернів, sort/render/exit, wasm-плагіни — фази 5–7); JS лишає оркестрацію, T0/LLM-ladder fix, чергу `--full` |
| `lint --help` | статична довідка | (б) | **→ native у зрізі 1** (найдешевший parity-кейс реальної поверхні) |
| `hook --post-tool-use` / `--stop` | thin-обгортка над `detectAll` для Claude/Cursor/Codex hooks | (а) | успадковує стан `lint`; головний виграш інверсії — node-старт зникає з найчастішого виклику (зріз 4) |
| `ci plan` | read-only skip-логіка CI-канону | (б) | потребує портів `loadEnabledLintRules` (meta.json + конфіг) — зріз 3 |
| `rename-yaml-extensions` | перейменування k8s/GA yaml-розширень | (б) | дрібний, зріз 3 |
| `release` | version bump + CHANGELOG з `.changes/*` | (б) | детермінований; низький пріоритет (рідкий виклик, CI-only) |
| `taze` | semver-diff через слот `taze.provider@1` | (в) | контрибуції слота — JS-модулі плагінів; до wasm-слотів лишається JS |
| `skill list` | перелік скілів пакета | (б) | дрібний, зріз 3 |
| `skill taze\|git-reconcile`, `skill pi\|cursor\|codex <id>` | JS-оркестровані/агентні ранери скілів | (в) | LLM/агентний інтерактив |
| `adr-normalize-local` | локальний LLM-конвеєр ADR-нормалізації | (в) | LLM-контур |
| `docs domains\|build\|publish` | package knowledge (LLM projection) | (в) | LLM-контур |

Підсумок: 12 поверхонь; **(а)** — 2 (lint, hook: ядро native, оркестрація JS),
**(б)** — 6 портовних (sync, `lint --help`, ci plan, rename-yaml-extensions,
release, skill list), **(в)** — 4 JS-надовго (taze, skill-ранери,
adr-normalize-local, docs).

## 3. Рішення

- **А — bin-крейт `crates/rules-cli`.** Пакет `rules-cli`, бінар `rules-cli`
  (workspace member). Перейменування бінаря на `n-rules` — дистрибуційний зріз
  (розділ 5): поки npm-`bin` лишається JS-launcher-ом, однойменний бінар у
  PATH створював би плутанину.
- **Б — арг-парсинг вручну, без clap (поки що).** Фаза 8 спеки міграції
  згадує clap, але його немає в дереві залежностей (`Cargo.lock`), а чинний
  JS-роутер — плаский `switch` без DSL. Для зрізу 1 (роутер на match +
  2 нативні команди з трьома прапорцями) clap — нова залежність без потреби
  (канон dev-dep мінімалізму). Переглянути, коли нативних підкоманд/прапорців
  стане достатньо, щоб ручний парсинг почав дублювати логіку (орієнтовно
  зріз 3, разом із `ci plan`).
- **В — делегація JS-контурів: субпроцес із тим самим argv.** Непортовані
  команди виконуються як `bun <entry> <argv...>` (fallback `node`), stdio
  inherited, exit-код 1:1. Це дзеркало чинної межі в протилежний бік: сьогодні
  JS кличе native **in-process sync** (napi, бо викликачі — синхронні
  JS-фасади); native кличе JS **out-of-process argv-passthrough**, бо
  делегується цілісна команда верхнього рівня, а не функція — byte-exact
  поведінка за конструкцією, нуль нового протоколу. Альтернативи відхилено:
  embedded Node (лібнода/N-API у зворотному напрямку) — важка збірка й
  суперечить меті позбутись node-залежності; демон із JSON-RPC — постійний
  процес і новий протокол для транзитного шару, який має зникнути.
- **Г — резолюція JS-entrypoint (порядок, за зразком `native.mjs`):**
  1. `N_RULES_JS_ENTRY` — явний override (dev/CI/тести);
  2. вгору від cwd: `node_modules/@7n/rules/bin/n-rules.js` (consumer-репо);
  3. вгору від cwd: `npm/bin/n-rules.js`, якщо `npm/package.json` поруч
     оголошує `"name": "@7n/rules"` (dev-репо самого пакета);
  4. hard error з підказкою (без мовчазних fallback-ів — Р1-дисципліна).
  Runtime: `N_RULES_JS_RUNTIME` (тести) → `bun` (канон репо) → `node`
  (якщо bun відсутній у PATH).
- **Д — межа з napi: спільне живе лише в `rules-core`.** `rules-cli` і
  `rules-napi` — два паралельні тонкі споживачі одного ядра; CLI **не**
  викликає napi-шар і не дублює логіку ядра. Що з'являється CLI-специфічного
  (роутер, делегація, Rust-порт git-policy-читання) — живе в `rules-cli`;
  щойно те саме знадобиться napi-боку, переїжджає в `rules-core` (правило
  одного власника). Порт `readGitPolicy` у CLI — свідомий перший виняток
  із Р5 («конфіг-парсинг лишається в JS»): Р5 формулювався для межі
  JS→native, а фаза 8 цю межу обертає — у native-entrypoint конфіг більше
  нема кому читати, крім самого Rust; JS-фасад (`git-policy.mjs`) при цьому
  незмінний (Р6), parity гейтиться дзеркальним тестом.
- **Е — нативні команди зрізу 1.** Дві read-only команди повністю без JS:
  1. `lint --help` / `lint -h` — реальна чинна поверхня, вивід byte-exact
     із `printLintHelp` (parity-тест порівнює обидва CLI напряму);
  2. `changed-files [--cwd <dir>] [--delta] [--base <ref>]` — **нова
     plumbing-команда** поверх готових `rules_core::changed_files`/
     `changed_base`: без прапорців — робоче дерево vs HEAD
     (`collectChangedFiles`-семантика); `--delta` — merge-base за Git policy
     (порт розгортання `integrationBranches`) із fallback на робоче дерево,
     коли база не резолвиться (та сама fail-open поведінка, що в delta-lint);
     `--base <ref>` — явна база (fail-closed, недосяжний ref — помилка,
     семантика `collectChangedFilesSince`). Вивід — по шляху на рядок.
     JS-еквівалент для parity — фасади `changed-files.mjs` (не JS-CLI:
     такої підкоманди там немає і не буде — вона з'являється одразу
     native-first; до зрізу дистрибуції JS-CLI відповідає на неї «Невідома
     команда», це свідомо).
- **Ж — parity-гейт.** Vitest-тест (`npm/scripts/lib/tests/`, поруч із
  чинними `*-native-parity`-тестами) порівнює вихід бінаря byte-exact із
  JS-еквівалентом: `lint --help` — проти `bun npm/bin/n-rules.js lint
  --help`; `changed-files` (усі три режими) — проти фасадів
  `changed-files.mjs` на живій git-фікстурі. Бінар резолвиться
  `N_RULES_CLI_BIN` → `target/{release,debug}` (той самий каскад, що
  `native.mjs`), відсутність збірки — hard error із підказкою, не skip.

## 4. Архітектура зрізу 1

```text
rules-cli (bin, crates/rules-cli)
  ├─ роутер argv (плаский match, дзеркало switch у n-rules-cli.mjs)
  ├─ native-команди: lint --help · changed-files
  │     └─ rules-core (path dep): changed_files, changed_base
  ├─ git_policy — Rust-порт readGitPolicy (рішення Д)
  └─ js_fallback — резолюція entrypoint (рішення Г) + exec bun/node,
        stdio inherit, exit-код 1:1 (решта команд, включно з default sync)
```

`rules-napi` не зачіпається; JS-фасади незмінні (Р6). Жодних змін релізного
конвеєра і платформних пакетів у цьому зрізі (розділ 5).

## 5. Стратегія міграції по зрізах

1. **Зріз 1 (цей PR)** — скелет: роутер + делегація + `lint --help` +
   `changed-files`, parity-тести, workspace-CI (rules-cli збирається і
   тестується існуючими джобами; у `test.yml` бінар додається до
   cargo-build-кроку для parity-тесту).
2. **Зріз 2** — порт read-only plumbing без нових передумов:
   `skill list`, `rename-yaml-extensions`.
3. **Зріз 3** — конфіг/meta.json у Rust (`.n-rules.json`, `rules/<id>/meta.json`,
   discovery концернів через `rules-core`): розблоковує `ci plan`; ревізія
   рішення Б (clap).
4. **Зріз 4** — `lint --no-fix` (детект-контур) і `hook` повністю в
   `rules-cli` поверх `rules-core` + `rules-plugin-host` (plan → batch →
   sort/render/exit уже в ядрі); hook-виклик перестає платити за node-старт.
   Далі — fix-контур: T0/native fix plans нативно, LLM-ladder лишається
   делегованим (клас (в)).
5. **Зріз 5 — дистрибуція (окремий мінідизайн перед стартом):** платформні
   пакети `@7n/rules-<platform>` розширюються з cdylib на повний бінар (той
   самий lockstep-конвеєр `npm-publish.yml`); npm `bin` → launcher, що
   резолвить бінар з optionalDependencies (esbuild/biome-патерн); standalone
   бінарі в GitHub Releases; бінар перейменовується на `n-rules`; hook-и
   `.claude/settings.json` перемикаються на бінар. Разом з останнім виведеним
   JS-фасадом виводиться `rules-napi`; мажор `2.0.0` (збігається з виведенням
   Plugin API v2 і давно запланованим мажором платформної межі — Р1).

## 6. Сумісність

- **Drop-in із зрізу 1:** будь-який виклик `rules-cli <argv>` дає той самий
  вихід/exit-код, що `npx @7n/rules <argv>` — нативно або делегацією.
  Нова команда `changed-files` — єдине розширення поверхні (рішення Е).
- **PATH/npm:** до зрізу 5 бінар не потрапляє ні в npm-пакет, ні в PATH
  користувачів — це dev/CI-артефакт (`cargo build -p rules-cli`), ризик
  колізії імен відсутній.
- **Консюмер без bun:** делегація падає на `node` автоматично; без обох —
  hard error із підказкою (та сама Р1-дисципліна, що в native-loader).

## 7. Ризики

1. **Дрейф дубльованих текстів** (`lint --help`, git-policy-семантика):
   два джерела правди до відповідного зрізу. Мітигація — parity-тести
   byte-exact у делта-лінт-гейті; дрейф ламає тест, не користувача.
2. **Резолюція entrypoint у нестандартних layout** (pnpm-симлінки, глобальний
   npx-кеш): каскад Г може не знайти JS. Мітигація — `N_RULES_JS_ENTRY`
   override + чітка помилка; до зрізу 5 бінар — dev/CI-інструмент.
3. **Відмінності bun/node** у виводі делегованих команд: делегація сама по
   собі виводу не змінює, але консюмер міг очікувати конкретний runtime.
   Мітигація — порядок bun→node збігається з каноном репо; override-ем можна
   зафіксувати runtime.
4. **`changed-files` до стабілізації** — plumbing-поверхня може змінитись у
   зрізі 3 (наприклад, JSON-режим для CI). Мітигація — команда явно
   позначена plumbing у довідці; семвер-гарантій на неї до 2.0.0 немає.
5. **Cargo.lock-конфлікти** з паралельними wasm-батчами (спільний lock).
   Мітигація — зріз 1 не додає нових зовнішніх крейтів (лише workspace-члена),
   конфлікт зводиться до тривіального re-merge.
