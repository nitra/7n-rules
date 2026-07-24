---
type: JS Module
title: test-gate.mjs
resource: npm/scripts/lib/lint-surface/test-gate.mjs
docgen:
  crc: 212d387b
  model: manual
---

## Огляд

Test-gate верифікація для non-T0 (LLM) fix-ladder rung-ів (spec addendum 2026-07-24, ladder-collateral-in-file). Закриває клас колатеральних правок, які [collateral-veto.mjs](./collateral-veto.md) не бачить: правки ВСЕРЕДИНІ вже-таргетованого файлу (напр. видалення задокументованого workaround поруч із фіксованим порушенням) не зачіпають жодного детектора й не торкаються файлів поза target-set, тож проходять і collateral-veto, і canonical re-detect. Якщо для зміненого файлу з target-set існує сестринський тест-файл за конвенцією `<dir>/tests/<stem>.test.{mjs,js,ts}` (n-test.mdc), той тест виконується як частина verify — провал тесту відхиляє clean-вердикт rung-а так само, як і collateral-veto.

## Поведінка

1. `findSiblingTestFiles(sourceAbsPath)` конструює кандидатів `<dir>/tests/<stem>.test.{mjs,js,ts}` для джерела з розширенням `.mjs`/`.js`/`.ts`/`.vue` і повертає лише наявні на диску файли.
2. `runTestFile(testAbsPath, cwd)` виконує один тест-файл через `bunx vitest run --reporter=verbose <file>` (`spawnSync`, таймаут 30s). Fail-open: spawn-помилка, відсутній `bunx`/vitest, чи таймаут (`status === null`) — повертає `passed: true`, а не блокує rung.
3. `findBrokenSiblingTests({ files, cwd, runTest })` перебирає файли (наявні, у target-set, реально змінені rung-ом), для кожного шукає сестринські тести й запускає перший знайдений; перший провал зупиняє пошук і повертається як veto-кандидат. `runTest` — override test-runner-а для юніт-тестів цього модуля (типово `runTestFile`).

## Публічний API

- `findSiblingTestFiles(sourceAbsPath)` — наявні сестринські тест-файли джерела (може бути порожньо).
- `runTestFile(testAbsPath, cwd)` — `{ passed, output }`, fail-open на інфраструктурну помилку.
- `findBrokenSiblingTests({ files, cwd, runTest? })` — `{ file, testFile, output } | null`, перший зафіксований провал.

## Гарантії поведінки

- Fail-open за дизайном: відсутній test-runner, таймаут чи відсутність сестринського тесту ніколи не блокує fix-ladder.
- Не редагує жодних файлів — лише читає (пошук тест-файлів) і запускає сторонній процес (vitest).
