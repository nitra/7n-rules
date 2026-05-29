# Детермінований скіп tooling-only сесій та `docs/adr/**` у канонічному cspell ignorePaths

**Status:** Accepted
**Date:** 2026-05-25

## Context and Problem Statement

Після кожної сесії, де змінювалися лише tooling-файли (`.cspell.json`, `docs/adr/*.md`, `CHANGELOG.md`, `package.json#version`), хуки `capture-decisions.sh` та `normalize-decisions.sh` генерували нові ADR-чернетки і передавали їх до LLM. Одночасно `docs/adr/**` не входив до канонічного `ignorePaths` у `.cspell.json`, через що машинно-генеровані MADR-документи перевірялися cspell. Разом ці два факти утворювали нескінченний цикл: tooling-зміна → новий ADR → cspell-помилка у ADR → нова tooling-сесія → новий ADR.

## Considered Options

- Виключно промптова інструкція `OUTPUT NONE ONLY IF the session is genuinely trivial` (наявне рішення)
- Детермінований pre-LLM bash-фільтр `is_tooling_only_change` в обох хуках + `docs/adr/**` у канонічному `ignorePaths`

## Decision Outcome

Chosen option: "Детермінований pre-LLM bash-фільтр + розширення `ignorePaths`", because промптова інструкція виявилася недостатньою — агент у багатьох випадках повертав ADR для tooling-сесій попри `OUTPUT NONE ONLY IF`; детермінований bash-фільтр гарантує skip до виклику LLM незалежно від поведінки моделі.

### Consequences

- Good, because tooling-only сесії більше не генерують ADR-чернеток і не кличуть LLM.
- Good, because `docs/adr/**` у канонічному `ignorePaths` автоматично поширюється на споживацькі репо через `npx @nitra/cursor fix text`.
- Good, because `ADR_NORMALIZE_SKIP_TOOLING_ONLY=0` (default `1`) дозволяє споживачу повернутися до старої поведінки.
- Bad, because bash-функції навмисно дублюються в обох хуках — `.claude-template/hooks/` копіюється плоско у споживацькі репо без спільного `lib.sh`; будь-яка зміна allowlist-логіки вимагає синхронного оновлення обох файлів.
- Neutral, because bash 3.2 (macOS) без `mapfile` та асоціативних масивів підтверджує виправданість inline-підходу.

## More Information

- `npm/rules/text/policy/cspell/template/.cspell.json.snippet.json` — додано `"docs/adr/**"` після `"**/k8s/**/*.yaml"`
- `npm/rules/text/policy/cspell/cspell_test.rego` — новий тест `test_deny_missing_docs_adr`; opa PASS 44/44; conftest 5/5 PASS
- `npm/rules/text/text.mdc` → version `1.30`
- `npm/.claude-template/hooks/capture-decisions.sh` — inline `is_tooling_only_change` та `git_diff_only_version_field`; pre-LLM `exit 0` з логом `skipping ADR capture: tooling-only session`
- `npm/.claude-template/hooks/normalize-decisions.sh` — ті самі функції + per-draft delete-фільтр; ENV `ADR_NORMALIZE_SKIP_TOOLING_ONLY`
- Allowlist-глоби: `.cspell.json`, `docs/adr/*.md`, `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md`, `*/package.json` (лише якщо diff торкнувся виключно ключа `"version"`)
- Нові тести: `capture-decisions-tooling-only.test.mjs`, `normalize-decisions-tooling-only.test.mjs` — 4/4 PASS
- `npm/rules/adr/adr.mdc` v2.2, `npm/skills/adr-normalize/SKILL.md` — документація ENV та діагностика
- Версія пакета: `1.17.4 → 1.18.0`
