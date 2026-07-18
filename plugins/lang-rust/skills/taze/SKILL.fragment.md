## Rust-гілка (`@7n/rules-lang-rust`)

Екосистемна гілка Rust/Cargo для taze — виконує кроки 1–8 скелета у Rust-варіанті.

### Детекція і передумови

```bash
find . -name Cargo.toml -not -path "*/node_modules/*" -not -path "*/.worktrees/*" -not -path "*/.claude/worktrees/*" -not -path "*/target/*"
```

Якщо список непорожній — гілка активна. Потрібен `cargo-edit` (`cargo install cargo-edit`, дає команду `cargo upgrade`): без нього major-бампи неможливо застосувати детерміновано (голий `cargo update` піднімає лише semver-сумісні версії) — гілка пропускається без блокування інших, а знайдені `Cargo.toml` перелічуються у звіті як такі, що потребують ручного прогону.

### Крок 1 — стартовий стан

Для кожного знайденого `Cargo.toml` (включно з кореневим, якщо є) і `Cargo.lock` поруч із ним:

```bash
cp Cargo.toml Cargo.toml.taze-bak
cp Cargo.lock Cargo.lock.taze-bak   # і сусідні lock-и незалежних крейтів (Tauri src-tauri мають власні)
```

### Крок 2 — оновлення

Per-manifest (репо може не мати кореневого Cargo.toml — Tauri-крейти в підтеках):

```bash
cargo upgrade --incompatible allow --manifest-path <шлях/Cargo.toml>
cargo update --manifest-path <шлях/Cargo.toml>
```

- `cargo upgrade` (з `cargo-edit`) переписує вимоги версій на останні; `--incompatible allow` явно дозволяє перетинати major-межу (аналог `-r latest` у taze) — без цього флага incompatible-оновлення за замовчуванням ігноруються.
- `cargo update` після цього синхронізує `Cargo.lock` з новими вимогами.

### Крок 3 — major-оновлення

`collectCargoDiff` (taze-провайдер плагіна) робить класифікацію детерміновано: парсить кожен `Cargo.toml.taze-bak`/`Cargo.toml` через `smol-toml`, порівнює `dependencies`/`dev-dependencies`/`build-dependencies` (рядок чи `{ version = "...", features = [...] }`), класифікує за правилом caret-семантики — Cargo-скорочені версії (`"1"`, `"0.4"`) трактуються як відсутні компоненти = 0. Ручний прогін поза оркестратором — той самий принцип: `diff Cargo.toml.taze-bak Cargo.toml` по рядках `<name> = "<version>"`.

### Крок 4 — breaking changes

Адресу репозиторію взяти з поля `repository`/`documentation` крейта на `crates.io` (`https://crates.io/crates/<name>`) або з `[package.metadata]`; CHANGELOG зазвичай у `CHANGELOG.md` репозиторію або в GitHub Releases. Якщо немає — різниця по публічному API (`pub fn`/`pub struct`/`pub trait`) між закешованою старою версією (`~/.cargo/registry/src/*/<name>-<old-version>/`) і новою через `diff -r src/`.

### Крок 5 — сумісність з кодом

```bash
rg -n "<use-шлях|функція|макрос>" --type rust
```

Та сама класифікація сумісно/несумісно, що й у npm-гілці.

### Крок 6 — перевірки після правок

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

### Крок 7 — прибирання

```bash
rm Cargo.toml.taze-bak Cargo.lock.taze-bak
```

(І бекапи по кожному маніфесту/сусідньому lock-у, якщо створювались.)

### Крок 8 — звіт

Окрема секція **Rust-крейти** (оновлено / major / зрефакторено / потребує ручного втручання), у **Стан перевірок** — окремо `cargo fmt` / `cargo clippy` / `cargo test`.

### Примітка

`cargo upgrade --incompatible allow` редагує `Cargo.toml` навіть для залежностей без breaking changes у API — завжди звіряй крок 4 (CHANGELOG) перед тим, як вважати оновлення безпечним, а не лише факт успішної компіляції.
