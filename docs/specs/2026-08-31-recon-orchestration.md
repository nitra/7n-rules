# Розвідка: оркестраційний шар JS (`npm/bin/**`, `npm/scripts/*.mjs`, `npm/scripts/lib/**` поза `lint-surface`)

**Створено:** 2026-08-31. **Тип:** розвідка, не план. Коду не змінювано.

Одна з трьох паралельних розвідок залишку JS. Області двох інших
(`npm/scripts/lib/lint-surface/**`, а також `coverage-provider`/`npm/rules/**`/`skills/**`)
тут **не розбираються** — вони згадуються лише як споживачі або як межа.

## 0. Межі розвідки — що прочитано, а що ні

Цей розділ стоїть першим навмисно. Документ, чиї твердження пережили свою
підставу, дорожчий за документ із визнаною прогалиною.

**Прочитано повністю або майже:** `npm/bin/n-rules.js`, `npm/bin/n-rules-cli.mjs`
(структура + весь роутер `runCli`), `npm/bin/rename-yaml-extensions.mjs`,
`npm/scripts/cli-entry.mjs`, `crates/rules-cli/src/{main,cli,js_fallback}.rs`,
доккоментарі-межі `crates/rules-cli/src/{ci_cmd,hook_cmd,lint_cmd,bridge}.rs`,
`crates/rules-core/src/{tool_resolve,tool_registry,rule_applies,concern_meta,worktree}.rs`
(доккоментарі), §12 спеки `2026-08-01-rules-cli-phase8-skeleton.md`,
`docs/plans/2026-08-29-js-rust-migration-completion-plan.md`.

**Розібрано делегованими пробами (результат отримано):** родина резолву плагінів
(`resolve-plugins.mjs`, `plugin-slots.mjs`, `plugin-api.mjs`, `plugin-api/call-edges.mjs`,
`slot-contracts-ci.mjs`, `mirror-parity.mjs`); дрібні модулі `npm/scripts/lib/`;
усі 18 файлів `npm/scripts/*.mjs`; пари «JS ↔ завершений Rust-порт»
(`rule-applies`, `concern-meta`, `gha-workflow`, `adr/normalize-pipeline`,
`fix/template-deep-merge`, `template`, `changed-files`).

**НЕ розібрано (див. §8):** `native.mjs` (273), `ensure-tool.mjs` (592, прочитано лише
перелік експортів + межу з Rust-боку), `auto-worktree.mjs` (279),
`worktree-notice.mjs` (180), `root-notice.mjs` (67).
Для них нижче наводяться **лише** ті твердження, які доведені грепом (хто імпортує)
або цитатою з Rust-боку (чи є порт). Клас портовності для них **не присвоєно**,
крім випадків, де сама смерть файлу знімає питання.

**Обсяг області:** 13 568 рядків продуктивного JS —
`npm/scripts/lib/**` поза `lint-surface` і поза `tests/`: 50 файлів, 7 443 рядки;
`npm/scripts/*.mjs`: 18 файлів, 4 006 рядків; `npm/bin/**`: 3 файли, 2 119 рядків.

## 1. Головна структурна знахідка: Rust-CLI не є вхідною точкою — і ніколи нею не був у продукті

Це не деталь, а рамка, у якій треба читати всю решту документа.

- `npm/package.json:26-29` — `"bin": {"n-rules": "bin/n-rules.js", "n-cursor": "bin/n-rules.js"}`.
- `npm/bin/n-rules.js` — 8 рядків, які імпортують `runCli` з `./n-rules-cli.mjs` і викликають його.
- Платформні пакети `@7n/rules-{darwin-arm64,linux-x64,win32-x64}` (`npm/package.json:85-88`)
  містять **лише napi-аддон**: `npm/packages/rules-darwin-arm64/package.json:14-16` →
  `"files": ["rules-napi.darwin-arm64.node"]`. Бінаря `rules-cli` там немає.
- Бінар `rules-cli` збирається **тільки в CI** і **тільки заради тестів**:
  `.github/workflows/test.yml:53` (`cargo build --release -p rules-napi -p rules-cli`)
  і `:63` (`./target/release/rules-cli tools ensure kubeconform kubescape`).
  Жоден workflow його не публікує; GitHub Release із бінарем не існує.

Отже **весь native-роутинг `crates/rules-cli/src/main.rs` у консюмера не виконується
ніколи**. Кожен `npx @7n/rules …` — це JS-роутер `runCli`. Це прямо визнано в
`crates/rules-cli/src/main.rs:75-79`: `release` і дефолтний sync «портовні, але
`npm/package.json#bin` веде в JS-entrypoint, тож їхній native-шлях ніхто не виконував би
до bin-launcher-а (зріз 6)».

Наслідок для планування: **таблиця §2 описує готовність, а не чинну поведінку.**
Native-частина — це вже виконана робота, яка лежить у шухляді до зрізу 6.
Зворотний бік той самий: делегація `js_fallback.rs` — не борг, який хтось платить
щодня, а страховка, яка сьогодні не спрацьовує.

## 2. Таблиця команд: `crates/rules-cli/src/main.rs` ↔ `npm/bin/n-rules-cli.mjs`

JS-роутер: `switch (command)` на `npm/bin/n-rules-cli.mjs:1808`, кейси на
`:1809, 1817, 1826, 1963, 1973, 2001, 2007, 2012, 2021, 2028`, default `:2033`.
Rust-роутер: `run()`/`dispatch()` у `crates/rules-cli/src/main.rs:120-266`;
граматика — `crates/rules-cli/src/cli.rs:94-115`.

