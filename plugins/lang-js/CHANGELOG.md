# Changelog

## [0.32.0] - 2026-08-29

### Changed

- T0-фікс `js/eslint` переїхав у wasm-гостя — перший споживач поверхні `fix-only-concerns` контракту `n-rules:plugin@4.0.0`. Детект концерну лишається JS (`main.mjs`) і жодним чином не змінюється: він стоїть на programmatic API `eslint` і на LLM-контурі `agent-fix`, у гість не їде. Доти такий поділ був неможливий — будь-який ключ у `concerns` вмикає detect-шедоуїнг, тобто «оголосити концерн заради фіксу» означало мовчки вимкнути його детект.

Портовано ОБИДВА патерни канону (`js-eslint-autofix` і `js-eslint-mechanical-text-fix`), і це не педантизм: `guestFix` зупиняє `applyT0` на першому непорожньому плані гостя, тож частковий порт мовчки вимкнув би невіддану половину. Клас фіксера — exec-tool + host-diff: гість повертає порожній план, edits синтезує хост, діфаючи знімок глоба контрибуції до і після виклику.

**Порядок кроків свідомо перевернуто.** Канон робить `oxlint --fix` → `eslint --fix` → механічні заміни, причому останній крок читає файл із диска вже після лінтерів — і якщо рядки зсунулись, мовчки нічого не робить. Гість читати диск після спавну не може взагалі, тому механічні заміни рахуються з того самого знімка, на якому детектор порахував `data.line` (зсув неможливий за побудовою), лягають на диск першими через `tee`, а лінтери йдуть уже по виправленому коду. Тихий пропуск канону зник — це полагоджений дефект, а не скопійований. Другий полагоджений дефект: нерезолвний `bunx` більше не best-effort мовчання, а `error` із поясненням, який саме лінтер не відпрацював.

Заради цього кроку плагін декларує новий тул `path:tee` — перший, чий споживач фіксер, а не детектор. Альтернативи розглянуті явно: віддати механічну правку планом означало б, що план гостя переможе диск (`already_covered`) і анулює правки лінтерів на тому самому файлі; виключити такі файли зі спавну — відкласти їхній autofix у дорогий LLM-ладдер.

`fix-glob` не знадобився: скоуп фіксу тут задає дельта запиту, а не інший статичний глоб. Цілі спавну беруться з `diagnostics[].file`, як у канону, — навіть у повному прогоні фіксяться рівно ті файли, де детектор щось знайшов.

`fix-eslint.mjs` не видалено — лишається JS-fallback-ом (політика «спершу парність»).

Розмір гостя: 2 410 281 → 2 414 463 байти (+4 182, +0,17 %; 23,03 % бюджету 10 MiB).

Тести: `cargo test -p plugin-lang-js` — 462 passed; `cargo test -p rules-plugin-host --test plugin_lang_js` — 86 passed; `wasm-plugin-parity.test.mjs` — 312 passed (7 нових: шість — повний T0-цикл через реальний napi-міст, сьомий — доказ, що detect не зашедоуєно, з контрольним твердженням на концерні, який шедоуїться). Деталі — §2.86 `docs/plans/2026-08-05-open-questions-register.md`.

## [0.31.0] - 2026-08-29

### Changed

- Пʼять концернів плагіна переїхали у wasm-гостя: `style/vscode_settings`, `js/jscpd_config`, `npm-module/emit_types_config` (детект — rego через host-import `rego-engine`, фікс — спільний двигун `rules-template-merge`, по одному запису в наявних таблицях `POLICY_CONFIGS`/`TEMPLATE_FIX_CONFIGS`), `js-run/jsconfig` (власний рушій фіксу, причина нижче) і `style/tooling` (детект переїхав батчем 8 — тепер і три FS-патерни фіксу). Родину `vscode_*`/`zed_settings` закрито повністю: `style/vscode_settings` був останнім із 15.

**`js-run/jsconfig` — перший `files.walkGlob`-концерн гостя.** Через нього `PolicyCfg` дістав форму `PolicyFiles` (`Single { target, missing_message }` | `WalkGlob { globs, basename }`), а `detect_policy` став багатофайловим: кожен `jsconfig.json` дерева міряється окремо й несе свій `file`. Фікс у нього ВЛАСНИЙ, не `createTemplateFixPattern`: `.rego` порівнює top-level масиви як множини на РІВНІСТЬ, а спільний двигун мерджить масиви union-ом — зайвий `include`-елемент пережив би фікс, детект лишався б червоним назавжди, а `--fix` щоразу звітував би «виправлено».

**Полагоджено три дефекти канону, а не відтворено.**
1. `js/jscpd_config`: rego вимагає `minLines >= 25`, а deep-merge писав точну рівність — будь-яке інше порушення концерну мовчки збивало вже суворіший `minLines: 40` до `25`. Механізм порогових листків узагальнено (`MinVersionLeaf` → `MinLeaf` з `kind: SemverRange | Number`) і покрив обидва випадки — версійний і числовий.
2. `js-run/jsconfig`: JSONC-вхід (легальні для VS Code `//`-коментарі) валив `JSON.parse` канону, і фікс мовчки робив `continue` — «спрацював», нічого не змінивши.
3. `style/tooling`: детект вважає `"stylelint"` наявним лише як `Object | Array`, фікс виходив на будь-якому truthy — на рядковому значенні концерн не сходився ніколи. Гейт у порті — той самий предикат, що в детекті; `package.json` при цьому не регенерується цілком, а правиться хірургічно.

**`test/stryker_config` НЕ портовано — і це відповідь, не пропуск.** Увесь його T0 тримається на повторному прогоні `planStrykerActions(cwd)`, а `FixRequest::files` хост будує з `file`-полів переданих violations; full-scope fallback спрацьовує лише коли ЖОДНА діагностика не назвала файл, а `stryker-config-missing` свій файл несе. Гість дістав би батч із самих відсутніх таргетів і не побачив би дерева, з якого будується план. Оголосити концерн лише заради fix не можна — ключ у реєстрі гостя затінює JS-гілку детекту й вимкнув би єдиний робочий автофікс. Розблокування — задача на host-міст.

