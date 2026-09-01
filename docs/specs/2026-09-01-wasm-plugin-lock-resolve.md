# Д1 (резолв wasm-плагінів за lock) — мінідизайн і виміряний обсяг

**Контекст.** Третя колія (дистрибуція) плану
`docs/plans/2026-08-31-full-rust-migration-plan.md` §6/§7 називає Д1 одним
рядком — «резолв за lock» — без форми файлу. Джерело деталі знайдено не в
цьому плані, а в його попереднику
(`docs/plans/2026-08-29-js-rust-migration-completion-plan.md:108`):

> Д1 | `npm/scripts/lib/resolve-plugins.mjs` — резолв за npm-залежностями →
> резолв за lock + OCI reference. Автодетект за файловими сигналами
> лишається: він відповідає «які плагіни потрібні», не «де їх узяти»

і рішенням транспортного репозиторію `nitra/oci-dist`
(`docs/specs/2026-08-30-oci-transport-unification.md`, там же): «lock із
точними SHA-256, digest-first цілісність» — уже вирішено й **реалізовано**
у крейті-залежності `oci-dist-oci` (`=0.3.1`, реєстр `crates-7n`), не тут.
Ця секція фіксує вимір, що з цього рішення застосовне до
`n-rules`-резолверів у ЦЬОМУ репозиторії, і що з Д1 — реальна робота
зараз, а що — Д3/Д4 чи вигадана потреба.

## 1. Що сьогодні джерело правди резолву

`npm/scripts/lib/lint-surface/wasm-plugins.mjs` — резолвер `wasmPlugins`
(НЕ те саме поле, що `resolve-plugins.mjs`/`plugins` — Plugin API v2,
npm-пакети; окремий конвеєр, доккомент модуля). Три форми запису, зростаючий
пріоритет:

1. `{name, file, sha256}` — `npm/wasm-plugins/builtin-pins.json`,
   найнижчий пріоритет, генерується `build-wasm-plugins.mjs` локально, НЕ
   комітиться.
2. `{name, path}` — dev-петля, лише поза CI, без hash-перевірки.
3. `{name, url, sha256}` — канонічний пін дистрибуції: кеш-хіт за
   `<cacheDir>/<sha256>.wasm` → мережевий `fetchFn(url)` → sha256-звірка →
   атомарний запис у кеш.

Усі три — skip-not-crash: відсутній файл/недосяжний `url`/sha256-mismatch
ніколи не кидає, `console.warn` і запис випадає з мапи концернів.

## 2. Чого бракує для «резолву за lock»

Немає жодної форми запису, яка посилається на пін через **пакетну
ідентичність** (`package`+`requirement`), а не на прямий транспортний адрес
(`path`/`url`). Немає файлу lock у цьому репозиторії взагалі — ні формату,
ні читача, ні писача. `oci-dist-oci` уже несе повний формат
(`OciPluginLock`/`OciLockEntry`, схема `nitra.plugin-lock/v1`,
`.oci-dist.lock` — `graph.rs` крейта `=0.3.1`):

```rust
pub struct OciLockEntry {
    pub package: String,      // "n-rules:lang-js"
    pub requirement: String,  // "=0.1.0" — лише точна форма
    pub version: String,      // "0.1.0"
    pub digest: String,       // "sha256:<64 hex>"
    pub reference: String,    // діагностика, не авторитет
    pub signature: Option<String>, // зарезервовано, не звіряється
}
pub struct OciPluginLock { pub schema: String, pub packages: Vec<OciLockEntry> }
```

Крейт також несе `DirectOciResolutionBackend::collect_graph` — але це
резолвер **графу залежностей одного компонента** (WIT-типізовані
`manifest.dependencies` одного гостя, транзитивно), розв'язаний під
композицію компонентів. Наш сценарій інший: `wasmPlugins` — це ПЛОСКИЙ
список незалежних first-party/third-party плагінів, які консюмер хоче
запустити, без графу залежностей між ними. `collect_graph` тут не підходить
напряму (вимагає байти кореневого компонента, яких ще нема — саме це й
резолвиться). Придатний примітив — `fetch_plugin_component(registry,
package, version)` (публічна, `lib.rs:129`): точковий async-фетч одного
релізу з post-download звіркою вбудованої ідентичності.

## 3. Як це співвідноситься з `builtin-pins.json`

Д3 (окрема задача, НЕ ця) явно каже: «`builtin-pins.json` переродити в
lock-формат `oci-dist`, не заводити другий». Тобто lock **замінює**
`builtin-pins.json` — але заміна це робота Д3, яка не може йти раніше Д1
(послідовність зафіксована в
`2026-08-29-js-rust-migration-completion-plan.md:274`: «Д2 → Д1 → Д3 → Д4»).
Зараз (Д1) lock — це ЧЕТВЕРТА, паралельна форма запису `wasmPlugins`, що
співіснує з наявними трьома. Видаляти чи переписувати `builtin-pins.json`
на цьому кроці — вихід за межі Д1, свідомо не робиться.