| Команда | JS (чинний виконавець) | Rust | Що заважає native-шляху |
|---|---|---|---|
| *(без аргументів)* — sync | `:2028` → `runSync` (`:1487`) | ❌ делегація (`main.rs:124`) | Не технічний блокер, а порядок: `main.rs:78-79` — `bin` веде в JS. Сам `runSync` — ~1 480 рядків скаффолдингу `.cursor/`/`.claude/`/`CLAUDE.md`/`AGENTS.md` + `sync-claude-config.mjs` (939) + `resolve-plugins`/`plugin-slots`. Порту немає. |
| `lint` | `:1826` (найбільший кейс, ~135 рядків) | 🟡 частково, **не за замовчуванням** (`lint_cmd.rs`) | Вмикається лише `--native-detect`/`N_RULES_NATIVE_LINT=1` (`lint_cmd.rs:78-80`). Сам відмовляється: без `--no-fix` (fix-пайплайн не портовано), з `--path` (`path-scope.mjs`), якщо план зачепив wasm-концерн (`lint_cmd.rs:31-37`). Резолв плагінів у будь-якому разі йде **через міст у node** (`lint_cmd.rs:14`). Не покрито: глобальна черга `--full`, worktree-ізоляція, progress-бар, self-upgrade (`:41-49`). |
| `lint --help` / `-h` | `:1770` → `printLintHelp` (`:1688`) | ✅ native | — (перехоплюється до `clap`, `main.rs:132-135`; байтова копія в `src/lint_help.txt`) |
| `hook` | `:1817` → `scripts/hook.mjs` | 🟡 частково | Native лише дві гілки: немає режиму, і `--post-tool-use`, зі stdin якого не дістається жодного шляху (`hook_cmd.rs:11-17`). Решта делегується: обидві кінчаються `detectAll`, а це виконувані `main.mjs` концернів + `resolveRulesDirs` (`hook_cmd.rs:18-25`). **Вимірювання спростувало підставу зрізу:** старт node — <3 % латентності хука; native-гілки коштували 40/55 мс, делегована 1.7–7.1 с (`hook_cmd.rs:32-39`). |
| `ci plan` | `:1963` → `lint-surface/ci-plan.mjs` | 🟡 частково | Native лише там, де плагіни доказово порожні. Єдиний блокер названо у файлі: `resolveRulesDirs → resolveSlotGraph → resolvePlugins`, «~1200 рядків JS» (`ci_cmd.rs:14-17`). Rule-level гейт **уже НЕ блокер** — став декларативним `main.json:applies` і рахується нативно (`ci_cmd.rs:19-27`). |
| `skill` | `:2007` → `scripts/skills-cli.mjs` | 🟡 частково | Native: `skill list`, `skill <runner> <id>`, `skill <id>`. Делегуються рівно дві гілки: legacy-раннер `claude` (щоб JS лишався власником свого usage) і скіли з JS-оркестратором `taze`/`git-reconcile` — конвеєр детермінованих кроків, який один агентний хід підмінити не може (`main.rs:170-180`). |
| `rename-yaml-extensions` | `:1809` → `bin/rename-yaml-extensions.mjs` → `scripts/rename-yaml-extensions.mjs` | ✅ native, повністю | — (`rename_yaml_cmd.rs`, ядро `rules_core::rename_yaml`; перша мутуюча native-команда, гейт — parity-тест зі звіркою стану ФС) |
| `changed-files` | **немає в JS взагалі** | ✅ native, повністю | — (`changed_files_cmd.rs`; `cli.rs:60` — «споживачів поза тестами цього репо немає») |
| `tools list` / `tools ensure` | **немає в JS взагалі** | ✅ native, повністю | — (`tools_cmd.rs`; компенсація за прибране авто-встановлення в native-концернах, `main.rs:60-63`) |
| `adr-normalize-local` | `:2012` → `lib/adr/normalize-cli.mjs` → `normalize-pipeline.mjs` | ✅ native є (`adr_cmd.rs`, крейт `rules-adr`) — **але недосяжний** | Порт зроблено (`main.rs:126-129`: «делегування в JS уже не має сенсу — двигун конвеєра тепер тут»). Проте виконується JS: хук кличе `npx --no @7n/rules adr-normalize-local` (`npm/.claude-template/hooks/normalize-decisions.sh:315`), а `bin` веде в JS. Див. §5. |
| `docs` | `:2021` → `rules/doc-files/package_knowledge/cli.mjs` | ❌ делегація | `docs build` — LLM-орієнтований, латентність тримає модель (`main.rs:66-70`); `docs domains\|index\|slice\|validate` портовні, але стеля виграшу ≈70 мс (`main.rs:71-73`). Область іншої розвідки. |
| `taze` | `:1973` | ❌ делегація | Не логіка, а диспатч слоту `taze.provider@1` у `@7n/rules-lang-js` — питання контракту плагінів, не фази 8 (`main.rs:74-76`). Кейс у JS реально резолвить слот-граф і робить `import(contribution.resourcePath)` (`:1982-1997`). |
| `release` | `:2001` → `rules/release/release.mjs` | ❌ делегація | Портовне; не зроблено, бо `bin` веде в JS (`main.rs:77-79`). Область іншої розвідки. |
| `lint-ga\|lint-text\|lint-rego\|lint-k8s\|lint-docker` | аліаси → `lint <scope>` (`:1755-1770`) | ❌ до `clap` не доходять | Legacy-сумісність; зникають разом із JS-роутером. |

**Три поверхні, яких у Rust немає взагалі і які не мають плану:** дефолтний sync,
`taze`, `release`. Дві поверхні, яких немає в JS (`changed-files`, `tools`), —
власність бінаря; `cli.rs:33-44` фіксує, що політика невідомого аргументу для них
fail-closed (код 2), а для спільних із JS — делегація.

## 3. Мертві JS-файли — найдешевша робота залишку

Критерій: жодного імпортера поза `*.test.mjs` / `tests/` у `npm/`, `plugins/`,
`crates/`, `.github/`. Перевірено грепом і за специфікатором, і за іменем експорту.

