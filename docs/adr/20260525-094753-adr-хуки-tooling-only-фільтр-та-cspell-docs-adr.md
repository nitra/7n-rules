# Детермінований tooling-only фільтр в ADR-хуках та виключення `docs/adr/**` з cspell

**Status:** Accepted
**Date:** 2026-05-25

## Context and Problem Statement

ADR-хуки `capture-decisions.sh` і `normalize-decisions.sh` запускали LLM навіть після сесій, де змінювалися лише tooling-файли (`.cspell.json`, `docs/adr/*.md`, `CHANGELOG.md`, `package.json#version`). LLM регулярно ігнорував інструкцію `OUTPUT NONE ONLY IF the session is genuinely trivial`. Одночасно `docs/adr/**` не входив до канонічного `ignorePaths` у `.cspell.json`, що призводило до cspell-помилок у машинно-генерованих MADR-документах. Результат — нескінченний цикл: tooling-зміна → новий ADR → cspell-помилка → нова tooling-сесія → новий ADR.

## Considered Options

* Промптова інструкція `OUTPUT NONE ONLY IF` (наявний підхід) без структурного фільтра
* Детермінований bash-фільтр `is_tooling_only_change` в обох хуках + `docs/adr/**` у канонічному `ignorePaths`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Детермінований bash-фільтр + розширення `ignorePaths`", because промптова інструкція недостатньо надійна; детермінований фільтр гарантує пропуск до виклику LLM незалежно від поведінки моделі; один запис у `rules/text/policy/cspell/template/.cspell.json.snippet.json` автоматично поширюється на всі споживацькі репо через rego subset-of перевірку.

### Consequences

* Good, because `capture-decisions.sh` виходить з `exit 0` до виклику `claude -p` при tooling-only сесіях — цикл переривається детерміновано.
* Good, because `ADR_NORMALIZE_SKIP_TOOLING_ONLY` (default `1`) дозволяє споживачам повернутися до старої поведінки виставивши `0`.
* Good, because функції дублюються навмисно — `.claude-template/hooks/` копіюється плоско у споживача, спільний `lib.sh` неможливий без порушення hooks-контракту.
* Bad, because дублювання між `capture-decisions.sh` і `normalize-decisions.sh` потребує синхронного оновлення при зміні allowlist-логіки.

## More Information

- `npm/rules/text/policy/cspell/template/.cspell.json.snippet.json` — додано `"docs/adr/**"` після `"**/k8s/**/*.yaml"`
- `npm/rules/text/policy/cspell/cspell_test.rego` — новий тест `test_deny_missing_docs_adr`; OPA PASS: 44/44
- `npm/rules/text/text.mdc` — version 1.30
- `npm/.claude-template/hooks/capture-decisions.sh` — inline `is_tooling_only_change` + `git_diff_only_version_field`, pre-LLM `exit 0`
- `npm/.claude-template/hooks/normalize-decisions.sh` — ті самі функції + per-draft delete-фільтр
- Allowlist-глоби: `.cspell.json`, `docs/adr/*.md`, `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md`, `*/package.json` (лише якщо diff торкнувся виключно `"version"`)
- Нові тести: `npm/rules/adr/js/tests/capture-decisions-tooling-only.test.mjs`, `npm/rules/adr/js/tests/normalize-decisions-tooling-only.test.mjs`
- ENV документовано в `npm/skills/adr-normalize/SKILL.md` та `npm/rules/adr/adr.mdc` v2.2
- Пакет: `1.17.4 → 1.18.0`

## Update 2026-05-25

Підтверджено на практиці (version 1.18.0): 4/4 інтеграційних тести проходять. `conftest test` на власному `.cspell.json` — 5/5 PASS. `normalize-decisions.sh` видаляє tooling-only чернетку без виклику LLM (перевіряється по `tail .claude/hooks/normalize-decisions.log`).
