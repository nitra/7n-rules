---
date: 2026-05-15
topic: concern-based JS + per-policy target.json
spec: docs/superpowers/specs/2026-05-15-npm-rules-concern-and-target-design.md
---

# ADR: concern-based JS + per-policy `target.json`

## Контекст

Після фази 1-4 реструктуризації (див. `docs/superpowers/specs/2026-05-14-npm-rules-restructure-design.md`) кожне правило живе у `npm/rules/<id>/` з одним `js/check.mjs` і `policy/<name>/<name>.rego`. Два болі:

- Один JS-файл на правило змушує тримати все в одному модулі (`abie/js/check.mjs` = 1153 рядки).
- Targeting rego-полісі розмазаний між `js/check.mjs` (виклики `runConftestBatch({ files })`) і централізованим `lint-conftest.mjs:TARGETS`. Pure-rego правило без JS-обгортки CLI не побачить (discoverCheckScripts фільтрує по `js/check.mjs`).

## Рішення

1. **Concern-based JS:** `rules/<id>/js/<concern>/check*.mjs`. Discovery читає підкаталоги `js/`, фільтрує `check*.mjs`, пропускає `*.test.mjs` і `utils/`.
2. **`target.json` per-policy:** `rules/<id>/policy/<name>/target.json` декларує `files.single` або `files.walkGlob`. CLI читає й передає у `runConftestBatch` — JS не дублює виклик.
3. **`applies()` в JS:** rule-level gate — опційний named export з `js/applies/check.mjs`. Повертає false → CLI пропускає все правило.
4. **`utils/` на двох рівнях:** `npm/scripts/utils/` (глобально), `npm/rules/<id>/utils/` (per-rule).
5. **Симетрія `js/<name>/` ↔ `policy/<name>/`:** одне ім'я — один концерн (pure-rego / pure-js / hybrid).
6. **Picomatch** як glob-парсер (1 dep, RegExp-compiled, найдешевший).

## Альтернативи, які відкинули

- **`rule.json` per-rule** замість `target.json` per-policy: централізує decl, але втрачає locality (полісі і її таргет розводяться).
- **Convention-only без декларації** (feed-all-yaml, нехай rego гейтить через `input.kind`): обмежує rego до kind-based полісі, ламає на безкіндових файлах (`.cspell.json`, `.oxfmtrc.json`).
- **Окремий `rule.json:applies`**: дублює функціональність JS, який і так часто потрібен; «inline в JS» прийнятно.

## Прийняті дрібніші питання

- **Legacy-fallback** для не мігрованих правил під час переходу: без іменування концерну. Discovery бачить `js/check.mjs` напряму, runner викликає окремою гілкою.
- **`required: true` для `walkGlob`**: заборонено в schema. Conditional «має бути файл» — через `applies()`.
- **`conftest.combine` у schema**: прибрано, додамо при першому юзкейсі.

## Наслідки

- CLI отримує дві нові утиліти у `npm/scripts/utils/`: `resolve-target-files.mjs`, `discover-checkable-rules.mjs`, `run-rule.mjs`.
- `picomatch@^4` додається у `dependencies` пакета `@nitra/cursor`.
- `lint-conftest.mjs:TARGETS` стає похідною від `target.json`-файлів — буде переписано після завершення міграції правил.
- Міграція інкрементальна, по одному правилу; legacy-гілка discovery прибирається після останнього.

## Деталі реалізації

Повна специфікація, контракти, JSON Schema, порядок міграції 7 кроків — у `docs/superpowers/specs/2026-05-15-npm-rules-concern-and-target-design.md`.

## Стан

В реалізації. Пілот — `rules/rego/` (3 канонічні полісі + `applies()` через `projectHasRegoFiles`).

## Update 2026-05-15 — конвенція запуску JS check-файлів

Затверджено конвенцію для файлів у `js/<concern>/`: запускаються тільки `check.mjs` та `check-*.mjs`; `*.test.mjs` пропускаються; спільний код розміщується у `utils/` поза `js/` (рівень правила) або у `npm/scripts/utils/` (рівень пакету). Порядок запуску — алфавіт. Shared стан між кількома `check-*.mjs` одного концерну — module-level singleton-кеш у хелпері (платить тільки перший виклик). Walk-кеш — `Map`, що передається через scope `runChecks`, щоб уникнути глобального стану в тестах.