**Застереження, яке стосується всіх до одного:** `npm/package.json:57` оголошує
wildcard-експорт `"./scripts/*": "./scripts/*"`. Тобто «мертвий» означає
«без імпортера в цьому репозиторії», а не «недосяжний ззовні». Видалення кожного —
формально ламальна зміна публічної поверхні. Це знімається зрізом 6: §7.5 спеки
(`2026-08-01-rules-cli-phase8-skeleton.md:1029-1037`) виносить вирок «`types/` зникає
повністю», бо `exports`-поверхня має сенс лише через npm, а npm зникає.

### 3.1. Мертві двійники із завершеним Rust-портом — знести без портування

| Файл | Рядків | Rust-порт | Доказ смерті |
|---|---:|---|---|
| `npm/scripts/lib/gha-workflow.mjs` | 220 | `crates/rules-core/src/concerns/gha_workflow.rs:1` — «Native-порт `npm/scripts/lib/gha-workflow.mjs` (220 рядків)», з посиланням на рядок JS у кожній функції (`:46, 57, 68, 82, 91, 117, 125, 138`). Плюс `crates/rules-template-merge/src/lib.rs:193` (`parseWorkflowYaml`) і `crates/plugin-ci-github/src/lib.rs:1205` (`eventPathsIncludeExact`) | Дві згадки в усьому репо, обидві **тестові**: `npm/scripts/lib/tests/gha-workflow.test.mjs:14` і `plugins/ci-github/rules/ga/tests/workflow-templates-actionlint.test.mjs:31`. Продуктивного імпортера нуль. |
| `npm/scripts/lib/fix/template-deep-merge.mjs` | 239 | `crates/rules-template-merge/src/lib.rs:448-510` (`containedIn` `:478`, `identityKey` `:484`, `mergeJsonValue` `:510`) + `crates/rules-core/src/concerns/fix_template_merge.rs:2` + `crates/rules-core/src/concerns/fix.rs:62` (`createTemplateFixPattern`) | Єдиний імпортер — власний тест `npm/scripts/lib/tests/template-deep-merge.test.mjs:10`. Решта згадок — доккоментарі в крейтах і в `plugins/ci-github/slots/ci-artifact-consumer.mjs:187,249`. |

| `npm/scripts/lib/fix/vscode-ext-add.mjs` | 53 | `crates/rules-core/src/concerns/fix_vscode_extensions.rs` (той-таки файл `:28` фіксує, що це свідомо «інший, простіший рушій, ніж `template-deep-merge.mjs`») | Продуктивних імпортерів нуль. `plugins/lang-php/CHANGELOG.md:13` фіксує, що останній JS-канон цієї родини (`rules/php/vscode_extensions/fix-vscode_extensions.mjs`) **видалено**. |

Це **512 рядків**, які знімаються без жодного портування — треба лише зняти
юніт-тести (і у випадку `gha-workflow` звірити, що
`plugins/ci-github/rules/ga/tests/workflow-templates-actionlint.test.mjs` має чим
замінити `parseWorkflowYaml`; кандидат є — `crates/rules-template-merge/src/lib.rs:193`).

**Чому саме fix-родина вимерла — механізм названий у коді.**
`lint-surface/run-fix.mjs:400-411` (`loadT0Patterns`) шукає патерн у три черги:
спершу native-реєстр фіксів (`:401` — при влучанні повертає одразу), потім wasm-мапи
(`:407-410`), і лише тоді `fix-<concern>.mjs` (`:411`). Щойно всі відповідні концерни
стали native, JS-рушій перестав бути досяжним, не будучи ніде видаленим.

**Одне застереження до `gha-workflow.mjs`.** Rust-порт покриває 7 функцій із 9;
`eventPathsIncludeExact` і `verifyLintJsWorkflowStructure` **свідомо не портовані**
(`gha_workflow.rs:9-21` — «портована лише потрібна поверхня … `pub`-порт непотрібного
API дав би dead-code»). Це не блокує видалення: у `verifyLintJsWorkflowStructure`
нуль викликачів узагалі (в `npm/CHANGELOG.md:6526,6530,6621` записано його зняття з
`check-ga.mjs`/`check-js.mjs`), а `eventPathsIncludeExact` має власний відповідник у
`crates/plugin-ci-github/src/lib.rs:1205`.

**Супутній артефакт на видалення:** `npm/scripts/lib/adr/normalize-pipeline.mjs.orig`
(38 КБ) **закомічений у git** (є у виводі `git ls-files npm/scripts/lib/adr/`) —
залишок merge-конфлікту, який ніхто не читає.

### 3.2. Мертві без Rust-порту — просто вимерли