Розмір гостя: 2 392 755 → 2 406 564 байти (+13 809, +0,58 %; 22,95 % бюджету 10 MiB).

Тести: `cargo test -p plugin-lang-js` — 462 passed (14 нових; прогін regorus тепер покриває ВСІ десять вшитих політик, а не шість); `cargo test -p rules-plugin-host --test plugin_lang_js` — 86 passed; `wasm-plugin-parity.test.mjs` — 305 passed (13 нових). Деталі — §2.80 `docs/plans/2026-08-05-open-questions-register.md`. JS-канони не видалено (політика «спершу парність»).

## [0.30.0] - 2026-08-29

### Changed

- Шість концернів плагіна переїхали у wasm-гостя цілком — і детект, і T0-фікс: `js/vscode_extensions`, `style/vscode_extensions` (рушій `vscode-ext-add`) та чотири `package_json` — `js/package_json`, `npm-module/npm_package_json`, `npm-module/root_package_json`, `style/package_json` (рушій `createTemplateFixPattern`). `bun/package_json` свідомо не чіпано: інший клас (deny-мапа, видалення, cross-file переписування репозиторію).

Детект цих шести більше не спавнить `conftest` — ті самі `.rego`-політики рахує `regorus` у ХОСТІ через imported resource `rego-engine` (§2.66). Джерело правди лишається Rego: політики й snippet-и вшиті `include_str!` напряму з `plugins/lang-js/rules/...`, без копії в крейті.

**Знайдено третю пастку `regorus`.** `npm_package_json.rego` мав безтілий факт `valid_types_field("./types/index.d.ts")` — легальний для Go-шного `conftest`, але HARD-помилка КОМПІЛЯЦІЇ під `regorus` («rule must have a body or assignment»). Той самий клас, що `%q` (§2.68/§2.76) і відсутній builtin `walk` (§2.69): роками безпечно, червоне рівно в день порту. Виправлено явною формою `valid_types_field(t) if t == "..."` — семантика під обома двигунами тотожна.

**Полагоджено дефект канону `js/package_json`, а не відтворено.** Rego вимагає `@nitra/eslint-config` **≥ порогу** зі snippet-а, а `createTemplateFixPattern` мерджив цей лист ТОЧНОЮ рівністю — тобто будь-яке порушення концерну (напр. `type` чи `engines.node`) запускало merge, який мовчки збивав уже коректний `^3.20.0` назад на `^3.10.0`. Тепер такий листок оголошений МІНІМУМОМ: фактична версія, що вже задовольняє поріг (включно з `workspace:`-протоколом), лишається на місці; нижча — підтягується до канону. Видима зміна поведінки — свідома і на краще.

Прибрано дрейф у `.rego`: мертве правило `js/package_json.rego`, що ітерувало неіснуючий `data.template.snippet.scripts` (разом із хелпером `normalize_script` і відповідним рядком `package_json.mdc`); коментарі «FS-перевірки лишаються у JS» у всіх пʼятьох `*/package_json` (описували `main.mjs`, якого в них немає); обіцянка неіснуючого слота `template.contains` у `style/package_json.rego`; назва rego-пакета `js_lint.package_json` → `js.package_json` у `.mdc`.

Розмір гостя: 2 270 584 → 2 392 755 байт (+5,38 %, 22,82 % бюджету 10 MiB). Сам rego-двигун коштував **3 574 байти** — це bindings imported resource, а не `regorus`: двигун живе в хості й у wasm32-граф не резолвиться взагалі.

Тести: `cargo test -p plugin-lang-js` — 447 passed (26 нових, серед них прогін усіх шести політик під `regorus` — гейт КЛАСУ пасток, не одного верба); `conftest verify` по всіх шести теках — зелено. Деталі — §2.78 `docs/plans/2026-08-05-open-questions-register.md`. JS-канони не видалено (політика «спершу парність»).

## [0.29.1] - 2026-08-29

### Changed

- `%q` прибрано з усіх rego-політик плагіна: 16 входжень у 15 рядках десяти файлів (`js-run/configmap`, `js/vscode_extensions`, `js/package_json` ×3, `vue/package_json` ×2, `style/vscode_extensions`, `style/package_json`, `bun/bunfig`, `npm-module/npm_package_json` ×3, `npm-module/root_package_json`, `js-mssql/package_json`). Заміна — та сама, що §2.66/§2.69: `%q` → `\"%v\"`.

Видимий текст жодного повідомлення НЕ змінився: для рядкового аргументу Go's `sprintf("%q", s)` дає рівно `"` + s + `"`. Перевірено не з памʼяті, а прогоном обох форм на одному вході через `conftest` — байт-у-байт однаковий рядок. Усі аргументи цих `sprintf` — рядки (звірено з `template/*.snippet.*` кожного концерну), тож випадку, де `%q` і `%v` розійшлися б (числа, булеві), тут немає.

Це передумова, а не косметика: `regorus` не підтримує `%q` і падає HARD RUNTIME ERROR. Маршрут порту родини `package_json` іде через підключення host-import `rego-engine` до гостя `plugin-lang-js` — у той момент кожне з цих 16 входжень стало б рантайм-помилкою. Прибрано ДО того (розділ 2 `docs/plans/2026-08-29-js-rust-migration-completion-plan.md`).

Повернення пастки стереже гейт `npm/tests/rego-regorus-verbs.test.mjs` — `lang-js` внесено в його перелік `REGORUS_POLICY_PLUGINS` цією ж зміною.

