---
type: JS Module
title: orchestrate.mjs
resource: npm/skills/taze/js/orchestrate.mjs
docgen:
  crc: 56fd9864
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Оркеструє `taze` для трьох екосистем — npm/bun, Rust (Cargo) і Python (uv) — детерміновано, без LLM: бекап маніфестів → масовий bump (`bunx taze`/`cargo upgrade`/по-пакетний `uv remove`+`uv add --bounds lower`) → diff класифікація major vs minor/patch → прибирання бекапів → Markdown-звіт (`formatReport`). Для КОЖНОГО окремого major-пакета/крейта з diff-у виконує один ізольований, обмежений виклик обраного раннера (`buildDependencyPrompt`/`buildCargoDependencyPrompt`/`buildUvDependencyPrompt` + `callRunner`) — лише перевірка сумісності й рефакторинг, не сам bump. Файл виконує реальні файлові операції (копіює/видаляє бекапи `package.json`/`Cargo.toml`/`Cargo.lock`/`pyproject.toml`/`uv.lock`) і запускає зовнішні команди (`bunx`, `bun`, `cargo`, `uv`, `git`, `find`) — не read-only.

## Поведінка

- **buildDependencyPrompt** / **buildCargoDependencyPrompt** / **buildUvDependencyPrompt** — формують промпт ОДНОГО ітеративного виклику (лише перевірка сумісності й рефакторинг) для одного major-пакета npm/Cargo/uv відповідно.
- **callRunner** — диспетчер одного ітеративного виклику: `pi` — вбудований pi-агент (текст через `deps.out`), `cursor`/`codex` — napi-міст ACP (`@7n/llm-lib/acp`).
- **backupWorkspacePackageFiles** / **cleanupBackups** — бекап і прибирання `package.json` кожного воркспейсу.
- **backupCargoManifests** / **cleanupCargoBackups** — бекап і прибирання кожного `Cargo.toml` + спільного кореневого `Cargo.lock`.
- **backupUvManifest** / **cleanupUvBackups** — бекап і прибирання кореневого `pyproject.toml` + `uv.lock`.
- **findCargoManifests** — знаходить усі `Cargo.toml` поза `node_modules`/`.worktrees`/`target`.
- **findPyprojectManifest** — перевіряє наявність кореневого `pyproject.toml` (uv-конвенція — один файл, не per-package обхід).
- **formatReport** — компонує підсумковий Markdown-звіт (minor/patch, major-оновлення по кожній з трьох гілок, загальний обсяг змін) без окремого LLM-виклику.
- **runTazeOrchestrator** — повний прогін: перевіряє, що `cwd` — ізольований worktree, послідовно обробляє npm-, Rust- (за наявності `Cargo.toml` і `cargo-edit`) і Python-гілку (за наявності `pyproject.toml` і `uv`) — бекап → bump → diff → ізольовані виклики раннера по кожному major-запису → прибирання — і повертає звіт.

## Публічний API

- buildDependencyPrompt / buildCargoDependencyPrompt / buildUvDependencyPrompt — промпт одного major-запису відповідної екосистеми.
- callRunner — виклик обраного раннера (`pi`/`cursor`/`codex`) з одним промптом.
- backupWorkspacePackageFiles / cleanupBackups — бекап/прибирання `package.json` воркспейсів.
- backupCargoManifests / cleanupCargoBackups — бекап/прибирання `Cargo.toml`/`Cargo.lock`.
- backupUvManifest / cleanupUvBackups — бекап/прибирання `pyproject.toml`/`uv.lock`.
- findCargoManifests — список знайдених `Cargo.toml` у репозиторії.
- findPyprojectManifest — список (0 або 1 запис) кореневого `pyproject.toml`.
- formatReport — фінальний Markdown-звіт із результатів усіх трьох гілок.
- runTazeOrchestrator — повна оркестрація taze для npm/bun + Rust + Python.

## Гарантії поведінки

- Виконує файлові операції (копіювання/видалення бекапів) і запускає зовнішні команди — НЕ read-only.
- Перед будь-якою мутацією перевіряє, що `cwd` — ізольований worktree (`assertRunningInWorktree`), інакше кидає виняток.
- Падіння одного пакета/крейта в ізольованому виклику раннера не втрачає прогрес по інших записах.
