# Трансформація @7n/llm-lib на тонкого клієнта (napi FFI до llm-cascade)

**Дата:** 2026-07-16
**Статус:** погоджено — готово до реалізації
**Зв'язані документи:** `llm-lib/crates/llm-cascade` (Rust env-контракт); PR [nitra/7n-rules#74](https://github.com/nitra/7n-rules/pull/74) — JS-двійник ACP, ще не змержений; `/Users/vitalii/www/nitra/mt` (референс-архітектура: `crates/mt-napi`, `@7n/mt-darwin-arm64`/`@7n/mt-linux-x64`, `npm/lib/core/native.mjs`)

## 1. Проблема / Мета

PR #74 додав `@7n/llm-lib/acp` (`runAcpAgent`, `llm-lib/lib/acp.mjs`) — повний JS-двійник Rust-крейта `llm-cascade/src/acp.rs`: та сама ACP (Agent Client Protocol, Zed) JSON-RPC логіка, продубльована в двох мовах, синхронізована лише паритетним тестом (`spawn_of_missing_binary_fails_fast_not_hangs` в обох реалізаціях). `llm-cascade` — Rust lib-крейт без `[[bin]]`, зараз лінкується тільки в інший Rust-бінарник монорепо (Tauri desktop); CLI чи napi-міст до нього не існує, тому JS-сторона `@7n/llm-lib` (чистий npm-пакет, споживається через `npx` у довільних репах) не мала іншого шляху, крім повторної реалізації.

Мета — прибрати дублювання: перевести ту частину `@7n/llm-lib`, що має прямий Rust-відповідник у `llm-cascade`, на тонкого клієнта через napi-rs FFI in-process, за зразком уже перевіреної й підтримуваної архітектури `/Users/vitalii/www/nitra/mt`.

## 2. Ухвалені рішення

| # | Питання | Рішення |
|---|---|---|
| А | Механізм тонкого клієнта | napi-rs FFI in-process (не subprocess-бінарник, не WASM, не daemon+socket). Rust-код виконується в тому ж процесі Node через `process.dlopen`; ACP CLI (`cursor`/`codex`/`claude`) спавнить сам Rust-код, як і зараз робить `llm_cascade::acp`. Без зайвого subprocess-хопу Node→бінарник→ACP-CLI. |
| Б | Обсяг переходу | Всі модулі `@7n/llm-lib`, що мають прямий Rust-відповідник у `llm-cascade` — **зараз це рівно три: `acp` (`acp.rs`), `tiers` (`tiers.rs` ↔ `model-tiers.mjs`), `local_cloud` (`local_cloud.rs`)**. Уточнення відносно початкового формулювання "full-scope: весь llm-lib": решта ~15 модулів (`agent-fix.mjs`, `harness.mjs`, `chain.mjs`, `web-tools.mjs`, `telemetry-store.mjs`, `one-shot.mjs` тощо) **не мають Rust-реалізації в `llm-cascade` взагалі** — їх нема чим замінити, вони поза обсягом цієї задачі за визначенням, не за вибором. |
| В | Платформи v1 | Лише `darwin-arm64` + `linux-x64` — дзеркало вже задекларованого обсягу `mt` (`packages/mt-darwin-arm64`, `packages/mt-linux-x64`). Windows, `linux-arm64`, `darwin-x64` — поза обсягом v1. |
| Г | Поведінка без native addon | Hard error, без JS-fallback. Прийнятно саме тому, що платформи v1 закриті — це не регресія для довільного `npx`-консюмера на невідомій платформі, а свідомо задекларована межа підтримки, ідентична до вже прийнятої в `mt`. |
| Д | ROI-аудит перед стартом | Не проводиться — рішення ухвалено без попереднього виміру частоти викликів `runAcpAgent` у проді. |
| Е | Доля PR #74 | Відкрите питання — див. нижче. Не мержити «як є» без явного рішення, оскільки JS-двійник ACP стає мертвим кодом одразу після переходу на napi. |

## 3. Деталі реалізації

### 3.1 Новий Rust-крейт: `llm-cascade-napi`