Тести: `conftest verify --policy plugins/lang-js/rules` — 133 passed, 0 failures (без змін у `*_test.rego`). Деталі — §2.76 `docs/plans/2026-08-05-open-questions-register.md`.

## [0.29.0] - 2026-08-29

### Changed

- T0-фіксери `style/lint` і `bun/licensee` портовано у wasm-гість `plugin-lang-js` (клас exec-tool, механіка host-diff §2.64). JS-канони (`fix-lint.mjs`, `fix-licensee.mjs`) ЛИШАЮТЬСЯ чинними — політика «спершу парність».

`style/lint` — перший exec-tool фікс цього гостя: гість спавнить `stylelint --fix`, edits синтезує хост, діфаючи знімок глоба концерну до/після `fix()`. Контрибуцію повернуто з `full` на `per-file` (дослівно `concern.json`): `full` на fix-боці ІГНОРУЄ дельту запиту, тобто дельта-прогін ганяв би `stylelint --fix` по всьому репозиторію й переписував файли поза дельтою. Дефект канону полагоджено, а не скопійовано: відсутній `stylelint` більше не тихий no-op, а `error` із причиною.

`bun/licensee` — усі три патерни; план ПОВНІСТЮ декларативний, exec-tool у фіксі не потрібен взагалі. Глоб контрибуції розширено `**/package.json` (патерн `bun-licensee-workspace-license-metadata` мусить бачити `package.json` власного пакета). Патерн `bun-licensee-config-init` більше не спавнить `bun x licensee --init`: вивід `--init` статичний (виміряно), тож гість пише канонічну policy декларативно — мережевий крок зникає з fix-контуру, а канонічний SPDX-allowlist доливається в тому самому проході (через host-diff це було б неможливо: гість не читає диск після спавна). Дефект канону полагоджено: `.licensee.json`, чий корінь не JSON-обʼєкт, більше не валить fix-прогін TypeError-ом.

`js/eslint` НЕ портовано — знайдено структурну перешкоду: контракт не має способу задекларувати концерн ЛИШЕ для `fix` (декларація в `describe().concerns` вмикає й detect-шедоуїнг `main.mjs`), а detect цього концерну — «вічний JS» за рішенням Є спеки. Потрібна additive-поверхня «fix-only контрибуція» — окреме рішення, §2.73 реєстру.

Розмір гостя: 2 263 690 → 2 270 584 Б (+0,30 %), 21,7 % бюджету 10 MiB.

Тести: `cargo test -p plugin-lang-js --lib` — 417 passed. `cargo test -p rules-plugin-host --test plugin_lang_js` — 86 passed. `wasm-plugin-parity.test.mjs` — 276 passed (девʼять нових: чотири на `style/lint` через реальний napi-міст із host-diff, пʼять на `bun/licensee`, з них три — байт-у-байт звірка з живим JS-каноном).

## [0.28.2] - 2026-08-28

### Changed

- chore(release): синк пінів платформних napi-пакетів @7n/rules

## [0.28.1] - 2026-08-28

### Changed