| Файл | Рядків | Що робив | Чому мертвий |
|---|---:|---|---|
| `npm/scripts/post-tool-use-check.mjs` | 83 | Entry point PostToolUse-хука | Подвійно мертвий. (1) Кейсу немає в `switch` — попри власний доккомент `:60` «Викликається з `bin/n-rules.js` коли argv[0] === `post-tool-use-check`». (2) Хук знято з обох темплейтів комітом `f24262c6e`; `npm/.claude-template/settings.template.json` не має ключа `hooks` взагалі. У `sync-claude-config.mjs:51` лишився лише **deprecated-маркер прибирання** старих записів. |
| `npm/scripts/lib/timing-summary.mjs` | 63 | Таблиця таймінгів для `fix`/`lint` | Доккомент `:4-6` називає двох викликачів: `runFixCommand` у `bin/n-rules.js` (файл тепер 8 рядків) і `runLintCli` у `scripts/lib/run-lint-cli.mjs` (**файлу не існує**). |
| `npm/scripts/lib/run-standard-lint.mjs` | 50 | Точка входу канонічних `lint-<rule>` | Дзеркалив `run-standard-rule.mjs`, якого більше немає. |
| `npm/scripts/lib/run-lint-step.mjs` | 38 | Один крок ланцюга `lint-<rule>` | Викликачі мали бути `rules/<id>/js/lint.mjs` — таких не лишилось. |
| `npm/scripts/lib/list-rule-ids.mjs` | 32 | Перелік `rules/<id>/` з `main.mjs` | Тільки власний тест. |
| `npm/scripts/lib/discover-checkable-rules.mjs` | 49 | Скан `rules/<id>/` на `concern.json` | Тільки власний тест. Заміщено `concern_meta`. |
| `npm/scripts/lib/discover-check-rules-from-cursor.mjs` | 40 | Мапа `.mdc` → id правила для голого `fix` | Команди `fix` у `switch` більше немає. |
| `npm/scripts/lib/check-reporter.mjs` | 27 | Акумулятор pass/fail | Явно заміщено: `lint-surface/violation-reporter.mjs:2,6` називає себе «drop-in заміна `createCheckReporter`». |
| `npm/scripts/lib/collect-test-files.mjs` | 48 | Обхід дерева по `*.test.mjs` | Порт у `crates/plugin-lang-js/src/lib.rs:140,432,449,792`; `npm/rules/doc-files/docgen-test-context/main.mjs:32` завів **власну** локальну копію. **Позначено як імовірно мертвий, не доведено остаточно.** |
| `npm/scripts/lib/mirror-parity.mjs` | 152 | Гард «`.cursor/rules/n-<id>.mdc` == канон» | Імпортер лише тест `mirror-parity.test.mjs:16` — але це **за дизайном** (`:12`: тест-гард + разова регенерація). Не борг, а інструмент. Не зносити. |
| `npm/scripts/lib/blue-oak.mjs` | 41 | SPDX-набір Blue Oak | Мертвий **навмисно**: `crates/plugin-lang-python/src/lib.rs:1593-1601` фіксує, що після зняття JS-детектора `python/project` внутрішніх споживачів немає, але це опублікована поверхня. Порт: `:1969,1985,1998`. Єдине місце в репо, де мертвий модуль задокументовано **правильно**. |

Разом §3.2: **382 рядки** — це сума восьми доведених рядків таблиці без
`mirror-parity.mjs` (152, лишається як інструмент), без `blue-oak.mjs` (41, мертвий
навмисно) і без `collect-test-files.mjs` (48, не доведено остаточно). З
`collect-test-files` — 430. Плюс їхні тести.

### 3.3. Що з цього НЕ мертве, попри схожість — і де порт неповний

- `npm/scripts/lib/rule-applies.mjs` (276) — **живий**: `lint-surface/run-detectors.mjs:22`
  імпортує `evaluateAppliesNode`, `readRuleApplies` (виклики `:177`, `:187`). Rust-порт
  завершений (`rule_applies.rs:123-327`), але це **дві живі реалізації** з однією
  розбіжністю — §3.4. Разом із ним живі `glob-to-regex.mjs` (79),
  `rule-meta.mjs` (66), `rule-meta-helpers.mjs` (104), `rule-predicates.mjs` (114) —
  усі через `auto-rules.mjs:26,33,34,35` ← `n-rules-cli.mjs:85`. Rust-двійника
  **рушія автодетекту немає**: `plugin-lang-js/src/lib.rs:6706` тримає лише
  *перелік імен* предикатів для валідатора `js/rule_meta`, а `:9012` прямо фіксує,
  що `migrateRuleIds` кроком не відтворено.
- `npm/scripts/lib/concern-meta.mjs` (179) — **живий**, чотири продуктивні імпортери:
  `discover-checkable-rules.mjs:9`, `lint-surface/run-detectors.mjs:17`,
  `lint-surface/policy-test-step.mjs:17`, `lint-surface/bridge-host.mjs:169`.
  Rust-порт **не 1:1**, попри власну заяву — §3.4.
- `npm/scripts/lib/template.mjs` (315) — **живий**, і його збереження зафіксовано
  в Rust: `crates/rules-core/src/concerns/template_subset.rs:4-8` портує **єдину**
  функцію `checkTextSubset` і прямо пише, що решта (`checkSnippet`, `checkDeny`,
  `checkContains`, `loadTemplate`, `resolveConcernTemplateData`) «лишається в JS —
  модуль **не** видаляється». `checkDeny`/`checkContains` не портовані свідомо
  (`plugin-ci-github/src/lib.rs:2474`). Імпортер — `lint-surface/policy-lint-adapter.mjs:16-24`.
- `npm/scripts/lib/changed-files.mjs` (67) — **живий, але не двійник, а фасад napi.**
  Власний заголовок `:8-11`: «Повністю native … цей фасад — лише передача виклику з
  JS-сигнатурою, без власної git/regex-логіки». Усі три експорти — однорядкові
  виклики `loadNative()` (`:22`, `:45`, `:66`) у `rules-napi/src/lib.rs:55,119,133`.
  **Клас: A**, тривіально — це вже Rust, лишилась обгортка.
- `npm/scripts/lib/diff-added-lines.mjs` (86) — **живий, Rust-відповідника нема
  взагалі.** Сам спавнить `git diff --unified=0 HEAD` (`:50`). Споживачі — у плагінах:
  `plugins/lang-js/rules/js/{lint-findings/main.mjs:4, eslint/main.mjs:9}`.
- `npm/scripts/lib/resolve-target-files.mjs` (103) — **живий**, Rust на нього
  посилається (`rules-fix/src/lib.rs:64,313`), але не портує.
- `npm/scripts/lib/inline-template-links.mjs` (113) і `generated-markdown.mjs` (71) —
  **живі, Rust-відповідника нема взагалі** (грепи по `crates/` порожні). Обслуговують
  дефолтний sync, тобто прив'язані до §9 кроку 3.
- `npm/scripts/lib/ensure-tool.mjs` (592) — **живий**: §4.
- `npm/scripts/lib/adr/normalize-pipeline.mjs` (925) — **живий**: §5.

### 3.4. Дві розбіжності між живими двійниками — знахідки, а не деталі

