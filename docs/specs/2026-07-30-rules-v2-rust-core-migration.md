# `@7n/rules` v2 — інкрементальна міграція runtime-ядра з JS у Rust

**Дата:** 2026-07-30
**Статус:** план — погоджені рішення зафіксовано, фаза 1 готова до реалізації
**Зв'язані документи:** `docs/specs/2026-07-16-llm-lib-napi-thin-client-design.md`,
`docs/specs/2026-07-23-llm-cascade-single-source-spec.md`,
`npm/scripts/lib/changed-files.mjs`, `npm/scripts/lib/auto-worktree.mjs`,
`llm-lib/lib/internal/native.mjs`, `.cursor/rules/n-worktree.mdc`

## 1. Мета

v2 проєкту `@7n/rules`: Rust-ядро (`rules-core`), яке з часом бере на себе
deterministic rule engine, Git-запити, filesystem scan, diagnostics, cache і fix
plans, та напряму використовує крейт `llm-lib`. Bun/Node лишається CLI, plugin
host (Plugin API v2) і адаптером до зовнішніх ecosystem tools. Міграція —
інкрементальна: по одному вимірюваному use case, кожен із behavior-parity-гейтом
до видалення JS-гілки.

## 2. Цільова архітектура

```text
Bun/Node CLI + JS plugin host + external-tool adapters
                         ↓ N-API (sync) / versioned JSON DTO
rules-napi (thin binding, napi 3, окремий cdylib від llm-lib-napi)
                         ↓
rules-core (Rust: policy, scan, Git-запити, diagnostics, fix plans, cache)
      ├─ mt-core (git dep nitra/mt-rust) — worktree lifecycle + porcelain compat-межа
      ├─ gix 0.86 (пін вирівняно з mt-rust) — commit-graph read/query
      └─ llm-lib (path dep, підключається лише з LLM-фазою)
```

## 3. Зафіксовані рішення

- **Р1 — без JS-fallback.** Native-межа як у `llm-lib` (spec 2026-07-16):
  darwin-arm64 + linux-x64, поза ними — hard error з підказкою. Відкат — лише
  версійний пін пакета, без runtime-перемикача. Наслідок: платформна межа
  переходить з lazy LLM-флоу на гарячий шлях (delta-lint, Stop-hook) — це
  breaking change і привід для мажора `2.0.0` (потребує ручного bump поза
  `release.maxBump: "minor"` у `npm/package.json`).
- **Р2 — синхронна N-API поверхня.** Споживачі викликають функції синхронно
  (`plugins/lang-js/coverage-provider/lib/comment-only.mjs:41`), тож
  `rules-napi` експортує sync-функції; feature `tokio_rt` не потрібна (відміна
  від `llm-lib-napi`).
- **Р3 — worktree виключно через `mt-core`.** Конвенція репо вже mt-орієнтована
  (`n-worktree.mdc`, `auto-worktree.mjs` спавнить `mt worktree`); міграція — це
  заміна spawn зовнішнього `mt`-бінарника на прямі виклики крейта. Власних
  `git worktree`-викликів у `rules-core` немає (дзеркало заборони довільного
  porcelain у `mt-core/src/git/compat.rs`).
- **Р4 — gix пін 0.86,** синхронно з mt-rust: одна версія в дереві залежностей.
- **Р5 — конфіг-парсинг лишається в JS.** `.n-rules.json`/`.n-cursor.json`
  (git policy) читає JS-шар; native отримує готові входи
  (`integrationBranches`/`baseRef`). Одне джерело правди, вузька parity-поверхня.
- **Р6 — JS-фасади незмінні.** `changed-files.mjs` та інші модулі
  `@7n/rules/scripts/*` — публічна plugin-поверхня; сигнатури не змінюються,
  native підключається всередині. Plugin API v2 не зачіпається.
- **Р7 — розташування і версії крейтів.** Root-level `crates/rules-core`,
  `crates/rules-napi` (+ `members` у `Cargo.toml`). `release.mjs` Cargo.toml як
  manifest не знає — версії крейтів lockstep із `@7n/rules` через CI-крок
  (аналог «Sync platform versions» у `npm-publish.yml`), окремо не релізяться.
