---
session: 38aa0305-a12b-4078-9085-ce03884efdd6
captured: 2026-06-04T20:08:21+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/38aa0305-a12b-4078-9085-ce03884efdd6.jsonl
---

## ADR Злиття `n-fix-tests` у `n-coverage-fix` із видаленням дубляту

## Context and Problem Statement

У репозиторії `nitra/cursor` існували два скіли — `n-fix-tests` і `n-coverage-fix` — зі ~95% ідентичним вмістом (preflight-блок, крок групування мутантів, prompts для Agent, кроки `bun test` і re-run coverage). Відмінність полягала лише в точці входу: `n-coverage-fix` запускав `n-cursor coverage` самостійно, `n-fix-tests` — очікував готовий `COVERAGE.md`. Дублювання джерел правди призводило до дрейфу: worktree-суфікси і формулювання вже розійшлись між файлами.

## Considered Options

* Злити `n-fix-tests` у `n-coverage-fix` (зберегти повніший скіл як канонічний, видалити дубль)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Злити `n-fix-tests` у `n-coverage-fix`", because `n-fix-tests` є строгою підмножиною `n-coverage-fix` — він покриває лише один з двох сценаріїв (звіт уже існує), тоді як `n-coverage-fix` покриває обидва. Джерело правди — `npm/skills/`, де правки мусили б дублюватись двічі за кожної зміни.

### Consequences

* Good, because transcript фіксує очікувану користь: усунено дрейф між двома майже ідентичними `SKILL.md`, одне джерело правди зменшує ризик розбіжностей при майбутніх правках.
* Good, because `n-coverage-fix` збагатився детекцією команд із `package.json#scripts` (раніше хардкодив `n-cursor coverage` / `bun test`), яку мав лише `n-fix-tests`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Змінені файли:
- `npm/skills/coverage-fix/SKILL.md` — додано детекцію `package.json#scripts` для `test`/`coverage`
- `npm/skills/fix-tests/` — видалено через `git rm -r`
- `.cursor/skills/n-fix-tests/`, `.pi/skills/n-fix-tests/`, `.claude/commands/n-fix-tests.md` — видалено
- `.n-cursor.json` — `"fix-tests"` прибрано з масиву `skills`
- `AGENTS.md`, `CLAUDE.md` — рядки `n-fix-tests` прибрано зі списків скілів
- `npm/rules/test/coverage/coverage.mjs` і `npm/rules/test/coverage/tests/coverage.test.mjs` — посилання `/n-fix-tests` → `/n-coverage-fix`
- `npm/.changes/260604-1957.md` — change-файл (`bump: minor`, `section: Removed`)

Команди: `git rm -r npm/skills/fix-tests .cursor/skills/n-fix-tests .pi/skills/n-fix-tests .claude/commands/n-fix-tests.md`, `bun ./npm/bin/n-cursor.js change --ws npm --bump minor --section Removed --message "..."`, `bunx oxfmt` на 8 файлах.