**(а) `applies.globMatches` рахується двома різними glob-рушіями.**
JS-гейт компілює патерн власним `globToRegex` (`rule-applies.mjs:256` →
`glob-to-regex.mjs:24`), який у власному доккоментарі `:19-20` заявляє: «Клас `[…]`
не підтримується». Rust-гейт компілює той самий патерн через
`GlobMatcher::compile` (`rule_applies.rs:302`) — picomatch/globset із `dot: true`
(`lint_plan.rs:143-157`). Доккомент `rule_applies.rs:58` стверджує, що це «той самий
picomatch-канон, що `concern.json#lint.glob`» — і це правда щодо Rust-боку, але
**JS-бік цього канону не тримає**, тож твердження хибне саме як твердження про паритет.

**Ризик сьогодні латентний, і це треба сказати чесно.** У всьому репо рівно три
правила мають `applies` (`plugins/{lang-js/rules/npm-module, lang-python/rules/python,
lang-rust/rules/rust}/main.json`), і `globMatches` використовує **одне** —
`plugins/lang-rust/rules/rust/main.json:4` з патерном `**/Cargo.toml`, на якому обидва
рушії дають один результат. Тобто дефекту сьогодні немає; є незакріплена умова, за
якої перший же гейт із `[…]`, brace-альтернативою чи крайовим globstar активує
правило на одному шляху виконання й не активує на іншому — мовчки.

**(б) `concern_meta.rs` заявляє «Порт 1:1» (`:13`), але двох полів не має.**
`LintSurface.extensionsSlot` (`concern-meta.mjs:86`, призначення — `:18-21`) не має
поля в Rust-структурі (`concern_meta.rs:53-62`: лише `scope`, `glob`, `anchors`).
`PolicySurface.files.required` (`concern-meta.mjs:26`) відсутній у `PolicyFiles`
(`concern_meta.rs:91-98`: лише `single`, `walk_glob`). У зворотний бік Rust — надмножина:
має `fix_hint` (`:141-146`), якого JS не знає, і всмоктує `asDetectorConcern`/
`deriveLintFromPolicy` з `run-detectors.mjs`. Тобто це не «порт 1:1», а перетин із
двома дірками в кожен бік; заявку у доккоментарі варто виправити незалежно від міграції.

## 4. `ensure-tool.mjs` проти `tool_resolve.rs`/`tool_registry.rs` — чому двійник живий

Відповідь є в коді дослівно, і вона не про брак часу.

`crates/rules-core/src/tool_resolve.rs:2-16`: native-резолв — це «дзеркало **перших
двох** кроків `ensureTool`». Далі буквально:

> `ensureTool` має чотири кроки: PATH → кеш → **авто-install** → hard-fail.
> Крок 3 (авто-install) — це brew/scoop-спавн на macOS/Windows і HTTP-завантаження
> GitHub-release-архіву з розпакуванням на Linux, плюс міжпроцесний `withLock` і
> GitHub-API з токеном. У `rules-core` немає (і **свідомо не заводиться**)
> HTTP-клієнта: крейт лишається офлайновим детермінованим ядром лінту, а не
> встановлювачем тулів.

Тобто Rust покриває резолв, а не провізіонінг. Провізіонінг **винесено в окрему
команду** `tools ensure` (`crates/rules-cli/src/tools_cmd.rs`, лок —
`tool_lock.rs:5`, «поверх `withLock`, ADR 260716-1354»), і `tool_resolve.rs:29-31`
прямо каже: «Добування тулів переїжджає в окрему команду `tools ensure`».

**Але `tools ensure` живе в бінарі, якого консюмер не отримує (§1).** Тому ланцюг
замикається так: єдиний встановлювач тулів, доступний із чинного каналу дистрибуції, —
це `ensure-tool.mjs`. Він живий не тому, що його не портували, а тому, що його
Rust-заміну відвантажити нема чим.

Схема `npm:`/`path:`/`pinned:` справді в Rust (`tool_resolve.rs:138`, поля
`brew`/`scoop`/`github` — «ті самі поля»), і **дані спільні, не дубльовані**:
`tool_registry.rs:32,35` роблять `include_str!` прямо з `npm/scripts/lib/tools.json`
і `npm/scripts/lib/tool-pins.json`. Розходження реєстрів структурно неможливе —
дублюється лише код читання.

Що НЕ покрито Rust-боком і мусить кудись подітись: `fetchLatestVersion` (`:293`),
`buildGithubDownloadUrl` (`:320`), `ensureHkInstall` (`:583`),
`checkToolPinsFreshness` (`:76`, гейт 30 днів) і `ToolProvisionError` (`:104`),
який `lint-surface/detect.mjs:157` розпізнає **за полем `name`**.

**Клас: B** — не «портувати як є», а «дотягнути `tools ensure` + віддати йому
HTTP/lock-контур», і це залежність від зрізу 6, а не від обсягу роботи.

## 5. `adr/normalize-pipeline.mjs` — порт завершено, двійник живий, і це найдорожча пара

- Rust: крейт `crates/rules-adr/` — 1 751 рядок (`src/lib.rs:2` — «порт
  `npm/scripts/lib/adr/normalize-pipeline.mjs`»; `retrieval.rs` Stage 0,
  `cascade.rs` каскад, `madr.rs` Stage 2, `pipeline.rs:235,266` — вхід і ядро,
  union-find `Dsu:167-190`), команда `crates/rules-cli/src/adr_cmd.rs` з тим самим
  env-контрактом (`:104-109`) і тим самим `{"operations": …}` у stdout (`:148`).
  `main.rs:126-129` перехоплює `adr-normalize-local` **до** `clap` і коментує:
  «делегування в JS уже не має сенсу — двигун конвеєра тепер тут».
- JS: `normalize-pipeline.mjs` (925) ← `adr/normalize-cli.mjs:22` (74) ←
  `n-rules-cli.mjs:2012`.
