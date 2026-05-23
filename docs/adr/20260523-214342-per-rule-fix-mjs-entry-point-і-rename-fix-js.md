---
session: c3ee6058-20c8-4e12-8aef-0a36a996fed5
captured: 2026-05-23T21:43:42+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/c3ee6058-20c8-4e12-8aef-0a36a996fed5.jsonl
---

I'm using the finishing-a-development-branch skill to complete this work.
[user]
2
[assistant]
[tool: Bash] {"command":"cd /Users/vitaliytv/www/nitra/cursor/.claude/worktrees/per-rule-fix-mjs-entry-point && git push -u origin worktree-per-rule-fix-mjs-entry-point 2>&1","description":"Push branch to origin","timeout":60000}
[user]
[tool_result] Enumerating objects: 283, done.
Counting objects: 100% (283/283), done.
Delta compression using up to 11 threads
Compressing objects: 100% (182/182), done.
Writing objects: 100% (218/218), 50.69 KiB | 8.45 MiB/s, done.
Total 218 (delta 107), reused 2 (delta 0), pack-reused 0 (from 0)
remote: Resolving deltas: 100% (107/107), done.
To github.com:nitra-labs/cursor.git
* [new branch]      worktree-per-rule-fix-mjs-entry-point -> worktree-per-rule-fix-mjs-entry-point
Branch 'worktree-per-rule-fix-mjs-entry-point' set up to track remote 'origin/worktree-per-rule-fix-mjs-entry-point'.
[assistant]
[tool: Bash] {"command":"gh pr create --title \"feat(npm): per-rule fix.mjs entry-point + rename fix/→js/ (v1.13.83)\" --body \"$(cat <<'EOF'\n## Summary\n\n- **30 нових `rules/<id>/fix.mjs`** — тонкий wrapper над `runStandardRule`, запускається як `bun rules/<id>/fix.mjs` або динамічно через CLI\n- **Rename `rules/<id>/fix/<concern>/` → `rules/<id>/js/<concern>/`** — convention за технологією, не функцією; чистий `git mv` без ламання API\n- **CLI `check` тепер делегує `rules/<id>/fix.mjs`** замість прямого `runRule`; нові util-модулі: `walk-cache.mjs`, `list-rule-ids.mjs`, `run-standard-rule.mjs`, `discoverOneRule` (exported from existing module)\n- 91-кейсовий smoke-контракт `fix-mjs-contract.test.mjs` верифікує структуру кожного правила\n\n## Test Plan\n\n- [x] `bun test` — 948 pass, 2 pre-existing fail (non-related: `withLock integration`, integration-repo cursor-tree)\n- [x] `bun npm/bin/n-cursor.js check abie` — ✅ виходить 0\n- [x] `bun npm/bin/n-cursor.js check` (повний прогон) — ✅\n- [x] `bun npm/rules/abie/fix.mjs` (прямий виклик) — ✅\n- [x] `bun npm/bin/n-cursor.js check changelog` — ✅ v1.13.83 знайдено\n- [x] `bun run lint` — 0 нових помилок\nEOF\n)\"","description":"Create pull request","timeout":60000}
[user]
[tool_result] https://github.com/nitra-labs/cursor/pull/196
[assistant]
[tool: TodoWrite] {"todos":[{"content":"Brainstorm design + write spec","activeForm":"Brainstorming design","status":"completed"},{"content":"Write implementation plan","activeForm":"Writing implementation plan","status":"completed"},{"content":"Set up isolated worktree + baseline","activeForm":"Setting up worktree",
[user]
[tool_result] Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable
[assistant]
PR створено: https://github.com/nitra-labs/cursor/pull/196

**Результат:**
- 30 `rules/<id>/fix.mjs` з тонким wrapper над `runStandardRule`
- `rules/<id>/fix/<concern>/` → `rules/<id>/js/<concern>/` (чистий `git mv`)
- CLI `check` делегує через dynamic import `fix.mjs`
- 91-кейсовий smoke-контракт + 104+ нових тестів, 0 регресій
- v1.13.83 в CHANGELOG + package.json

---

*End of transcript*

## ADR: Per-rule `fix.mjs` entry-point і rename `fix/` → `js/`

## Context and Problem Statement

У пакеті `@nitra/cursor` кожне правило `npm/rules/<id>/` містило concern-файли у підкаталозі `fix/<concern>/check.mjs`. CLI `check` запускав правила напряму через `discoverCheckableRules` + `runRule`. Це не дозволяло запускати окреме правило ізольовано (без CLI), а назва `fix/` не відображала технологічну природу каталогу.

## Considered Options

* **Додати `rules/<id>/fix.mjs` як тонкий wrapper над `runStandardRule`** + перейменувати `fix/<concern>/` → `js/<concern>/`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати `rules/<id>/fix.mjs` як тонкий wrapper над `runStandardRule` + rename `fix/` → `js/`", because ця комбінація дозволяє запускати правило безпосередньо (`bun rules/<id>/fix.mjs`) або через CLI (`npx @nitra/cursor check <id>`), а `js/` відображає технологічну природу каталогу на відміну від функціональної назви `fix/`.

### Consequences

* Good, because transcript фіксує очікувану користь: кожне правило отримало ізольований entry-point, `bun rules/abie/fix.mjs` виходить 0, CLI делегує через `dynamic import`.
* Good, because transcript фіксує очікувану користь: 91-кейсовий smoke-контракт верифікує структуру кожного правила; 948 тестів проходять без регресій.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Нові модулі: `npm/scripts/utils/walk-cache.mjs`, `npm/scripts/utils/list-rule-ids.mjs`, `npm/scripts/utils/run-standard-rule.mjs`
- Новий export з існуючого модуля: `discoverOneRule` з `npm/scripts/utils/discover-checkable-rules.mjs`
- Новий smoke-тест: `npm/tests/fix-mjs-contract.test.mjs` (91 кейс)
- Команда rename: `git mv npm/rules/<id>/fix npm/rules/<id>/js` (89 файлів, 27 правил)
- Commit `refactor(rules): rename fix/ → js/ у всіх правилах` — чистий `git mv` без правок коду
- Commit `feat(cli): check-команда делегує rules/<id>/fix.mjs замість runRule` — `bin/n-cursor.js` використовує `listRuleIds` + `dynamic import` + `mod.run({walkCache})`
- Version bump: `1.13.82` → `1.13.83`; PR: `https://github.com/nitra-labs/cursor/pull/196`