- **Р8 — platform-пакети** `@7n/rules-darwin-arm64` / `@7n/rules-linux-x64` за
  зразком `llm-lib/packages/*`: `files` з одним `.node`, `os`/`cpu`,
  `optionalDependencies` в `npm/package.json`, mirror-тест консистентності
  (аналог `llm-lib/tests/native-packages.test.mjs`).
- **Р9 — `llm-lib` не підключається до LLM-фази.** Git use cases його не
  потребують; залежність декларується архітектурою, не Cargo.toml фази 1.
- **Р10 — versioned JSON DTO.** Serde-структури в `rules-core` з константою
  версії контракту; JS-loader звіряє версію при завантаженні (enforcement-точка
  за зразком `requiresPluginApi`).

## 4. Фази

### Фаза 1 — фундамент + `resolveChangedBase` (перший вимірюваний use case)

Перший мігрований use case — `resolveChangedBase` з
`npm/scripts/lib/changed-files.mjs:63`: чисті read-only запити до commit-graph
(`merge-base`, `--is-ancestor`, `rev-parse --verify`), вихід — один sha або
null, parity — побайтова рівність. Енумерація файлів (`collectChangedFiles*`)
свідомо відкладена (фаза 3): status/untracked — найризикованіша для parity
частина.

Кроки:

1. **T1 — крейти й Rust-CI.** `crates/rules-core` + `crates/rules-napi` у
   workspace `members`; розширити `lint-rust.yml` до workspace-wide
   fmt/clippy (зараз `working-directory` на один крейт, коментар про відсутній
   root Cargo.toml застарілий) і **додати `cargo test`** (зараз не запускається
   ніде).
2. **T2 — binding і loader.** `rules-napi`: napi 3 (`napi8`, `serde-json`, без
   `tokio_rt`), sync-функції, окремий cdylib. JS-loader
   `npm/scripts/lib/native.mjs` за 4-ступеневим зразком
   `llm-lib/lib/internal/native.mjs`: `N_RULES_NATIVE_ADDON` →
   `@7n/rules-<platform>` → dev-fallback `target/{release,debug}` → hard error
   з підказкою `cargo build --release -p rules-napi`. Звірка версії DTO (Р10).
3. **T3 — `resolve_changed_base` у `rules-core`.** Вхід: `cwd`,
   `candidates: string[]` (розгорнуті `origin/<name>` + `<name>`) або явний
   `baseRef`; вихід: sha «найновішого» merge-base або null; fail-closed
   верифікація base (`^{commit}`-семантика). На старті — верифікація, що
   merge-base/is-ancestor доступні в gix 0.86; якщо ні — рішення: підняти пін
   синхронно з mt-rust або тимчасово porcelain-виклик у стилі `compat.rs` за
   тим самим DTO.
4. **T4 — фасад.** `changed-files.mjs`: `resolveChangedBase` делегує в native
   (розгортання policy-кандидатів лишається в JS, Р5); після зеленого parity
   (T5) JS-гілка обчислення merge-base видаляється в тому ж PR.
5. **T5 — тести-parity-гейт.** Чинний
   `npm/scripts/lib/tests/changed-files.test.mjs` (реальні `git init`-фікстури)
   після делегування автоматично тестує native через фасад — без
   параметризації на два бекенди. Додати кейси: linked worktree
   (`.claude/worktrees/...` — режим, у якому працює сам репо), shallow clone
   (типовий consumer-CI з `fetch-depth: 1` — відтворити ту саму деградацію,
   що в JS), detached HEAD, відсутній `origin/*`. Прогін під bun
   (`bun run --bun vitest run`) — addon має вантажитись через `process.dlopen`
   під bun.
6. **T6 — CI/release.** `test.yml`: + `dtolnay/rust-toolchain` +
   `Swatinem/rust-cache` + `cargo build --release -p rules-napi` перед vitest
   (інакше suite падає на hard error loader-а). `npm-publish.yml`: гейт
   `native` у job `changes` — додати `crates/` до диф-шляхів; матриця
   `build-native` — другий артефакт `rules-napi.<triple>.node`; platform-пакети
   (Р8) публікуються перед `@7n/rules`; lockstep-sync крок для
   `@7n/rules` ↔ `@7n/rules-<platform>`.