- fix(rules-napi): порожній fix-батч не-full-scope концерну — гучна помилка (#517)

## [0.28.0] - 2026-08-27

### Changed

- `js.package_json`: мінімальна підтримувана версія `engines.bun` піднята з `>=1.3` до `>=1.4` (native/wasm-детектор `crates/plugin-lang-js` і паралельний rego-гейт `js.package_json`) — раніше валідний поріг `>=1.3` тепер порушення, повідомлення й канон `package_json.mdc` оновлені відповідно

## [0.27.1] - 2026-08-26

### Fixed

- test/no-process-chdir: детект перевели з порядкового regex на AST (oxc_parser) — згадка process.chdir(…) у коментарі, JSDoc чи рядковому/шаблонному літералі більше не порушення (цитата самого правила у доккоментарі валила lint на будь-якому дереві, а автофікс «лагодив» це переписуванням прози); виклик у коді ловиться як раніше, плюс process['chdir'](…) і process?.chdir(…); непарсовний файл не мовчить — для нього лишається regex-фолбек

## [0.27.0] - 2026-08-23

### Removed

- прибрано JS-детектори кластера style/vue/bun (admin_table, gap, lint, quasar_fixes, tooling, packages, tfm-translations, layout, licensee) — логіка вже в crates/plugin-lang-js (wasm); T0-фіксери лишаються JS
- Прибрано JS-фолбек кластера js/*, npm-module/*, js-run/runtime, js-bun-redis/imports, js-mssql/deps, js-bun-db/safety, js/jscpd_duplicates (main.mjs + lib-сканери) — wasm/native Rust-порт canonical, T0-фіксери лишились у JS
- test/*-кластер (15 концернів): видалено JS lint-детектори (main.mjs), покриття перенесено в wasm-плагін crates/plugin-lang-js; T0-фіксери й спільні AST/утиліти лишаються JS-каноном

## [0.26.3] - 2026-08-23

### Changed

- sandbox-aware-test.mdc: приклад-посилання оновлено на актуальний шлях тесту після видалення npm/rules/text/run-shellcheck/main.mjs

## [0.26.2] - 2026-08-08

### Fixed

- `test/no-relative-fs-path` більше не лається на ціль symlink: у
`symlink()`/`symlinkSync()` перевіряється лише 2-й аргумент (шлях самого
посилання на диску), бо 1-й — це ціль посилання, тобто рядок, який
запишеться всередину symlink-а, і відносне значення там легітимне
(`../real.txt`). Для `link`/`copyFile`/`rename`/`cp` обидва аргументи
лишаються під перевіркою — там це справжні шляхи.

## [0.26.1] - 2026-08-05

### Changed

- `js/doc_comments`: shebang (`#!…`) більше не рахується коментарем. napi-`oxc-parser` віддає його як звичайний `Line`-коментар, через що виконуваний файл із коректним header-JSDoc після shebang-а звітував `missing-file-header`, а сам shebang ставав `promotable`-блоком — T0 підвищив би `#!…` до doc-коментаря й зламав запуск. Намір канону тут був однозначний ще раніше (`SHEBANG_RE` уже виключав shebang із «коду перед header-ом»), тепер він поширений і на список коментарів. **Спостережувана зміна:** файли з shebang-ом і header-JSDoc перестають давати `missing-file-header`. Плюс T0-фікс `fix-doc_comments.mjs` став ідемпотентним — підвищується лише зріз, кожен рядок якого досі починається з `//`, тож несвіжі офсети (файл уже змінив інший T0-патерн того самого концерну) роблять прохід no-op замість того, щоб різати вже підвищений `/** … */`
- Гейт правила `npm-module` переїхав з виконуваного `npm-module/applies/main.mjs` у декларативне поле `main.json:applies` (`any` з двох `pathExists` і `jsonFieldContains` по `package.json:workspaces`). Умова застосовності не змінилась — правило вмикається за каталогом `npm/`, workflow `npm-publish.yml` або workspace `npm`; каталог `npm-module/applies/` видалено цілком (він містив лише гейт, не концерн).

## [0.26.0] - 2026-08-03

### Fixed

- js/check: `knip.json` більше НЕ створюється мовчки під час `lint` — відсутність файлу стала спостережуваним порушенням `knip-missing`, яке детерміновано знімає T0 (`npx @7n/rules fix`). До цієї зміни детектор писав на диск у фазі detect і звітував `pass`: `lint --no-fix` мутував дерево, а порушення не існувало взагалі. Репозиторії без `knip.json` побачать нове порушення на першому ж прогоні

## [0.25.4] - 2026-08-01

### Changed

- T0-фікс `test/no-bun-test-import` портовано у wasm-компонент plugin-lang-js через `export fix` (пілот fix-контуру contract v3) — `fix-no-bun-test-import.mjs` видалено, кейси збережено на dispatch/host/unit-рівнях

## [0.25.3] - 2026-07-30

### Changed

- release: @7n/rules@1.59.0, @7n/rules-ci-github@2.2.0, @7n/rules-lang-js@0.25.2, @7n/rules-lang-php@0.2.8, @7n/rules-lang-python@0.12.2, @7n/rules-lang-rust@0.15.2; fix(plugins): audit follow-ups — php vscode extensions, llm-lib peers, lint-style vue patch (#307)

## [0.25.2] - 2026-07-30

### Added

- Додано `ci.artifact`-слот `js-lint-style-patch` — patch-existing доповнення `**/*.vue` у `paths` `.github/workflows/lint-style.yml` (той самий патерн, що `js-lint-text-patch`).

## [0.25.1] - 2026-07-30

### Fixed

- Уніфіковано LLM model resolution у execution consumers та оновлено native addon для env-selector policy.

## [0.25.0] - 2026-07-30

### Added

- Додано fail-closed JS і Vue knowledge extractor

### Fixed

- knowledge tests: використовують canonical `doc-files/package_knowledge` core path після злиття CI4.

## [0.24.3] - 2026-07-29

### Changed

- release: @7n/llm-lib@2.13.3, @7n/rules-lang-js@0.24.2, @7n/rules@1.57.4; fix(js/eslint): guard identity tagged-template tags from LLM autofix (#293)

## [0.24.2] - 2026-07-29

### Fixed

- js/eslint fix-worker: захист gql/sql tagged-template тегів від видалення LLM-автофіксом

## [0.24.1] - 2026-07-29

### Changed

- Coverage test generator використовує universal model resolver і приймає
інжектовану model policy для герметичних тестів.

## [0.24.0] - 2026-07-29

### Changed

- `assessNeed` (LLM-довизначення потреби в тестах, coverage-provider) переведено на `submitBatch`-хвилю: усі неоднозначні файли одним викликом на tier1, з ескалацією на tier2 замість конкурентного `Promise.all` окремих one-shot-викликів (спека `docs/specs/2026-07-27-batch-local-avg-real-batches.md`)

## [0.23.10] - 2026-07-29

### Fixed

- Тести fix-eslint: усунено lint-порушення (no-empty-function, no-useless-undefined, точковий disable для динамічного import у tmpdir)

## [0.23.9] - 2026-07-29

### Changed

- feat(llm-lib): v0.2.3 — pi-тіри на локальні моделі (оновлене рішення З.1)

## [0.23.8] - 2026-07-29

### Changed

- Використовує diffManifestDeps для порівняння залежностей у package.json

### Fixed

- дозволено локальні Oxlint jsPlugins

## [0.23.7] - 2026-07-29

### Added

- lang-js: patch-existing contribution для JS-globs у lint-text.yml (ci.artifact@1)
- Own JS CI-артефакти (lint-js.yml, azure lint-степ) через ci.artifact@1 contributions (точний повтор PHP-патерну)

### Fixed

- безпечний nullable guard у JS lint fix pipeline

## [0.23.6] - 2026-07-29

### Changed

- release: @7n/rules@1.55.0, @7n/rules-lang-js@0.23.5; docs: fix skill/rule examples suggesting bare `bun test` (#272)

## [0.23.5] - 2026-07-29

### Fixed

- npm: skill/rule docs — замінено приклади голого 'bun test' на 'bun run test' (npm/package.json#scripts.test = vitest run; bare bun test обходить це й ганяє несумісний нативний Bun test runner)

## [0.23.4] - 2026-07-29

### Changed

- fix(ci): resolve repository lint findings

## [0.23.3] - 2026-07-28

### Changed

- release: @7n/llm-lib@2.10.1, @7n/rules@1.52.1, @7n/rules-lang-js@0.23.1
- Механічно додано change-файл для поточних змін у workspace.

### Fixed

- `js/eslint` (`main.mjs`, `fix-eslint.mjs`) резолвить `bunx` через `resolveCmd` (абсолютний шлях) замість літерала — вкладений `spawn('bunx', …)` падав `ENOENT` на self-hosted CI, коли зовнішній `n-rules` викликаний напряму (`bun bin/n-rules.js`), а не через `bun x n-rules`.

## [0.23.2] - 2026-07-27

### Fixed

- peerDependency @7n/rules піднято до >=1.52.0 — перша core-версія з universal slot bus (plugin API v2)

## [0.23.1] - 2026-07-27

### Fixed

- `runtime-probe`: probe-скрипт передається дочірньому node файлом замість stdin (`--input-type=module` + `input`) — під `bun run --bun` `node` у PATH є bun-shim, який не виконує скрипт зі stdin, і всі probe поверталися `{}`

## [0.23.0] - 2026-07-27

### Changed

- Перехід на slot-based конфігурацію для плагіна lang-js

## [0.22.22] - 2026-07-27

### Fixed

- normalize licensee allowlist and workspace license metadata
- js-bun-db/bun-sql-scan: переформулювання у docs/bun-sql-scan.md для проходження cspell (repo-wide text-lint fix)

## [0.22.21] - 2026-07-27

### Fixed

- дзеркало .cursor/rules/n-vue.mdc регенеровано з канону правила vue: дописка про дозволені runtime-імпорти з vue у тест-файлах (#237) не потрапила у дзеркало

## [0.22.20] - 2026-07-27

### Changed

- fix(llm-lib): align native addon packages (#228)

## [0.22.19] - 2026-07-27

### Fixed

- republish the utils-imports reports exclusion skipped by a concurrent release

## [0.22.18] - 2026-07-27

### Changed

- release: @7n/rules-lang-js@0.22.17; fix(js): skip generated reports in utils scan (#238); fix(vue): allow Vue imports in test files (#237)

## [0.22.17] - 2026-07-27

### Fixed

- vue/packages: allow explicit Vue runtime imports in test files outside Vite auto-import
- js/utils-imports: skip generated reports directories such as Stryker sandboxes

## [0.22.16] - 2026-07-27

### Fixed

- Preserve independently verified coverage test batches through concern rollback

## [0.22.15] - 2026-07-27

### Fixed

- Обмежено npm-module репозиторіями з npm publisher topology

## [0.22.14] - 2026-07-27

### Fixed

- refresh canonical mutation results after generated coverage tests

## [0.22.13] - 2026-07-27

### Changed

- md

## [0.22.12] - 2026-07-27

### Fixed

- isolate Stryker cache for coverage batch verification

## [0.22.11] - 2026-07-26

### Added

- Додано постійне taze-виключення для підтверджених peer-перешкод major-оновлень

### Fixed

- verify generated coverage tests with Stryker

## [0.22.10] - 2026-07-26

### Changed

- Allow JSON text arrays before jsonb cast (#226)

## [0.22.9] - 2026-07-26

### Added

- Додано постійне taze-виключення для підтверджених peer-перешкод major-оновлень

## [0.22.8] - 2026-07-26

### Fixed

- Виправлено lint-сумісність coverage fixer та його тестів.

## [0.22.7] - 2026-07-26

### Fixed

- Додано окремий 180-секундний cloud budget для survived-mutant coverage batch і deferred решти batch-ів

## [0.22.6] - 2026-07-26

### Fixed

- Дроблено oversized source-file coverage mutants на ізольовані групи по 20.

## [0.22.5] - 2026-07-26

### Fixed

- Додано безпечну telemetry batch verdict для coverage timeout-ів.

## [0.22.4] - 2026-07-26

### Fixed

- Додано безпечну telemetry batch verdict для coverage timeout-ів.

## [0.22.3] - 2026-07-25

### Fixed

- Виправлено profile генерації тестів для survived Stryker-мутантів

## [0.22.2] - 2026-07-25

### Fixed

- Виправлено profile генерації тестів для survived Stryker-мутантів

## [0.22.1] - 2026-07-24

### Fixed

- lint --full: self-upgrade devDependency відкладено до ПІСЛЯ worktree-ізоляції, не забруднює дерево перед dirty-гейтом
- js/eslint detector: relative-шлях від oxlint резолвиться проти cwd перед відносним обчисленням — усуває '..'-шлях і DetectorError у --full поза .worktrees/

## [0.22.0] - 2026-07-24

### Added

- coverage-провайдер (порт js-collector з @7n/test): vitest+Stryker+Storybook колектор, per-file делта-вимір, quickClassify (spec 2026-07-22 absorb-7n-test)
- coverage: делта-гейт пропускає comment-only зміни (AST-порівняння oxc)

### Changed

- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header/export JSDoc у конфігах demo
- doc_comments rollout: header-JSDoc у vitest.config

## [0.21.0] - 2026-07-23

### Added

- coverage-провайдер (порт js-collector з @7n/test): vitest+Stryker+Storybook колектор, per-file делта-вимір, quickClassify (spec 2026-07-22 absorb-7n-test)
- coverage: делта-гейт пропускає comment-only зміни (AST-порівняння oxc)

### Changed

- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header/export JSDoc у конфігах demo
- doc_comments rollout: header-JSDoc у vitest.config

## [0.20.0] - 2026-07-23

### Added

- coverage-провайдер (порт js-collector з @7n/test): vitest+Stryker+Storybook колектор, per-file делта-вимір, quickClassify (spec 2026-07-22 absorb-7n-test)
- coverage: делта-гейт пропускає comment-only зміни (AST-порівняння oxc)

### Changed

- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header/export JSDoc у конфігах demo
- doc_comments rollout: header-JSDoc у vitest.config

## [0.19.0] - 2026-07-23

### Added

- coverage-провайдер (порт js-collector з @7n/test): vitest+Stryker+Storybook колектор, per-file делта-вимір, quickClassify (spec 2026-07-22 absorb-7n-test)

### Changed

- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header/export JSDoc у конфігах demo
- doc_comments rollout: header-JSDoc у vitest.config

## [0.18.0] - 2026-07-22

### Added

- coverage-провайдер (порт js-collector з @7n/test): vitest+Stryker+Storybook колектор, per-file делта-вимір, quickClassify (spec 2026-07-22 absorb-7n-test)

### Changed

- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header/export JSDoc у конфігах demo
- doc_comments rollout: header-JSDoc у vitest.config

## [0.17.0] - 2026-07-22

### Added

- storybook: новий concern `ci` (ADR Кластер 5, CI-частина) — канонічний composite action `setup-playwright-chromium` (кеш Playwright-браузерів, лише chromium) і `.github/workflows/lint-storybook.yml` (швидкий PR-прогін `vitest --project=storybook`), гейтований `requires.capability: ci:github`
- Хвиля 2a: підтримка app-проєктів у каноні Storybook — детекція за storybook.detectApps, окремий app-скафолд (.storybook/main.js без viteConfigPath-обходу, app-preview.js з pageLoader), smoke-покриття сторінок (page-coverage), adopt-діагностика app-секцій

### Fixed

- storybook: viteFinal-фільтр стійкий до VueMacros-стека (Promise/масив-резолв, сімейний фільтр vite:*/vue-macros), vitest@^4 provider-factory (@vitest/browser-playwright) замість застарілого рядка `'playwright'`, flat-root layout у detectStoriesGlob (components без src/), точковий alias-мок одного модуля в mocking.mdc, і STORIES_RE false positive на `storybookTest({ configDir })` без явного include — усе за результатами пілота adopt-діагностики на nitra/components. Заодно governance package_json.rego: allowlist доповнено `@vitest/browser-playwright`.
- canon Storybook: viteConfigPath-обхід (empty-vite.config.js), валідний iconSet-імпорт, mswLoader замість mswDecorator, повний .storybook/**-glob у CI/lint, вирівняні governance-піни (storybook ^10.5.3, root Vite build-tooling deps), knip-виключення для .storybook-артефактів
- storybook: скоуп-детекція більше не вимагає vite.config.* пакета (source-only Vue-бібліотеки, tauri-components/npm rollout) — hasStandardBuild прибрано, vitest-config fix толерує відсутній vite.config
- Правило `storybook`, хвиля 2a (app-проєкти) — виправлення за результатами живого пілота app-скафолда на `gt` (nitra/ai#234). (1) `.storybook/main.js` app-варіанту більше НЕ знімає `vite-plugin-pages` у `viteFinal` (`scaffold/template/app-main.js`, `APP_MAIN_JS_MARKERS`) — знімання ламало `storybook build` глобально: прототипні сторінки з `<route lang="yaml">`-блоком лишались без обробника, `@vitejs/plugin-vue` генерував import, який ніхто не обробляв далі, `MISSING_EXPORT` падав для всього пакета. (2) Storybook vitest-проєкт app-пакетів (`type: 'app'`) отримує ВЛАСНІ `quasar()`/`AutoImport()`/`Pages()`-плагіни замість успадкованого урізаного unit-конфіга — нові `vitest-config/template/app-storybook-project-entry.js` і `vitest.config.app.baseline.mjs`, type-aware вибір template-файлу в `fix-vitest-config.mjs` (`storybookEntryTemplateName`/`vitestConfigBaselineName`), нові маркер-перевірки `QUASAR_PLUGIN_RE`/`AUTO_IMPORT_PLUGIN_RE`/`VITE_PLUGIN_PAGES_RE` у `vitest-config/main.mjs` і дзеркальні в `adopt/main.mjs`. (3) `storybook/hygiene` (undeclared-import і sass-variables) тепер перевіряє лише `type: 'library'` пакети — на app-пакетах перевірка undeclared-import давала хибні спрацювання на Vite `resolve.alias`-специфікаторах (`components/Foo.vue` тощо), а sass-variables — на свідомо відсутньому `sassVariables`-маркері канонічного app-`main.js`. (4) Додано канонічний шаблон `.storybook/vitest.setup.js` (стандартний `@storybook/addon-vitest`-boilerplate, `setProjectAnnotations`/`beforeAll`) — раніше був відсутній, хоча `storybook-project-entry.js` уже посилався на нього як на `setupFiles`; тепер генерується й перевіряється `scaffold`-концерном (`VITEST_SETUP_JS_MARKERS`) для обох типів пакета, з adopt-діагностикою (`diagnoseVitestSetupJsSection`). (5) `npm/schemas/n-rules.json`: додано `storybook.detectApps`/`storybook.optOut` до кореневої схеми (окремий change-файл у `npm/`).

## [0.16.0] - 2026-07-22

### Changed

- маркери opt-in escape-hatch (allow-unsafe, allow-pg-leftover, checkEnv ignore-next-line) уніфіковано під префіксом n-rules: — hard cutover, без backward-compat зі старим форматом (@7n/rules ignore-next-line / @nitra/cursor ignore-next-line legacy теж прибрано)

## [0.15.0] - 2026-07-22

### Added

- js/doc_comments: рекомендовані вимоги до doc-коментарів (header-JSDoc файлу з експортами, JSDoc над кожним експортом) з T0-підвищенням суміжних //-коментарів до JSDoc — джерело дослівної доки doc-files

## [0.14.0] - 2026-07-22

### Added

- storybook: новий concern `ci` (ADR Кластер 5, CI-частина) — канонічний composite action `setup-playwright-chromium` (кеш Playwright-браузерів, лише chromium) і `.github/workflows/lint-storybook.yml` (швидкий PR-прогін `vitest --project=storybook`), гейтований `requires.capability: ci:github`
- Хвиля 2a: підтримка app-проєктів у каноні Storybook — детекція за storybook.detectApps, окремий app-скафолд (.storybook/main.js без viteConfigPath-обходу, app-preview.js з pageLoader), smoke-покриття сторінок (page-coverage), adopt-діагностика app-секцій

### Fixed

- storybook: viteFinal-фільтр стійкий до VueMacros-стека (Promise/масив-резолв, сімейний фільтр vite:*/vue-macros), vitest@^4 provider-factory (@vitest/browser-playwright) замість застарілого рядка `'playwright'`, flat-root layout у detectStoriesGlob (components без src/), точковий alias-мок одного модуля в mocking.mdc, і STORIES_RE false positive на `storybookTest({ configDir })` без явного include — усе за результатами пілота adopt-діагностики на nitra/components. Заодно governance package_json.rego: allowlist доповнено `@vitest/browser-playwright`.
- canon Storybook: viteConfigPath-обхід (empty-vite.config.js), валідний iconSet-імпорт, mswLoader замість mswDecorator, повний .storybook/**-glob у CI/lint, вирівняні governance-піни (storybook ^10.5.3, root Vite build-tooling deps), knip-виключення для .storybook-артефактів
- storybook: скоуп-детекція більше не вимагає vite.config.* пакета (source-only Vue-бібліотеки, tauri-components/npm rollout) — hasStandardBuild прибрано, vitest-config fix толерує відсутній vite.config

## [0.13.0] - 2026-07-21

### Added

- storybook: новий concern `ci` (ADR Кластер 5, CI-частина) — канонічний composite action `setup-playwright-chromium` (кеш Playwright-браузерів, лише chromium) і `.github/workflows/lint-storybook.yml` (швидкий PR-прогін `vitest --project=storybook`), гейтований `requires.capability: ci:github`

### Fixed

- storybook: viteFinal-фільтр стійкий до VueMacros-стека (Promise/масив-резолв, сімейний фільтр vite:*/vue-macros), vitest@^4 provider-factory (@vitest/browser-playwright) замість застарілого рядка `'playwright'`, flat-root layout у detectStoriesGlob (components без src/), точковий alias-мок одного модуля в mocking.mdc, і STORIES_RE false positive на `storybookTest({ configDir })` без явного include — усе за результатами пілота adopt-діагностики на nitra/components. Заодно governance package_json.rego: allowlist доповнено `@vitest/browser-playwright`.
- canon Storybook: viteConfigPath-обхід (empty-vite.config.js), валідний iconSet-імпорт, mswLoader замість mswDecorator, повний .storybook/**-glob у CI/lint, вирівняні governance-піни (storybook ^10.5.3, root Vite build-tooling deps), knip-виключення для .storybook-артефактів
- storybook: скоуп-детекція більше не вимагає vite.config.* пакета (source-only Vue-бібліотеки, tauri-components/npm rollout) — hasStandardBuild прибрано, vitest-config fix толерує відсутній vite.config

## [0.12.0] - 2026-07-21

### Added

- storybook: новий concern `ci` (ADR Кластер 5, CI-частина) — канонічний composite action `setup-playwright-chromium` (кеш Playwright-браузерів, лише chromium) і `.github/workflows/lint-storybook.yml` (швидкий PR-прогін `vitest --project=storybook`), гейтований `requires.capability: ci:github`

### Fixed

- storybook: viteFinal-фільтр стійкий до VueMacros-стека (Promise/масив-резолв, сімейний фільтр vite:*/vue-macros), vitest@^4 provider-factory (@vitest/browser-playwright) замість застарілого рядка `'playwright'`, flat-root layout у detectStoriesGlob (components без src/), точковий alias-мок одного модуля в mocking.mdc, і STORIES_RE false positive на `storybookTest({ configDir })` без явного include — усе за результатами пілота adopt-діагностики на nitra/components. Заодно governance package_json.rego: allowlist доповнено `@vitest/browser-playwright`.
- canon Storybook: viteConfigPath-обхід (empty-vite.config.js), валідний iconSet-імпорт, mswLoader замість mswDecorator, повний .storybook/**-glob у CI/lint, вирівняні governance-піни (storybook ^10.5.3, root Vite build-tooling deps), knip-виключення для .storybook-артефактів

## [0.11.0] - 2026-07-21

### Added

- storybook: новий concern `ci` (ADR Кластер 5, CI-частина) — канонічний composite action `setup-playwright-chromium` (кеш Playwright-браузерів, лише chromium) і `.github/workflows/lint-storybook.yml` (швидкий PR-прогін `vitest --project=storybook`), гейтований `requires.capability: ci:github`

### Fixed

- storybook: viteFinal-фільтр стійкий до VueMacros-стека (Promise/масив-резолв, сімейний фільтр vite:*/vue-macros), vitest@^4 provider-factory (@vitest/browser-playwright) замість застарілого рядка `'playwright'`, flat-root layout у detectStoriesGlob (components без src/), точковий alias-мок одного модуля в mocking.mdc, і STORIES_RE false positive на `storybookTest({ configDir })` без явного include — усе за результатами пілота adopt-діагностики на nitra/components. Заодно governance package_json.rego: allowlist доповнено `@vitest/browser-playwright`.

