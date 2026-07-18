---
type: JS Module
title: orchestrate.mjs
resource: npm/skills/taze/js/orchestrate.mjs
docgen:
  crc: 95e6d312
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Оркеструє taze детерміновано, без LLM для службових кроків: бекап маніфестів → масовий bump → diff-класифікація major vs minor/patch → прибирання бекапів → Markdown-звіт. Для КОЖНОГО окремого major-пакета з diff-у виконує один ізольований, обмежений виклик обраного раннера — лише перевірка сумісності й рефакторинг, не сам bump. npm/bun-гілка вбудована; решта екосистем — `EcosystemProvider`-и (контракт `@7n/rules/plugin-api`), завантажені з плагінів (`@7n/rules-lang-rust`, `@7n/rules-lang-python`, …; extension-point `taze`) — вбудованих провайдерів немає. Файл виконує реальні файлові операції (бекапи) і запускає зовнішні команди (`bunx`, `bun`, `git`, команди провайдерів) — не read-only.

## Поведінка

- **buildDependencyPrompt** — формує промпт ОДНОГО ітеративного виклику (лише перевірка сумісності й рефакторинг) для одного major-пакета npm/bun.
- **callRunner** — диспетчер одного ітеративного виклику: `pi` — вбудований pi-агент (текст через `deps.out`), `cursor`/`codex` — napi-міст ACP (`@7n/llm-lib/acp`).
- **backupWorkspacePackageFiles** / **cleanupBackups** — бекап і прибирання `package.json` кожного воркспейсу.
- **loadPluginTazeProviders** — завантажує провайдерів з активних плагінів: `.n-rules.json`/автодетект → `resolvePlugins` (плагін доставляється автоматично при першому запуску) → handler-модулі extension-point `taze` → валідація `assertEcosystemProvider`; битий плагін — warning і пропуск, не провал.
- **formatReport** — компонує підсумковий Markdown-звіт (npm-гілка + секція на кожну екосистему з manifests; екосистема без manifests — тиша) без окремого LLM-виклику.
- **runTazeOrchestrator** — повний прогін: перевіряє, що `cwd` — ізольований worktree, виконує npm-гілку, далі кожного провайдера наскрізь (detect → available → backup → bump → diff → ізольовані виклики раннера по major-записах → cleanup) і повертає звіт.

## Публічний API

- buildDependencyPrompt — промпт одного npm-major-запису.
- callRunner — виклик обраного раннера (`pi`/`cursor`/`codex`) з одним промптом.
- backupWorkspacePackageFiles / cleanupBackups — бекап/прибирання `package.json` воркспейсів.
- loadPluginTazeProviders — валідні EcosystemProvider-и з handler-модулів плагінів.
- formatReport — фінальний Markdown-звіт із npm-результатів і записів екосистем.
- runTazeOrchestrator — повна оркестрація taze; `deps.ecosystemProviders` повністю замінює список провайдерів (для тестів).

## Гарантії поведінки

- Виконує файлові операції (копіювання/видалення бекапів) і запускає зовнішні команди — НЕ read-only.
- Перед будь-якою мутацією перевіряє, що `cwd` — ізольований worktree (`assertRunningInWorktree`), інакше кидає виняток.
- npm/bun-гілка активна лише за кореневим package.json: на чисто-Python/Rust репо вона тихо пропускається (лог + без npm-рядків у звіті), а не валить прогін через `bun install → exit 1`.
- Виняток усередині одного провайдера (bump/diff/команда) не зупиняє інших — фіксується в `error` запису екосистеми й у звіті; `ok` результату тоді false.
- Падіння одного пакета в ізольованому виклику раннера не втрачає прогрес по інших записах.