7. **T7 — доки.** Файлові доки (`doc-files`) для нових/змінених файлів
   (`.rs` — lang-rust, `.mjs` — lang-js); повідомлення помилки loader-а —
   максимально чітке (дірка DX: свіжий клон без cargo-збірки → падають і
   тести, і хуки кожної сесії).

Критерії приймання фази 1:

- `changed-files.test.mjs` (розширений) зелений через native під bun і node;
- обидві платформи збираються в CI, platform-пакети публікуються lockstep;
- JS-обчислення merge-base видалене; сигнатури фасаду незмінні;
- `cargo test` + workspace-wide clippy/fmt у CI.

### Фаза 2 — worktree-взаємодія через `mt-core`

Вводить git dep на `nitra/mt-rust` і обкатує крос-репо-механіку на фазі
з мінімальним parity-ризиком (той самий код mt-core з обох боків межі).

- Git dependency з tag-піном (конвенція тегів на боці mt-rust — завести, напр.
  `mt-core-v<semver>`; пін по тегу/rev, не по гілці). CI-auth для cargo git
  fetch приватного репо (`git-fetch-with-cli` + insteadOf-rewrite на
  `GITHUB_TOKEN`) у `test.yml` і `npm-publish.yml`.
- `auto-worktree.mjs`: spawn `mt worktree create/remove` → виклики
  `rules-core` → `mt_core::worktree` (`create_dev_worktree`,
  `remove_worktree`, `list_worktrees`, `parse_worktree_entries`,
  `worktree_inventory`, `prune_worktrees`, `set_branch_description`).
  Зникає runtime-передумова «встановлений `mt` CLI» для auto-флоу.
- Санітизація імені `<current-branch>-<suffix>`: прийняти `mt_core::sanitize`
  як єдину (зараз JS робить лише `replaceAll('/', '-')`).
- Лишається в JS (mt-core про це знати не повинен): виняток
  `.claude/worktrees/` як приватної директорії харнесу, гейт на брудне дерево
  з TTY-confirm і `npx @7n/n push`, `bun install` bootstrap,
  `bringChangesBackToOriginal`.
- `n-worktree.mdc` не змінюється — конвенція та сама, міняється механіка.
- Оновлення піна mt-core — окремий кейс у lang-rust taze-провайдері
  (git-dep bump, не semver з crates.io); мінімум — зафіксувати ручний флоу.

### Фаза 3 — енумерація changed files

`collectChangedFiles` / `collectChangedFilesSince`: `git diff --name-only
--diff-filter=ACMR` + `ls-files --others --exclude-standard`. Стартувати
допустимо з porcelain-викликів усередині `rules-core` (вузька дозволена межа за
зразком `compat.rs`), gix-status підтягнути пізніше без зміни DTO — саме тут
gix-parity (exclude-standard, rename-детекція, submodules) найважча. Фільтр
worktree-checkout-шляхів (`isWorktreeCheckoutPath`) переїжджає в Rust разом з
енумерацією; mirror-тест на семантику regex
(`(?:^|\/)(?:\.worktrees|\.claude\/worktrees)\//`).

### Фаза 4 — filesystem scan і cache

`walkDir`-контур (globby + `ALWAYS_IGNORE`) → `rules-core`; узгодження
ignore-семантики — окремий parity-гейт. Обсяг cache-контуру потребує
передпроєктного дослідження (окремий scoping перед фазою).

### Фаза 5 — diagnostics DTO + перші детерміновані правила

Модель діагностик (rule id, file, range, severity, message, fix-ref) як DTO;
пілотне детерміноване правило мігрує цілком. Співіснування, не fallback:
оркестратор диспатчить кожне правило або в native, або в JS — до повного
перенесення. Порядок правил — від чистих текстових/структурних перевірок без
зовнішніх tool-залежностей.

### Фаза 6 — fix plans + `llm-lib` напряму

Fix plans як DTO поверх diagnostics. Перший LLM-залежний флоу (кандидати:
adr-normalize, doc-files) підключає `llm-lib` як path dep у `rules-core` —
драбина ескалації компонується в Rust з примітивів крейта (канон spec
2026-07-23), JS-шар `@7n/llm-lib` для цього флоу виводиться.