- Хто реально виконується: `npm/.claude-template/hooks/normalize-decisions.sh:315` —
  `ADR_LOCAL_CMD="${ADR_NORMALIZE_LOCAL_CMD:-npx --no @7n/rules adr-normalize-local}"`.
  `npx @7n/rules` → `bin/n-rules.js` → JS. Скіл іде тим самим шляхом:
  `.cursor/skills/n-adr-normalize/SKILL.md:64,74` запускають
  `bash .claude/hooks/normalize-decisions.sh`, тобто через той-таки `ADR_LOCAL_CMD`.
  Єдиний re-exec у JS-CLI — це handoff за зміною версії пакета
  (`n-rules-cli.mjs:1440-1466`, `ReexecHandoff` `:1472`), який перезапускає той самий
  `bin/n-rules.js`, а не бінар. Rust-конвеєр не викликається ніколи.

**Це найчистіший приклад загальної картини §1:** 999 рядків JS, для яких порт уже
написаний і оплачений, лишаються єдиним виконуваним шляхом виключно через
`package.json#bin`. Знести їх можна не «коли портуємо», а «коли зріз 6 переведе
`bin` на бінар». **Клас: D** (зникає разом зі зрізом 6), без потреби в новому коді.

## 6. `resolve-plugins.mjs` і слот-шина — коротко

За вказівкою координатора — абзацом, попри те, що проба дала детальний розбір.

`resolve-plugins.mjs` (455) + `plugin-slots.mjs` (670) — це ті самі «~1200 рядків»,
які `ci_cmd.rs:14-17` і `lint_cmd.rs:14` називають єдиним блокером native-шляху.
Rust-двійника **немає жодного**: `rules-core/src/config.rs:73` парсить лише поле
`plugins` конфігу, а `ci_cmd.rs:147-155` не портує резолв, а **ухиляється** від нього
(бачить встановлений плагін → делегує). Навіть native-шлях `lint` резолвить плагіни
через node: `lint_cmd.rs:206-214` шле `discover` у міст, `bridge-host.mjs:87-101`
динамічно імпортує `plugin-slots.mjs`.

Що з `resolve-plugins.mjs` **зникає** з Д1 (`docs/plans/2026-08-29-…:79`; §12.3-12.4
спеки): `ensurePluginInstalled` зі спавном `bun add -d` (`:301-315`),
`KNOWN_PLUGIN_RANGES` (`:281-288`, semver-діапазони → точні SHA-256),
проба `node_modules/<name>` і виведення `packageRoot` (`:302, 413-422`),
`readPluginManifest` із `package.json#n-rules` (`:342-365`, ідентичність переїжджає
в маніфест усередині Component), уся вісь `allowInstall`.
Що **лишається і має бути портоване попри Д1** — автодетект за файловими сигналами,
який спека зберігає дослівно (`…:712-714`: «автодетект-backfill лишається як є —
він читає сигнали дерева, не npm; зникає рівно **явна** половина»): таблиці
`KNOWN_CI_PLUGINS`/`KNOWN_LANG_PLUGINS` з per-language `maxDepth`, обмежений BFS,
детект CI з fallback на `repository.url`, семантика per-category backfill,
конвенція імені `@7n/rules-<category>-<name>` (яка стає **мапінгом на OCI reference**,
тобто навантажується більше, а не менше), гейт сумісності API і дисципліна
«пропустити, не впасти». **Клас: B** для вцілілої половини, **D** для решти.

Дві прогалини в дизайні, які варто винести окремо:
1. **`plugin-slots.mjs` не згаданий у таблиці Д1 взагалі.** Її модель безпеки
   (`resolveSafePackagePath` — «має починатись із `./`, без `..`, без виходу за
   `packageRoot` через symlink») написана під розпаковану npm-теку. За розкладки
   OCI-кешу корінь containment інший; §12 спеки цього не адресує.
2. `npm/rules/**` `.mjs` лишається відкритим блокером самодостатнього бінаря
   (`…:790-800`, `:1105-1112`). Оскільки Rust дістає `rulesDirs` саме через
   `bridge-host.mjs`, обидва ці файли транзитивно входять у той блокер.

## 7. Документи, що суперечать коду — окремою знахідкою

Це не косметика: три з мертвих модулів §3.2 виглядали живими саме тому, що
документ називав їхніх викликачів.

**7.1. `npm/bin/docs/n-rules.md` (612 рядків) описує CLI, якого не існує.**
Файл **не має frontmatter**, тобто не покритий CRC-гейтом `doc-files` — на відміну
від сусіднього `npm/bin/docs/n-rules-cli.md` (52 рядки, `docgen.crc: 328c01de`).
Конкретно:
- `:8` перелічує підкоманди `analyze-escalation`, `trace`, `doc-aggregate` — жодної
  немає в `switch` (`n-rules-cli.mjs:1808-2033`);
- `:14` — `npx @7n/rules fix`; `:27` — `npx @7n/rules docgen scan|modules`; `:463`,
  `:471` документують кейси `'post-tool-use-fix'` і `'docgen'` — таких кейсів немає;
- `:19`, `:53`, `:505`, `:571` описують `post-tool-use-fix.mjs` — **файлу немає на
  диску взагалі**, а `:571` стверджує, що хук «синхронізується автоматично через
  `syncClaudeConfig`», що прямо суперечить `sync-claude-config.mjs:40-46` і `CLAUDE.md`;
- `:62`, `:65` називають імпорти з `scripts/worktree-cli.mjs` і `scripts/lint-cli.mjs`
  — **обох файлів не існує** (перевірено `ls`);
- `:54-55`, `:506-507`, `:517` стверджують, що CLI імпортує
  `discoverCheckRulesFromCursorRules`, `listRuleIds`, `formatTimingSummary` —
  жодного немає в `n-rules-cli.mjs`.