Алфавітний порядок передбачуваний; якщо між файлами потрібен explicit-порядок — це сигнал про залежність по стану, яку треба виразити через явний виклик у хелпері. Module-level кеш природний для одноразового прогону — новий процес дає новий кеш.

**Зачіпає:** `npm/scripts/utils/discover-checkable-rules.mjs`, `npm/scripts/utils/run-rule.mjs`

## Update 2026-05-15 — повна міграція 25 правил і розпил abie (v1.11.0)

Виконано повну concern-based міграцію усіх ~25 правил пакету. `abie/js/check.mjs` (1153 рядки) розпиляно на 6 концернів (`applies`, `firebase_hosting`, `hc_pairing`, `env_dns`, `ua_node_selector`, `ua_http_route`) та 7 утиліт (`k8s-tree.mjs` із кешованим `findK8sYamlFiles`/`collectDeploymentDirs`, `overlay-paths.mjs`, `kustomization-patches.mjs`, `http-route.mjs`, `hc-yaml.mjs`, `env-dns.mjs`, `enabled.mjs`). `lint-conftest.mjs:TARGETS`-таблиця (~150 рядків) видалена — discovery через `target.json`.

Виправлено три баги:
1. **kebab→snake namespace**: `style-lint.package_json` → `style_lint.package_json` — rego забороняє дефіс у пакетному ідентифікаторі; виправлено у `run-rule.mjs`.
2. **picomatch array-negation**: `['pos', '!neg']` трактує `!neg` як окремий позитивний матчер — виправлено розділенням positives/negatives у `resolve-target-files.mjs`.
3. **JSDoc glob `*/`**: послідовність `*/` усередині `/** */` блоку завершує коментар і ламає bun-парсер — виправлено в `abie/js/hc_pairing/check.mjs`.

Discovery subdir-priority: концерни у `js/<concern>/` мають пріоритет над legacy `js/check.mjs`, щоб у перехідному стані правило не запускалось двічі. Bump 1.10.0 → 1.11.0.

## Update 2026-05-15 — concern-split усіх 25 правил і видалення legacy-fallback

Усі 25 вбудованих правил переведено на структуру `js/<concern>/check.mjs` у 5 batch-ах:
`adr→hooks`, `bun→layout`, `capacitor→platforms`, `changelog→consistency`, `docker→lint`, `ga→workflows`, `graphql→tooling`, `hasura→internal_urls`, `image-avif→avif_generation`, `image-compress→package_setup`, `js-bun-db→safety`, `js-bun-redis→imports`, `js-lint→tooling`, `js-mssql→deps`, `js-run→runtime`, `k8s→manifests`, `nginx-default-tpl→template`, `npm-module→package_structure`, `php→tooling`, `style-lint→tooling`, `tauri→tooling`, `text→formatting`, `vue→packages`, `rego→applies`, `abie→` (6 концернів).

Виправлено path-depth баги: переміщення `js/check.mjs` → `js/<concern>/check.mjs` збільшує глибину шляху на один рівень і ламає всі відносні `../`-імпорти та `fileURLToPath`-based path-constants. Проявлялося як `ENOENT` у тестах. Зачеплені правила: `adr/js/hooks` (`BUNDLED_HOOKS_DIR`), `js-lint/js/tooling` (`OXLINT_CANONICAL_JSON_PATH`, `KNIP_CANONICAL_JSON_PATH`), `ga/js/workflows` (крос-правило import із `docker/js/lint/check.mjs`).

Legacy-fallback гілку (`js/check.mjs` без підкаталогу) у `discoverCheckableRules` прибрано після завершення повної міграції — залишення fallback створювало ризик silent double-run при регресіях.

**Зачіпає:** `npm/scripts/utils/discover-checkable-rules.{mjs,test.mjs}`, `npm/scripts/utils/run-rule.{mjs,test.mjs}`, `npm/tests/integration-repo-checks.test.mjs`, `npm/tests/check-empty-trees.test.mjs`

## Update 2026-05-15 — виправлення runSync шляху mdc→rules (v1.11.1)

Знайдено і виправлено баг у `npm/bin/n-cursor.js`: функція `runSync()` містила hardcoded шлях `join(effectivePackageRoot, 'mdc')`, але після phase 1–4 rename каталог правил перейменовано на `rules/`. Це спричиняло помилку «Не знайдено каталог правил пакету» при виклику `npx @nitra/cursor` у проєктах, що встановили оновлений пакет. Виправлено на `join(effectivePackageRoot, 'rules')`. Bump 1.11.0 → 1.11.1, пакет опубліковано на npm.