## 5. Ризики

1. **Платформна межа на гарячому шляху** (Р1): consumer-репо поза
   darwin-arm64/linux-x64 втрачають lint/hooks, не лише LLM. Мітигації: мажор
   `2.0.0` + явна нотатка в CHANGELOG; дешеве розширення матриці
   (linux-arm64-gnu — один рядок у `npm-publish.yml`).
2. **Dev/CI-залежність від cargo-збірки**: без локальної збірки падають тести
   і хуки. Мітигації: чітка помилка loader-а; відкрите питання П2.
3. **Sync-контракт binding-а** (Р2): порушення ламає синхронних споживачів у
   плагінах у runtime, компіляція не ловить. Мітигація: фасадні тести
   викликають функції синхронно.
4. **gix-parity на working-tree операціях** — обмежено фазою 3, зі стартом
   через porcelain.
5. **Крос-репо coupling з mt-rust** (фаза 2+): зміни worktree-логіки можуть
   вимагати узгоджених PR у два репо. Мітигації: вузька межа (лише worktree
   lifecycle), tag-пін, синхронний bump через taze-флоу.
6. **Версійний skew `mt` CLI ↔ залінкований mt-core**: стан живе в git, але
   формат inventory/порцеляновий парсер має бути з одного піна.
7. **Подвоєння lockstep-логіки publish**: другий addon у `npm-publish.yml`;
   помилка порядку publish (платформні → основний) ламає install у споживачів.
   Мітигація: mirror-тест консистентності (Р8).

## 6. Відкриті питання

- **П1 — merge-base у gix 0.86**: верифікувати на T3; якщо відсутній —
  синхронний із mt-rust bump піна або тимчасовий porcelain.
- **П2 — DX дев-петлі без збірки**: обмежитись помилкою з підказкою чи додати
  auto-build/ensure-перевірку аддона (ensure-tool-контур).
- **П3 — розширення платформної матриці** (linux-arm64-gnu, darwin-x64) — до
  чи після релізу 2.0.0.
- **П4 — cache-контур фази 4**: інвентаризація наявних кешів і рішення про
  формат — окремий scoping.

## 7. Статус виконання (2026-07-30)

Фази 1–4a і пілот фази 5 виконані; всі фазові PR у main (#312 re-land фази 1,
#315 фаза 2, #317 фаза 3, #319 фаза 4a).

- **П1 закрито**: merge-base доступний у gix 0.86 (`features = ["revision",
  "sha1"]`); porcelain-fallback знадобився лише для shallow-репо (gix ігнорує
  межу `.git/shallow` — parity-розрив зловив тест фази 1, fail-closed
  поведінку відновлено).
- **П4 закрито**: on-disk кешів FS-скану не існує; `walk-cache` мертвий у
  runtime (окремий cleanup); живі кеші (lock/dedup, plugin-resolve, LLM)
  лишаються в JS. Спільний скан-кеш для `--full` свідомо не вводився —
  концерни фіксять файли посеред прогону.
- **Реліз-контур**: інцидент 1.59.0/1.59.1 (platform-пакети не вийшли —
  скасований build-native + гейт «диф цього пуша») закрито fail-closed
  registry-гейтом (#314); перша публікація нових platform-пакетів через OIDC
  неможлива — bootstrap вручну, далі trusted publisher. Steady-state
  підтверджений релізами 1.60.0/1.61.0.
- **Фаза 5 (пілот)**: diagnostics DTO віддзеркалює чинну `LintViolation`
  (без top-level `range` — `data.line` споживають fix-eslint і
  collateral-veto; канонізація range — окремий крок). Реєстр native-концернів
  живе в Rust (`NATIVE_CONCERNS` + `listNativeConcerns`), dispatch-гілка в
  `runConcernDetector` перед резолвом `main.mjs`; `CONTRACT_VERSION = 2`.
  Пілоти — лише core-owned (`text/forbidden-prettier`,
  `security/sample_secret`, `k8s/dremio_logging`); плагінні концерни не
  мігруються до окремого рішення про крос-пакетний контракт (Plugin API).