**7.2. Сам CLI бреше у своєму повідомленні про помилку.** `n-rules-cli.mjs:2036`
у гілці `default` друкує список очікуваних команд, який закінчується на
`doc-aggregate` — команди, якої в тому ж `switch` немає.

**7.3. `npm/scripts/lib/docs/**` тримає мертві модулі як чинні** —
`docs/index.md` перелічує їх усі; `docs/run-standard-lint.md:13,33` документує
патерн використання `runStandardLint`, у якого немає викликачів.

**7.4. ADR посилається на неіснуючий експорт.** `docs/adr/260620-1006-….md:116`
описує регенерацію дзеркал через `regenerateMirrors` із `mirror-parity.mjs`;
експортів у файлі три — `listManagedMirrors`, `expectedMirrorContent`, `findMirrorDrift`.

**7.5. `plugin-api.mjs:5-7`** описує реєстрацію через legacy `contributes.handlers.taze`,
яку фаза 2 прибрала (пор. `plugin-slots.mjs:3-5`).

**7.6. Дрейф пінів платформних пакетів.** `npm/package.json:2` — версія `1.118.11`,
`:86-88` — піни `@7n/rules-*` на `1.118.8`. Це штатний хід (піни оновлює
`npm-publish.yml:377-398` під час публікації), але це друге джерело правди про
версію, яке §12.5 спеки називає серед того, що зріз 6 **прибирає**.

## 8. Не розібрано — і чому

Із чотирьох делегованих проб три віддали результат, одна — ні. Нижче — те, для чого
я маю лише факт «живий/мертвий» і наявність Rust-порту, але **не маю розбору по суті**.
Клас портовності для них свідомо **не присвоєно**.

| Файл | Рядків | Що встановлено | Чого бракує |
|---|---:|---|---|
| `native.mjs` | 273 | Живий, 8 продуктивних імпортерів: `utils/walkDir.mjs:4`, `auto-worktree.mjs:7`, `changed-files.mjs:14`, `lint-surface/{run-detectors:19, render:16, wasm-plugins:118, run-fix:26, detect:14}`. `:74` — `EXPECTED_CONTRACT_VERSION = 2`; `:50-54` описує це як «той самий enforcement-патерн, що `requiresPluginApi`» | Механізм резолву аддона, env-гейти `N_*_NATIVE_ADDON`, поведінка за відсутності бінаря. Це **єдиний міст JS→napi** в області — розібрати треба першим. |
| `auto-worktree.mjs` | 279 | Живий: `n-rules-cli.mjs:87-91` (`ensureRunningInWorktree`, `bringChangesBackToOriginal`, `removeAutoCreatedWorktree`) і `npm/skills/taze/js/orchestrate.mjs:10,16`. Кличе napi (`:7`). Rust: `rules-core/src/worktree.rs` — тонка обгортка над крейтом `mt_core`, експонована через `rules-napi/src/lib.rs:70-109` | Скільки з 279 рядків — оркестрація поверх napi, а скільки власна логіка. Схоже на найтоншу пару в області, але не перевірено. |
| `worktree-notice.mjs` / `root-notice.mjs` | 180 / 67 | Живі: `n-rules-cli.mjs:93,95` | Зміст; Rust-порту не шукав. |
| `ensure-tool.mjs` | 592 | §4 — межа з Rust встановлена цитатами з `tool_resolve.rs` | Прочитано лише перелік експортів. Внутрішній устрій (кеш, `withLock`, per-OS гілки) — з доккоментаря Rust, не з самого файлу. |
| `adr/normalize-pipeline.mjs` | 925 | §5 — живий, порт повний, шлях виконання встановлений | Зміст конвеєра по суті. Для вироку «D» це не потрібно; для будь-чого іншого — потрібно. |

Окремо: **паритет двох живих пар (`rule-applies`, `concern-meta`) ніхто не звіряв
поведінково.** §3.4 знайшов дві розбіжності читанням коду; чи є ще — невідомо.
Rust-боки заявляють «1:1», і в одному з двох випадків заявка вже виявилась неточною.

## 8а. Класи портовності — зведення

**A** портовне як є · **B** потребує нової поверхні · **C** структурно не портовне ·
**D** зникає зі зрізом 6 · **—** класу не присвоєно (не розібрано).
Порожній клас — це відповідь, а не пропуск.