## 4. Що реально потрібно зараз, що — Д3/Д4, що — вигадана потреба

**Реально потрібно (Д1, робиться цією задачею):**

- Rust: `n-rules plugin fetch` (`crates/rules-cli`) — єдине місце в
  n-rules, де відбувається мережевий OCI-виклик для резолву консюмера.
  Читає/пише `.oci-dist.lock` (формат `oci_dist_oci::OciPluginLock`
  дослівно, без другого формату), кеш-хіт за digest без мережі, кеш-промах
  → `fetch_plugin_component` → перевірка вбудованої ідентичності → lock
  зростає (`insert`, той самий "trust-on-first-use" мотив, що
  `DirectOciResolutionBackend::resolve_dependency`) → публікація в
  `<cache-root>/<sha256-hex>.wasm`.
- JS: четверта форма запису `wasmPlugins`: `{name, package, requirement}`.
  Резолв ЧИСТО з `.oci-dist.lock` + локального кешу — **без мережі в JS
  узагалі** (мотив нижче). Кеш-шлях — той самий `<cacheDir>/<sha256>.wasm`,
  що вже використовує форма `url`+`sha256` (спільний кеш-неймспейс за
  вмістом, не за джерелом — сам файл кешу не знає й не має знати, звідки
  прийшов).

**Свідомо НЕ робиться зараз (не Д1):**

- Мережевий fetch у JS-резолвері для lock-форми. Мотив: (а) задача прямо
  забороняє мережеві звантаження в тестах — стаб для JS `fetch` довелось би
  писати або для реального OCI-протоколу (складно й крихко), або для
  фейкового HTTP-стабу, що просто дублює вже наявний `oci-dist-oci`; (б)
  `crates/rules-cli` вже має живий, протестований (Д2) `oci-dist-oci` в
  графі залежностей — дублювати OCI-клієнт у JS означало б другий
  контур довіри до того самого транспорту, якого спека прямо уникає
  («WKG лишається пакетним менеджером для WIT, OCI — лише транспорт
  артефакта», `oci-dist` README). Тому: мережа — виключно `n-rules plugin
  fetch`, JS — читач лока/кешу, той самий поділ, що вже є між
  `build-wasm-plugins.mjs` (пише) і `wasm-plugins.mjs` (читає).
- `DirectOciResolutionBackend`/повний граф залежностей — не наш сценарій
  (розділ 2).
- Заміна/видалення `builtin-pins.json` — Д3.
- Автоматичний виклик `n-rules plugin fetch` з JS (авто-install) — той
  самий принцип, що вже застосований до `ensure-tool.mjs`/`tools ensure`:
  PATH → кеш → **явний** hard-fail з підказкою команди, не побічний ефект
  резолву.

## 5. Формат lock-файлу в цьому репозиторії

Дослівно `nitra.plugin-lock/v1` (`oci_dist_oci::OciPluginLock`), файл
`.oci-dist.lock` у корені консюмер-репо (той самий `LOCK_FILE_NAME`, що
крейт дефолтить; консюмер МОЖЕ тримати іншу назву — крейт це прямо дозволяє
— але `n-rules` дефолтить саме на неї, без вигаданого другого імені).
Перевизначення шляху — `--lock` (Rust) / `N_RULES_PLUGIN_LOCK_PATH` (JS,
той самий мотив ізоляції тестів, що `N_RULES_PLUGIN_CACHE_DIR`).

JS **не пише** lock ніколи (тільки читає) — писач один, `n-rules plugin
fetch`, той самий поділ обов'язків, що вже є між збіркою й резолвом.

## 6. Форма запису `wasmPlugins` (четверта)

```json
{ "name": "acme-plugin", "package": "acme:plugin", "requirement": "=1.2.0" }
```

`name` — лише diagnostics (той самий канон, що інші три форми).
`package`+`requirement` — ключ пошуку в `.oci-dist.lock`
(`OciLockEntry.package`/`.requirement`, `requirement` МУСИТЬ бути точним
`=X.Y.Z` — те саме обмеження M0, що сам крейт валідує). Відсутній lock,
відсутній запис у ньому, чи запис без кеш-хіта — skip-not-crash: `warn` із
точною командою відновлення (`n-rules plugin fetch --package … --requirement
…`), `null` з мапи.

Форми `wasmPlugins` не конкурують між собою за пріоритет — кожен запис
консюмера декларує РІВНО одну форму (`isValidEntry`/`resolveEntryPath`
дивляться на набір полів запису, не на порядок форм). Єдине існуюче
пріоритетне злиття лишається тим самим, що вже описано в доккоменті модуля:
запис консюмера (будь-якої з трьох явних форм, тепер їх три: `path`/
`url+sha256`/`package+requirement`) з тим самим `name`, що вбудований
`file+sha256`-пін, повністю перекриває builtin-запис (`mergeWithBuiltinEntries`,
за `name`, не за формою).