## [0.10.0] - 2026-07-21

### Added

- storybook: канон Storybook хвилі 1 для Vue-компонентних бібліотек — детекція скоупу (isVueComponentLibraryPkg, поріг ≥3 .vue, opt-out), канонічний скафолд .storybook/main.js+preview.js+mocks/gql-sse.js, package.json#scripts.storybook (ADR канон-storybook-для-vue-компонентних-бібліотек)
- npm-module/bun: governance-виняток канону Storybook (кластер 7 ADR канон-storybook-для-vue-компонентних-бібліотек) — npm_package_json.rego дозволяє канонічні Storybook-devDeps (storybook, @storybook/vue3-vite, @storybook/vue3, msw, msw-storybook-addon) у npm/package.json із зафіксованою точною версією (deny на неканонічний пакет або неканонічну версію); bun/package_json.rego розширює root-only test peers на @vitest/browser + playwright (browser-mode provider для named vitest project "storybook", лише chromium) та @storybook/addon-vitest (storybookTest-плагін того самого vitest-конфіга) — Storybook-identity-пакети у корінь свідомо не додаються
- storybook: vitest-config-концерн хвилі 1 (ADR Кластер 5) — canonical test.projects unit+storybook (browser-mode, лише chromium, stories-glob) дописується поверх наявного vitest-конфіга, ізольований vitest.stryker.config генерується поруч (Stryker крашиться на browser-mode projects)
- storybook: концерни mocking (docs-only рецепти router/tfm/Apollo-MSW/Pinia/page-story) і hygiene (undeclared third-party imports у .vue, auto-detect sassVariables) — ADR Кластер 3/6