| Файл / родина | Рядків | Клас | Підстава |
|---|---:|:--:|---|
| `gha-workflow.mjs`, `fix/template-deep-merge.mjs`, `fix/vscode-ext-add.mjs` | 512 | **D** (негайно) | Мертві, Rust-порт готовий — §3.1. Портувати нема чого. |
| 8 мертвих без порту (§3.2) | 382 | **D** (негайно) | Викликачів немає; більшість втратила їх разом із видаленими модулями. |
| `adr/normalize-pipeline.mjs` + `normalize-cli.mjs` | 999 | **D** | Порт завершений (`rules-adr`, 1 751 рядок); живі лише через `package.json#bin` — §5. |
| `resolve-plugins.mjs` — install/`node_modules`-половина | ~150 з 455 | **D** | Д1: `ensurePluginInstalled`, `KNOWN_PLUGIN_RANGES`, `readPluginManifest`, вісь `allowInstall` — §6. |
| `resolve-plugins.mjs` — автодетект за сигналами | ~300 з 455 | **B** | Спека зберігає дослівно; конвенція імені стає мапінгом на OCI reference — §6. |
| `plugin-slots.mjs` + `plugin-api.mjs` + `call-edges.mjs` | 872 | **B** | Rust-двійника немає; §2.98 реєстру визначає, що слот-граф належить хосту, але каналів у контракті бракує — §6. |
| `ensure-tool.mjs` | 592 | **B** | Rust покриває 2 кроки з 4; HTTP/lock-контур свідомо не в `rules-core`, а `tools ensure` не відвантажується — §4. |
| `changed-files.mjs` | 67 | **A** | Уже фасад napi без власної логіки — §3.3. |
| `template.mjs` | 315 | **C** | `template_subset.rs:4-8` фіксує, що модуль **не** видаляється: решта обслуговує JS-концерни. |
| `inline-template-links.mjs`, `generated-markdown.mjs` | 184 | **D** | Обслуговують дефолтний sync, який зникає разом із launcher-шаром (§12.5 спеки). |
| `diff-added-lines.mjs` | 86 | **B** | Rust-відповідника нема; споживачі — JS-плагіни, тобто потрібен канал до гостя. |
| `resolve-target-files.mjs` | 103 | **B** | Rust посилається, але не портує. |
| `rule-applies.mjs` + 4 сателіти | 639 | **B** | Гейт портований, **рушій автодетекту — ні** (`auto-rules.mjs` не має Rust-двійника). Плюс борг §3.4(а). |
| `concern-meta.mjs` | 179 | **A** | Порт є; лишається дозакрити дві дірки §3.4(б) і зняти JS-споживачів у `lint-surface` (чужа область). |
| `sync-claude-config.mjs` + `runSync` + супутні | ~2 500 | **C** сьогодні | Rust-контуру немає взагалі, і §12.4.1 спеки дає лише **вшивання тексту**, а не виконавця merge-логіки — §9 крок 3. |
| `release-smoke.mjs`, `github-package-release.mjs`, `smoke-check-imports.mjs`, `build-wasm-plugins.mjs`, `update-blue-oak.mjs`, `tool-pins-refresh.mjs` | ~1 000 | **D** | Обслуговують npm-канал і збірку; зникають або лишаються build-time скриптами (Факт 3 §12.4.1: `npm/` лишається джерелом збірки). |
| `ensure-n-rules-dev-dependencies.mjs`, `upgrade-n-rules-and-install.mjs`, `sync-setup-bun-deps-action.mjs` | 585 | **D** | Мутують `devDependencies`/`bunx`-контур пакета, якого після зрізу 6 не буде. |
| `auto-rules.mjs`, `auto-skills.mjs`, `build-agents-commands.mjs`, `skill-meta.mjs`, `skill-fragments.mjs` | ~800 | **B** | Двигун автодетекту правил/скілів; частково є дані в Rust (`skills.rs`), рушія немає. |
| `native.mjs`, `auto-worktree.mjs`, `worktree-notice.mjs`, `root-notice.mjs` | 799 | **—** | §8: не розібрано. Класу не присвоєно навмисно. |

## 9. Порядок і залежності

Похідне від §1: **майже все в цій області впирається не в обсяг роботи, а в зріз 6.**
Тому порядок нижче — за незалежністю від нього, а не за розміром.

**Крок 0 — не залежить ні від чого (≈890 рядків коду + 38 КБ сміття).** Знести мертве:
§3.1 (512 рядків із готовим Rust-портом) + §3.2 без `mirror-parity.mjs`,
`blue-oak.mjs` і недоведеного `collect-test-files.mjs` (382) + закомічений
`adr/normalize-pipeline.mjs.orig`.
Ризик — лише wildcard-експорт `npm/package.json:57`; для `post-tool-use-check.mjs`
і `timing-summary.mjs` він теоретичний.

**Крок 0в — не залежить ні від чого, і це не міграція, а коректність.** Дві
розбіжності §3.4: закріпити glob-семантику гейта `applies` (або звести JS на
picomatch, або звузити Rust — але явно, тестом на обох боках), і виправити
заявку «Порт 1:1» у `concern_meta.rs:13` до фактичного стану. Поки в репо один
`globMatches` із безпечним патерном, ціна нульова; після другого — це вже пошук
мовчазної розбіжності в проді.

**Крок 0б — не залежить ні від чого.** Виправити або знести `npm/bin/docs/n-rules.md`
і рядок `n-rules-cli.mjs:2036`. Обидва вже коштували цій розвідці хибних слідів;
поки документ живий, він коштуватиме їх і наступним.

**Крок 1 — дочитати §8**, починаючи з `native.mjs`: це єдиний міст JS→napi в
області, і без нього не можна класифікувати `auto-worktree`. (`changed-files.mjs`
питання вже не становить — §3.3: це фасад, клас A.)

**Крок 2 — зріз 6, Д1** (після Д2). Знімає: `resolve-plugins.mjs` наполовину,
`adr/normalize-pipeline.mjs` + `normalize-cli.mjs` цілком (999 рядків, порт готовий),
`ensure-n-rules-dev-dependencies.mjs` (217) і `upgrade-n-rules-and-install.mjs` (332)
— обидва мутують `devDependencies` пакета, якого не буде,
`sync-setup-bun-deps-action.mjs` (36) умовно (§7.6 спеки), і весь launcher-шар
`n-rules.js` → `n-rules-cli.mjs` → роутер (§12.5 спеки).

**Крок 3 — те, що не має плану взагалі.** Дефолтний sync (`runSync` ~1 480 рядків +
`sync-claude-config.mjs` 939), `taze`, `release`. Це три поверхні з таблиці §2 без
жодного Rust-контуру. `sync-claude-config.mjs` при цьому — консюмер-facing запис у
чужі `.claude/settings.json`, `.cursor/hooks.json`, `.codex/hooks.json`, `.pi/extensions/`,
`.gitignore`, тобто рівно той клас, який §12.4.1 спеки вирішує «вшиванням у бінар» —
але вшивання дає **текст**, а не виконавця merge-логіки.

**Що НЕ треба брати:** `mirror-parity.mjs` (інструмент, не борг), `blue-oak.mjs`
(мертвий навмисно, чекає на зріз 6), `release-smoke.mjs` (550 — чорноскринькова
перевірка опублікованого npm-набору; зникає разом із npm-каналом, портувати нема сенсу),
`update-blue-oak.mjs`/`tool-pins-refresh.mjs` (ручні data-refresh скрипти, чий
**вивід** уже споживається Rust-боком через `include_str!`).