- За зразком `crates/mt-napi` з `/Users/vitalii/www/nitra/mt`: `napi = { version = "3", features = ["napi8", "serde-json"] }`, `napi-derive`, `napi-build` у `build-dependencies`.
- Тонка обгортка над уже існуючими `llm_cascade::acp::one_shot_acp`, `llm_cascade::tiers::resolve_model`, `llm_cascade::local_cloud::LocalCloud` — конвертація `CascadeError` у JS-сумісну помилку на межі FFI (зберегти текст помилки, не деталізовану структуру — як зараз `.map_err(|e| CascadeError::Provider(e.to_string()))` у самому крейті).
- Розташування: `llm-lib/crates/llm-cascade-napi/`, той самий Cargo workspace, що й `llm-cascade`.

### 3.2 Loader на JS-стороні

- Скопіювати патерн `mt/npm/lib/core/native.mjs` 1:1: fallback-ланцюжок env override (`N_LLM_LIB_NATIVE_ADDON`) → platform-підпакет (`@7n/llm-lib-darwin-arm64` / `@7n/llm-lib-linux-x64`) → dev-fallback на `cargo build --release -p llm-cascade-napi` у `target/release|debug/` → зрозуміла помилка з підказкою, якою командою зібрати локально.
- `acp.mjs` (з PR #74, чи прямо новий, залежно від відкритого питання про PR #74), частина `model-tiers.mjs`, що відповідає `llm_cascade::tiers` — викликають аддон замість власної логіки. Публічна сигнатура експортів **не змінюється**: споживачі (`npm/scripts/skills-cli.mjs` і решта) нічого не помічають.

### 3.3 Дистрибуція

- Нові npm-пакети `@7n/llm-lib-darwin-arm64`, `@7n/llm-lib-linux-x64` — `files: ["llm-cascade-napi.<triple>.node"]`, поля `os`/`cpu` як у `packages/mt-darwin-arm64/package.json`.
- `@7n/llm-lib` отримує `optionalDependencies` на ці два підпакети — без postinstall-download, свідомо для консистентності з уже перевіреним підходом `mt`, не новий патерн.
- CI: дослідити можливість перевикористання вже наявного Tauri-реліз-конвеєра монорепо для крос-платформної Rust-збірки (macOS arm64 + Linux x64) замість нової CI-матриці з нуля — відкрите питання, потребує розвідки перед оцінкою обсягу роботи.

### 3.4 Тести

- Паритетний тест (`llm-lib/tests/acp.test.mjs` vs `llm-cascade/src/acp.rs::tests`) втрачає сенс після переходу — лишається одна реалізація. Замінити на:
  - Rust-тести крейта лишаються як є, включно з `spawn_of_missing_binary_fails_fast_not_hangs`.
  - Новий JS-тест — контрактний: викликає napi-аддон напряму з тими самими `fake-acp-agent`-фікстурами, перевіряє коректне прокидання помилки через FFI-межу, а не повторює ACP-логіку.
- CI smoke-тест "addon завантажується на кожній заявленій платформі" (darwin-arm64, linux-x64) — перевірити, чи вже є еквівалент для `mt-napi`, і скопіювати конфіг, а не винаходити заново.

### 3.5 Критерії приймання

- Нуль дублювання ACP-протокольної логіки — `acp.mjs` більше не містить `ClientSideConnection`/`ndJsonStream`/ручний JSON-RPC.
- `npm/scripts/skills-cli.mjs` (раннер `skill cursor|codex|claude`) працює без змін публічного контракту.
- Виклик через napi не повільніший за поточну/заплановану JS-реалізацію (порівняти latency до/після на реальному виклику).
- Publish-цикл `@7n/llm-lib` (`.changes/`-конвенція) не ламається — native-реліз генерує свій change-файл за тими самими правилами.

## Відкриті питання

- **PR #74:** мержити спочатку як проміжний крок, чи закрити/переробити напряму в бік napi, оминаючи публікацію JS-двійника взагалі? Рекомендація з brainstorm-сесії: не мержити «як є» — прямий перехід на napi робить JS-двійник мертвим кодом одразу після мержу, зайва проміжна ланка.
- CI-перевикористання Tauri-конвеєра для крос-платформної Rust-збірки — потребує розвідки перед оцінкою обсягу роботи.
- Чи `local_cloud.rs`-відповідник у JS існує окремим файлом, чи логіка вже вбудована в `one-shot.mjs`/`model-tiers.mjs` — уточнити на старті реалізації (впливає на межі модуля 3.2).
- macOS code signing/notarization для нового `.node`-бінарника — перевірити, чи можна перевикористати сертифікат/процес з Tauri release-конвенції монорепо, чи потрібен окремий.
