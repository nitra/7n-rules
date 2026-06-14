# Злиття скілів n-fix-tests і n-coverage-fix

**Status:** Accepted
**Date:** 2026-06-04

## Context and Problem Statement

У репозиторії існують два скіли — `n-fix-tests` і `n-coverage-fix` — з ≈95% ідентичним вмістом. Preflight-блок, крок групування мутантів, промпт для Agent і логіка конвергенції продубльовані байт-у-байт. Будь-яка правка вимагала синхронізації обох файлів і вже призвела до дрейфу (різні суфікси worktree, незначні формулювання).

## Considered Options

* Лишити обидва скіли окремо (статус-кво)
* Злити в один канонічний `n-coverage-fix` і зробити `n-fix-tests` тонким аліасом або видалити його
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Злити в один канонічний `n-coverage-fix`", because `n-fix-tests` є строгою підмножиною `n-coverage-fix` (починається з Кроку 2 за готовим `COVERAGE.md`); збереження дубля — пряма загроза дивергенції та подвоєного обслуговування.

### Consequences

* Good, because єдине джерело правди, усунення ризику дрейфу між двома файлами, менша когнітивна навантага при оновленні логіки.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

* Канонічний файл: `.cursor/skills/n-coverage-fix/SKILL.md`
* Поглинений файл: `.cursor/skills/n-fix-tests/SKILL.md`
* Відмінності, що підлягають перенесенню з `n-fix-tests` до `n-coverage-fix`: детекція команд через `package.json#scripts` (fallback для `test`/`coverage`)
* Додати до `n-coverage-fix`: ранній skip генерації, якщо `COVERAGE.md` уже свіжий (покриває обидва entry-point: «згенеруй і фіксь» та «фіксь по готовому звіту»)
* Фінальний стан `n-fix-tests`: або видалити, або лишити як shim з одним рядком-посиланням на `n-coverage-fix`
