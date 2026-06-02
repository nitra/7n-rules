---
session: 37e16d83-9fec-4e35-8975-e1f75f254fe3
captured: 2026-06-02T07:17:44+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/37e16d83-9fec-4e35-8975-e1f75f254fe3.jsonl
---

Схоже, AskUserQuestion теж заблокований. Скажи мені — як краще продовжити:

1. **Дай підтвердження** на `git add .` у наступному prompt (Claude Code запитає у тебе при виконанні)
2. **Закомітуй вручну** у worktree:
```
cd .worktrees/feat-coverage-changed-gate/npm
git add .
git commit -m "feat(coverage): scope flow-турнікет на змінені файли через --changed"
git push -u origin feat/coverage-changed-gate
```
3. **Додай дозвіл** через `/update-config` — щоб `git add` більше не питало дозволу в цьому проєкті.

Усі 13 файлів готові до коміту (148 тестів ✓, lint exit 0 ✓).

---

**Адмін-нотатка**: Я збережу цей ADR-рівень рішення в memory (дозволяє уникнути повторного аналізу в майбутніх сесіях).

## ADR scope flow-турнікета через `--changed`

## Context and Problem Statement
`DEFAULT_GATES` у `flow verify` запускав `n-cursor coverage` без scope — vitest ганяв усі тести всіх workspace, Stryker мутував весь `src`. На кожному кроці TDD-циклу (`flow run --autonomous`) це повторювалося незалежно від того, скільки файлів змінено.

## Considered Options
* Видалити coverage-гейт із турнікета повністю (перенести лише на `release`)
* Scope coverage-гейт через `--changed` (перевіряти лише файли, змінені від `base_commit`)

## Decision Outcome
Chosen option: "Scope через `--changed`", because користувач хотів щоб flow перевіряв лише змінені файли і однаково обробляв закомічені та незакомічені зміни.

### Consequences
* Good, because `flow verify` більше не ганяє весь Stryker на кожному кроці — лише файли від `base_commit` через `git diff <base>` (покриває committed + uncommitted однаково).
* Bad, because порожній scope після rebase → fail-closed (throws замість fallback на HEAD) — свідоме рішення, але потребує наявності `.flow.json#metadata.base_commit` для роботи поза ручним `flow init`.

## More Information
- `npm/scripts/lib/changed-files.mjs`: новий `collectChangedFilesSince(base, cwd)` — fail-closed при недосяжному `base`
- `npm/scripts/dispatcher/lib/reviewer.mjs`: `DEFAULT_GATES` coverage cmd → `['npx','@nitra/cursor','coverage','--changed']`
- `npm/rules/test/coverage/coverage.mjs`: `--changed` резолвить base зі `.flow.json#metadata.base_commit`; порожній scope = exit 0, COVERAGE.md не перезаписується
- `npm/rules/js-lint/coverage/coverage.mjs`: `scopeToRoot` — vitest `--changed <base>`, Stryker `--mutate <changed-js>`; root без змінених JS — skip
- `npm/rules/rust/coverage/coverage.mjs`: skip crate коли нема змінених `.rs` файлів