### Fixed

- storybook: підключено concern-и scope/scaffold/vitest-config до unified lint-рушія (lint-блок у concern.json — check:true без lint мовчки ігнорувався run-detectors.mjs), додано --adopt-режим (adopt/main.mjs) і скіл n-storybook

## [0.9.0] - 2026-07-20

### Added

- doc-files: Vue SFC-екстрактор (`.vue` через optional peer `vue/compiler-sfc`) — props/emits/exposed як псевдо-експорти, слоти з `@slot`-коментарів шаблону, юніти зі зміщеними у файл офсетами

### Fixed

- doc-files: JSDoc-атрибуція експортів/юнітів через реальні AST-коментарі парсера (не regex по сирому тексту) — усуває false positive, коли '/**'-подібний текст трапляється всередині // -коментаря чи рядкового літералу

## [0.8.0] - 2026-07-20

### Added

- doc-files: Vue SFC-екстрактор (`<script setup>`) — extractFactsVue/extractUnitsVue через optional peer vue/compiler-sfc; props/emits/expose/слоти як публічний контракт, юніти зі span-корекцією (ADR 260719-2155)

## [0.7.1] - 2026-07-20

### Fixed

- style/lint: stylelint — задекларована залежність плагіна (раніше резолвилась лише транзитивно у цьому монорепо через @nitra/stylelint-config); відсутність тула тепер дає видимий warn-diagnostic замість мовчазного no-op (незалежний консюмер бачив би 'зелений' style-лінт, який насправді нічого не перевіряв)

