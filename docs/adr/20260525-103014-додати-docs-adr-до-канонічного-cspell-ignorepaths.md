---
session: 2ce74495-ae37-461c-a696-487f7361df48
captured: 2026-05-25T10:30:14+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/2ce74495-ae37-461c-a696-487f7361df48.jsonl
---

## ADR Додати `docs/adr/**` до канонічного cspell `ignorePaths`

## Context and Problem Statement
ADR-чернетки, що генеруються `capture-decisions.sh`, містять машинний текст (session-транскрипти, власні назви) і регулярно не проходять `cspell`. Кожна правка `.cspell.json` для усунення помилки ставала новою "змістовною" сесією і породжувала ще один ADR-драфт — утворюючи нескінченний цикл.

## Considered Options
* Додати `docs/adr/**` у `rules/text/policy/cspell/template/.cspell.json.snippet.json` (канонічний snippet)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `docs/adr/**` у канонічний snippet", because rego вже перевіряє `ignorePaths` як subset-of `data.template.snippet.ignorePaths`, тому новий елемент автоматично стає обов'язковим у всіх споживацьких репо без зміни логіки rego.

### Consequences
* Good, because `npx @nitra/cursor fix text` самостійно допише `"docs/adr/**"` у споживача — нульові ручні зусилля.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/rules/text/policy/cspell/template/.cspell.json.snippet.json`, `npm/rules/text/policy/cspell/cspell_test.rego` (додано `test_deny_missing_docs_adr`), `npm/rules/text/text.mdc` (version 1.30, пояснювальний абзац). Перевірка: `opa test npm/rules/text/policy/` → 44/44 PASS; `conftest test` на власному `.cspell.json` → 5/5 PASS.

---

## ADR Детермінований pre-LLM фільтр tooling-only сесій у capture/normalize хуках

## Context and Problem Statement
`capture-decisions.sh` та `normalize-decisions.sh` покладалися виключно на LLM-інструкцію "OUTPUT NONE ONLY IF the session is genuinely trivial". На практиці LLM часто ігнорував цю інструкцію та генерував ADR навіть після правки `.cspell.json` або `CHANGELOG.md`, що поновлювало цикл.

## Considered Options
* Bash-рівневий pre-LLM фільтр `is_tooling_only_change` inline у кожному хук-скрипті
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Bash-рівневий pre-LLM фільтр inline у кожному хук-скрипті", because детермінований фільтр гарантовано перервує цикл до виклику LLM; функція дублюється навмисно — `.claude-template/hooks/` копіюється до споживача плоско, виносити в окремий файл неможливо.

### Consequences
* Good, because transcript фіксує очікувану користь: `capture-decisions.sh` виходить з `exit 0` та пише `skipping ADR capture: tooling-only session` у лог ще до виклику LLM; нові інтеграційні тести 4/4 підтверджують поведінку.
* Good, because `ADR_NORMALIZE_SKIP_TOOLING_ONLY=0` (default `1`) дозволяє споживачу повернутись до старої поведінки.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Allowlist-глоби: `.cspell.json`, `docs/adr/*.md`, `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md` (будь-який workspace), `*/package.json` — лише якщо diff торкнувся виключно ключа `"version"` (перевірка через допоміжну функцію `git_diff_only_version_field`). Скрипти: `npm/.claude-template/hooks/capture-decisions.sh`, `npm/.claude-template/hooks/normalize-decisions.sh`. Нові тести: `npm/rules/adr/js/tests/capture-decisions-tooling-only.test.mjs`, `npm/rules/adr/js/tests/normalize-decisions-tooling-only.test.mjs`. ENV: `ADR_NORMALIZE_SKIP_TOOLING_ONLY` документовано в `npm/skills/adr-normalize/SKILL.md` та `npm/rules/adr/adr.mdc` (version 2.2). Версія пакета: `1.17.4 → 1.18.0`.
