---
session: 45a1997b-a862-4bad-aa42-299f0ed8f886
captured: 2026-06-20T11:32:48+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/45a1997b-a862-4bad-aa42-299f0ed8f886.jsonl
---

На основі транскрипту сесії — два дурабельних ADR-и:

---

## ADR Уніфікація умовних правил (php/rust/docker/k8s/image) у формат `n-cursor lint <rule>`

## Context and Problem Statement

Після основної уніфікації always-active правил (`bun run lint` → `n-cursor lint`) умовні правила (`docker`, `python`, `k8s`, `image-compress`, `php`, `rust`) лишилися з обгортками `lint-<rule>` у `package.json` та CI-командами `bun run lint-<rule>`. Це суперечить єдиній точці входу `n-cursor lint`, задекларованій раніше.

## Considered Options

* Мігрувати всі 6 умовних правил у формат `n-cursor lint <rule>` фазами
* Залишити умовні правила з обгортками як є

## Decision Outcome

Chosen option: "Мігрувати всі 6 умовних правил фазами", because user підтвердив «всі 6» і підтвердив наявність detect-режиму `@nitra/minify-image` (вирішує проблему `image-compress + readOnly`).

Цільовий формат для кожного правила: (1) `js/lint.mjs` з сигнатурою `lint(files, cwd, {readOnly})`; (2) `n-cursor lint <rule>` — єдина точка; (3) CI: `n-cursor lint <rule> --read-only`; (4) видалити `policy/package_json`; (5) оновити `.mdc`.

Фазування за спільним механізмом:
- **Група 2** (незалежні CI): `php`, `rust` — виконано в цій сесії.
- **Група 1** (спільний `bun/js/layout.mjs:RULE_SCRIPTS`): `docker`, `k8s`, `image` — відкладено.

### Consequences

* Good, because transcript фіксує: після php і rust — жодного `bun run lint-<rule>`, CI використовує `n-cursor lint php --read-only` / `n-cursor lint rust --read-only`.
* Good, because `policy/package_json` mandate знято для php і rust — consumer-репо не зобов'язані тримати `lint-<rule>` скрипт.
* Bad, because `docker`, `k8s`, `image-compress` тимчасово лишаються в неуніфікованому форматі до рефактора `checkCursorRuleScripts` (Група 1).

## More Information

Коміти: `f3413d14` (python), `5427cb57` (php: новий `npm/rules/php/js/lint.mjs`), `526f1f61` (rust: новий `npm/rules/rust/js/lint.mjs`). Виявлений нюанс: `docker/js/lint.mjs` вже існував, але експортував `check()` (конформність), а не `lint()` (оркестратор) — тому docker залишений для Групи 1.

---

## ADR Rust CI — cargo-direct без `n-cursor` в workflow

## Context and Problem Statement

При міграції `rust` у формат `n-cursor lint rust` постало питання: мігрувати чи ні `lint_rust_yml` CI-воркфлоу, який вже ганяє `cargo fmt --check` + `cargo clippy` напряму через rustup toolchain (без будь-якої JS-обгортки).

## Considered Options

* Залишити `lint_rust_yml` cargo-direct (не мігрувати на `n-cursor lint rust --read-only`)
* Замінити CI на `n-cursor lint rust --read-only`

## Decision Outcome

Chosen option: "Залишити `lint_rust_yml` cargo-direct", because CI вже використовує правильні read-only команди (`cargo fmt --check`, `cargo clippy` без `--fix`) через rustup, а не JS-toolchain — шар `n-cursor` не додає цінності в цьому контексті.

### Consequences

* Good, because transcript фіксує: `lint_rust_yml` не змінено в `526f1f61` — підтверджена цілеспрямована бездія.
* Neutral, because transcript не містить підтвердження наслідку щодо консистентності з іншими правилами (php CI мігровано на `n-cursor lint php --read-only`, rust — ні).

## More Information

Новий `npm/rules/rust/js/lint.mjs` реалізує обидва режими: `readOnly=true` → `cargo fmt --check --all` + `cargo clippy` (без `--fix`); `readOnly=false` → `cargo fmt --all` + `cargo clippy --fix --allow-staged`. Локальний `n-cursor lint rust` таким чином функціональний; CI workflow свідомо лишився незалежним.