## [0.7.0] - 2026-07-19

### Added

- правило test з ядра: розміщення тест-файлів у tests/, ізоляція (no-process-chdir, no-relative-fs-path, no-console-store-restore, sandbox-aware-test, no-bun-test-import), канон vitest/stryker конфігів і vitest-api-конвенції — без cargo-mutants (він у правилі rust плагіна lang-rust)

## [0.6.0] - 2026-07-19

### Added

- правило style з ядра (stylelint-детектор css/scss/vue, тулінг-канон, quasar/admin-table/colors/gap-концерни) — фронтенд-сімʼя правил тепер повністю у плагіні

## [0.5.0] - 2026-07-19

### Added

- skipLocalTier для js-run/runtime: local-tier емпірично 0/14 успіхів (llm-trace.jsonl), cloud-tier — 3/6; ladder одразу стартує з cloud-min (ADR 260718-0754)

## [0.4.1] - 2026-07-19

### Fixed

- js/knip: вбудований ігнор unused-dependency на пакети екосистеми n-rules (@7n/rules і @7n/rules-* плагіни — їх ставить сам npx @7n/rules, код споживача не імпортує) + канон knip ignoreDependencies з тим самим патерном

## [0.4.0] - 2026-07-19

### Added

- JS-сімʼя lint-правил з ядра (фаза 5c spec lang-plugins-extraction): js, bun, vue, js-run, js-bun-db, js-bun-redis, js-mssql, npm-module, tool-surface — плагін тепер contributes.rules з власними залежностями інструментів (eslint, oxlint, knip, jscpd, oxc-parser, globby, ignore); спільні з рушієм хелпери (globToRegex, textHasBunSqlImport, contentForVueImportScan) імпортуються з ядра і ре-експортуються для сумісності API

