# Д3/Д4 третьої колії (дистрибуція) — звірка обсягу з кодом, вердикт про порядок

**Контекст.** Завдання — зробити Д3 (видалення `wasm-plugins/` як механізму
дистрибуції) і Д4 (міграція консюмерських файлів) третьої колії
(`docs/plans/2026-08-31-full-rust-migration-plan.md` §6/§7). Бриф прямо
вимагав зміряти КОЖНЕ число з §6 перед написанням коду — план у цій міграції
розходився з кодом чотири рази поспіль (§5.1 плану). Ця секція — той вимір, і
вердикт, який з нього випливає: **Д3 і Д4, у формі, названій §6, зараз
виконувати НЕ можна** — обидві впираються в інфраструктуру, якої ще немає, і
виконання зараз створило б рівно той клас вади («консюмер мовчки втрачає
канал»), проти якого сам бриф застерігав.

## 1. Звірка чисел §6 плану з кодом

| твердження плану (§6) | вимір | висновок |
|---|---|---|
| «14 шаблонів і слот-сніпетів із `bunx n-rules`» | `grep -rl "bunx n-rules" --include="*.snippet.yml" plugins/` → рівно 14 файлів (перелік нижче) | **збігається** |
| «`$schema` з `unpkg` у `.n-rules.json` (`npm/bin/n-rules-cli.mjs:126`)» | `npm/bin/n-rules-cli.mjs:126`: `CONFIG_SCHEMA_URL = 'https://unpkg.com/@7n/rules/schemas/n-rules.json'`, використовується у трьох місцях (`:259`, `:452`, `:491`) | **збігається**, номер рядка точний |
| «allow-list у `.claude/settings.json`» | Консюмер-шаблон — `npm/.claude-template/settings.template.json` (те, що `sync-claude-config.mjs` кладе в чужі репо), не сам `.claude/settings.json` цього репо (той — dev-налаштування контриб'ютора, інша річ). Зараз: `Bash(bunx *)`, `Bash(npx --no @7n/rules *)`, `Bash(npx @7n/rules *)` | **збігається за адресою**, але зміст — не «застаріла адреса», а «дві форми виклику співіснують», див. §3 |
| «`uses: ./.github/actions/setup-bun-deps` у 13 сніпетах» | `grep -rl "uses: ./.github/actions/setup-bun-deps" --include="*.snippet.yml" plugins/` → **12**, не 13 (перелік нижче) | **РОЗХОДИТЬСЯ**: 12, не 13 |

### 1.1. 14 файлів `bunx n-rules` (консюмер-facing)

```
plugins/ci-azure/rules/azure-pipelines/lint_pipeline/template/azure-pipelines-lint.yml.snippet.yml
plugins/ci-azure/rules/azure-pipelines/pipeline_common/template/azure-pipelines.yml.snippet.yml
plugins/ci-azure/rules/azure-pipelines/service_deploy_pipeline/template/deploy-service-pipeline.yml.snippet.yml
plugins/ci-github/rules/docker/lint_docker_yml/template/lint-docker.yml.snippet.yml
plugins/ci-github/rules/ga/lint_ga/template/lint-ga.yml.snippet.yml
plugins/ci-github/rules/ga/lint_repo_yml/template/lint-repo.yml.snippet.yml
plugins/ci-github/rules/ga/service_deploy_workflow/template/deploy-service.yml.snippet.yml
plugins/ci-github/rules/k8s/lint_k8s_yml/template/lint-k8s.yml.snippet.yml
plugins/ci-github/rules/npm-module/npm_publish_yml/template/npm-publish.yml.snippet.yml
plugins/ci-github/rules/style/lint_style_yml/template/lint-style.yml.snippet.yml
plugins/ci-github/rules/text/lint_text/template/lint-text.yml.snippet.yml
plugins/lang-js/slots/ci/github/lint-js.yml.snippet.yml
plugins/lang-php/slots/ci/github/lint-php.yml.snippet.yml
plugins/lang-python/slots/ci/github/lint-python.yml.snippet.yml
```

### 1.2. 12 файлів `uses: ./.github/actions/setup-bun-deps` (не 13)

Той самий набір мінус три azure-pipelines-сніпети (Azure Pipelines не має
GitHub Actions composite actions — використовує інший механізм) плюс один
файл поза списком 1.1 (`storybook-ci`, не `bunx n-rules`, а `bunx --bun
storybook`):

```
plugins/lang-js/rules/test/storybook-ci/template/lint-storybook.yml.snippet.yml
plugins/lang-js/slots/ci/github/lint-js.yml.snippet.yml
plugins/ci-github/rules/ga/lint_ga/template/lint-ga.yml.snippet.yml
plugins/ci-github/rules/ga/lint_repo_yml/template/lint-repo.yml.snippet.yml
plugins/ci-github/rules/ga/service_deploy_workflow/template/deploy-service.yml.snippet.yml
plugins/ci-github/rules/docker/lint_docker_yml/template/lint-docker.yml.snippet.yml
plugins/ci-github/rules/k8s/lint_k8s_yml/template/lint-k8s.yml.snippet.yml
plugins/ci-github/rules/style/lint_style_yml/template/lint-style.yml.snippet.yml
plugins/ci-github/rules/npm-module/npm_publish_yml/template/npm-publish.yml.snippet.yml
plugins/ci-github/rules/text/lint_text/template/lint-text.yml.snippet.yml
plugins/lang-php/slots/ci/github/lint-php.yml.snippet.yml
plugins/lang-python/slots/ci/github/lint-python.yml.snippet.yml
```

12 файлів. «13» у брифі — не підтверджено виміром; найближче правдоподібне
пояснення — попередній підрахунок міг або пропустити один із трьох
azure-сніпетів у інший бік, або порахувати `storybook-ci` як частину
«14 bunx-файлів», чим він не є (`bunx --bun storybook`, не `bunx n-rules`).
Розбіжність не критична для вердикту нижче (обсяг того самого порядку), але
фіксується, бо бриф прямо вимагав звірити КОЖНЕ число.

## 2. Що насправді значить «Д3»/«Д4» — авторитетне джерело, не §6-рядок

§6 чинного плану (`2026-08-31-full-rust-migration-plan.md`) описує Д3/Д4
одним реченням кожну. Джерело з деталями — його попередник
(`docs/plans/2026-08-29-js-rust-migration-completion-plan.md:108-135`,
формально «ЗАКРИТО», але розділ «третя колія» прямо перенесений як чинний):

> Д3 | `npm/wasm-plugins/` видаляється; `builtin-pins.json` переродити в
> lock-формат `oci-dist`, не заводити другий | видалення
>
> Д4 | Канонічний рядок виклику `bunx n-rules …` → `n-rules …` — у
> **14 шаблонах/сніпетах**, які лягають у чужі репозиторії, і в
> `bun/package_json`, який переписує чужі виклики на цей рядок | міграція
> консюмерів

Це узгоджує «14 файлів» (§1.1 тут) з попередником, і уточнює, ЩО саме Д4
робить із ними — не додає крок, а **замінює рядок виклику** з `bunx n-rules`
на голий `n-rules` (бінар напряму, без `bunx`/npm).

**Ключове речення, яке §6 чинного плану НЕ перенесло:**

> **Д4 — єдина робота плану з двобічним обмеженням у часі.** Перейти до неї
> раніше зрізу 6 не можна (доти `n-rules` існує лише як npm-пакет, і `bunx`
> — єдине, чим його запустити), забути після — це лишити кожного консюмера
> з викликом каналу, якого більше немає.

і в тій самій таблиці:

> Усередині: Д2 (публікація артефактів) → Д1 (резолв) → Д3 (видалення
> `wasm-plugins/`) → Д4 (міграція консюмерів). Д3 не можна робити раніше Д1,
> Д4 — раніше решти.

Тобто «раніше решти» для Д4 означає буквально: раніше, ніж `n-rules`
матиме канал доставки, ВІДМІННИЙ від npm/`bunx`. Це не побічна деталь, а
явна причина, записана поряд із самим визначенням роботи — і саме той клас
запису, за яким §5.1 плану просить стежити («причина, не звірена з подією,
що її скасовує»).

## 3. Вимір: чи існує зараз канал, відмінний від npm/`bunx`

```bash
ls .github/workflows/ | grep -iE 'release|publish'
# npm-publish.yml
# package-release.yml
# release-smoke.yml
```

Жодного workflow, що публікує `rules-cli`/`rules-napi` як самостійний
артефакт (GitHub Release binary, Homebrew formula, cargo-binstall
manifest) — немає. `n-rules` сьогодні доїжджає до консюмера **виключно**
через `@7n/rules` на npm, а `bunx n-rules` — єдиний робочий спосіб його
запустити, дослівно той стан, який попередник плану називає причиною
НЕ робити Д4.

**Наслідок.** Переписати 14 шаблонів/сніпетів (і `.claude/settings.json`
allow-list разом з ними — `Bash(npx @7n/rules *)`/`Bash(bunx *)` на щось
вужче під голий `n-rules`) зараз означає вписати в чужі CI-файли виклик
бінаря, якого консюмер fetch-нути НЕ МОЖЕ. Це не «застаріла адреса, яку
можна виправити пізніше» — це рядок, що падає на першому ж прогоні щойно
злитий. Той самий клас вади, що бриф прямо назвав для `$schema`/`unpkg`
(«мовчазна втрата»), тільки гучний (CI просто червоніє) замість тихого —
і саме тому виконання Д4 зараз відхилено, а не відкладено мовчки.

### 3.1. `$schema`/`unpkg` — уже вирішено окремим документом, НЕ винайдено тут

Бриф назвав це «мовчазна втрата, яку не можна ховати» — і питання вже має
ухвалене власником рішення, знайдене при вимірі: `docs/specs/2026-08-31-
slice6-consumer-surfaces.md`, **«Рішення 7 — `$schema`: власний Apicurio-
реєстр»**. Дослівно та сама причина, той самий рядок (`n-rules-cli.mjs:126`):
«Після зняття npm `unpkg` віддасть 404, і IDE перестане валідувати конфіг —
**мовчки**». Рішення — власний Apicurio Registry, з двома обов'язковими
умовами (пінована версія артефакту, не `latest`; анонімне читання) і
свідомо прийнятою слабкістю (airgapped-консюмер лишається без підказок
IDE). Локальний файл і SchemaStore розглянуто й відхилено там же.

Це підтверджує вимір §3 тут іншим шляхом: рішення прив'язане до «зняття
npm» — тієї самої події, що й у попередникові плану для Д4, і воно ще НЕ
реалізоване (Apicurio-реєстр у репозиторії не згадується жодним workflow чи
скриптом — перевірено, `grep -ri apicurio` за репо порожній). Тобто
заміна URL уже спроєктована, лишається її реалізувати РАЗОМ із рештою
Д4, не окремим передчасним кроком зараз.

## 4. Д3 — та сама залежність, підтверджена окремим виміром

Мінідизайн Д1 (`docs/specs/2026-09-01-wasm-plugin-lock-resolve.md` §3)
прямо каже: Д3 = «`builtin-pins.json` переродити в lock-формат `oci-dist`,
не заводити другий» — тобто заміна каналу «файли, вбудовані в npm-пакет» на
«OCI-артефакт + `.oci-dist.lock` + `n-rules plugin fetch`» для ШІСТЬОХ
first-party плагінів (`lang-js`/`lang-python`/`lang-rust`/`lang-php`/
`ci-github`/`ci-azure`).

Д1/Д2 вже дали код для цього: `n-rules plugin publish`/`n-rules plugin
fetch` існують (`crates/rules-cli/src/plugin_cmd.rs`), четверта форма
`wasmPlugins` (`package`+`requirement`) резолвиться з lock+кешу без мережі
в JS. Але:

```bash
grep -n "plugin publish\|plugin fetch\|plugin embed-manifest" .github/workflows/*.yml
# (порожньо)
```

**Жоден workflow не викликає `n-rules plugin publish`.** Шість first-party
плагінів НЕ опубліковані як OCI-артефакти жодного разу — команда існує й
протестована (§2.121 реєстру), але не підключена до конвеєра релізу. Якщо
зараз видалити `npm/wasm-plugins/*.wasm` і `builtin-pins.json`
(буквальне читання «Д3 — видалення»), консюмер, чий `.n-rules.json` не
містить `wasmPlugins`-записів (типовий консюмер — записи `wasmPlugins`
взагалі не документовані як обов'язкові в жодному шаблоні з §1.1), втратить
УСІ шість first-party wasm-детекторів МОВЧКИ (skip-not-crash — доккомент
`wasm-plugins.mjs` дослівно: відсутній builtin-пін — тиша, без warn,
«очікуваний стан»). Це саме та вада, яку принцип проекту забороняє
(«мовчазний skip — вада»), тільки спричинена не кодом, а порядком дій.

## 5. Вердикт про порядок

Бриф питав явно: чи порядок «Д3 → Д4», названий планом, правильний. Вимір
дає відповідь **ні, в поточному стані репозиторію жодне з двох виконувати
не можна**, і причина одна на обидва:

- **Д3** (зняти `wasm-plugins/` як механізм дистрибуції) вимагає, щоб OCI-
  публікація ШІСТЬОХ плагінів реально відбувалась (`n-rules plugin
  publish`, підключений хоч до одного, навіть вимкненого зараз, кроку
  релізу) — інакше нема куди резолвити заміну.
- **Д4** (переписати `bunx n-rules` → `n-rules` у 14 файлах +
  `.claude/settings.json` + `$schema`) вимагає, щоб `n-rules` мав канал
  доставки, відмінний від npm — інакше переписаний рядок падає негайно.

Обидві залежності — не гіпотетичні, а виміряні відсутністю відповідного
кроку в `.github/workflows/*.yml` (розділи 3 і 4). Жодна з них не є
частиною роботи, названої «Д3»/«Д4» в цьому брифі — обидві належать до
«Крок 0» §5 плану («зробити бінар вхідною точкою … бінар має чим доїхати
до консюмера») і до підключення вже написаного Д2-коду до реального
конвеєра. Виконати Д3/Д4 зараз — не звузити обсяг, а вписати в консюмерські
файли й у власний npm-пакет посилання на канали, яких на практиці нема,
що є мовчазним (для Д3, skip-not-crash) чи гучним (для Д4, CI-red) видом
рівно тієї вади, проти якої застерігав сам бриф.

**Що робиться цією задачею замість написання коду для Д3/Д4:** цей вимір,
записаний як окремий документ (той самий патерн, що мінідизайн Д1) — щоб
наступний виконавець не наступив на той самий застарілий рядок §6, і щоб
реєстр (§2.138) мав перевіряний артефакт, а не прозу.

## 6. Що треба зробити ПЕРЕД тим, як Д3/Д4 стануть виконуваними (не ця задача)

1. Підключити `n-rules plugin publish` до реального (нехай спершу
   вручну запущеного чи в `disabled_manually`-workflow) кроку релізу для
   всіх шести `FIRST_PARTY_WASM_PLUGINS`
   (`npm/scripts/build-wasm-plugins.mjs`), і перевірити хоч один
   наскрізний `fetch` живим OCI-реєстром (не стабом) — лише тоді
   «заміна» з мінідизайну Д1 §3 реально існує.
2. Дати `rules-cli`/`rules-napi` канал доставки, відмінний від npm/`bunx`
   (`crates/rules-cli` — GitHub Release binary мінімум; це і є «Крок 0»
   §5 плану, названий там передумовою, а не окремим кроком третьої колії).
3. Реалізувати власний Apicurio Registry для `$schema`
   (`docs/specs/2026-08-31-slice6-consumer-surfaces.md`, Рішення 7 — вже
   ухвалено власником, лишається реалізувати: пінована версія артефакту +
   анонімне читання) і власний OCI-реєстр для самого бінаря/плагінів
   (там же, Рішення 9).
4. Лише після (1)-(3) — Д3 (зняти `npm/wasm-plugins/` як бандл, лишивши
   лише лок+кеш-резолв) і Д4 (переписати 14 файлів + `.claude/settings.json`
   + `$schema`) стають одноразовою, безпечною заміною рядка, а не
   стрибком у порожнечу.
