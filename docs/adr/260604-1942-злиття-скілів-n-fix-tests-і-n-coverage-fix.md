---
session: 38aa0305-a12b-4078-9085-ce03884efdd6
captured: 2026-06-04T19:42:57+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/38aa0305-a12b-4078-9085-ce03884efdd6.jsonl
---

I analyzed the two skills and found a ~95% overlap — they're nearly identical. Here's a summary of the key findings:

**Core difference:** `n-coverage-fix` = `n-fix-tests` + auto-runs `n-cursor coverage` to generate `COVERAGE.md` first + iteration limit (max 3) + anti-parallel guard.

**`n-fix-tests` is a strict subset** of `n-coverage-fix`, starting at Step 2 when `COVERAGE.md` already exists.

**Recommendation:** Merge into one skill with `n-coverage-fix` as canonical, adding:
1. Command detection from `package.json#scripts` (currently only in `n-fix-tests`)
2. Early skip if `COVERAGE.md` is fresh (so one skill covers both entry points)
3. Make `n-fix-tests` a thin alias or remove it entirely

Want me to execute the merge? I'll work in a separate worktree per your rules. And should `n-fix-tests` become an alias or be deleted?

---

## ADR Злиття скілів `n-fix-tests` і `n-coverage-fix`

## Context and Problem Statement
У репозиторії існують два скіли — `n-fix-tests` і `n-coverage-fix` — з майже ідентичним (≈95%) вмістом. Preflight-блок, крок групування мутантів, промпт для Agent і логіка конвергенції продубльовані байт-у-байт. Будь-яка правка вимагала синхронізації обох файлів і вже призвела до дрейфу (різні суфікси worktree, незначні формулювання).

## Considered Options
* Лишити обидва скіли окремо (статус-кво)
* Злити в один канонічний `n-coverage-fix` і зробити `n-fix-tests` тонким аліасом або видалити його
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Злити в один канонічний `n-coverage-fix`", because `n-fix-tests` є строгою підмножиною `n-coverage-fix` (починається з Кроку 2 за готовим `COVERAGE.md`); збереження дубля — пряма загроза дивергенції та подвоєного обслуговування.

### Consequences
* Good, because transcript фіксує очікувану користь: єдине джерело правди, усунення ризику дрейфу між двома файлами, менша когнітивна навантага при оновленні логіки.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
* Канонічний файл: `.cursor/skills/n-coverage-fix/SKILL.md`
* Поглинений файл: `.cursor/skills/n-fix-tests/SKILL.md`
* Відмінності, що підлягають перенесенню з `n-fix-tests`: детекція команд через `package.json#scripts` (fallback для `test`/`coverage`)
* Додати до `n-coverage-fix`: ранній skip генерації, якщо `COVERAGE.md` уже свіжий (покриває обидва entry-point: «згенеруй і фіксь» та «фіксь по готовому звіту»)
* Фінальний стан `n-fix-tests`: або видалити, або лишити як shim з одним рядком-посиланням на `n-coverage-fix`