## [0.3.1] - 2026-07-19

### Fixed

- extractors.test.mjs: імпорт з ../extractors.mjs замість неіснуючого ../main.mjs (хвіст перейменування фази 5b; knip unresolved)

## [0.3.0] - 2026-07-19

### Added

- doc-files-екстрактори JS-екосистеми (фаза 5b spec lang-plugins-extraction): маніфест декларує розширення js/mjs/ts/vue з OKF-типами (contributes.docFiles.extensions) і handler doc-files; extractFacts (факт-лист js/mjs/ts, .vue → whole-file) та extractUnits (oxc AST юніт-шар) переїхали з ядра — генерація док для JS-файлів тепер вмикається цим плагіном

### Fixed

- knip duplicates `jsProvider|default`: провайдер тепер експортується лише як default (як у lang-rust/lang-python), named-експорт `jsProvider` прибрано

## [0.2.0] - 2026-07-19

### Added

- Перший реліз: EcosystemProvider npm/bun для taze-оркестратора `@7n/rules` (extension-point `taze`, контракт `@7n/rules/plugin-api`) — фаза 5a spec lang-plugins-extraction: JS-екосистема стала таким самим плагіном, як Rust/Python, ядро — двигун без мовної специфіки. Бекап package.json воркспейсів, bump через `bunx taze -w -r latest` + `bun install`, детермінований `collectTazeDiff` (semver caret-класифікація), CLI `n-rules taze diff` — через handler плагіна. Автодетект — за кореневим `package.json`

All notable changes to this project will be documented in this file.
