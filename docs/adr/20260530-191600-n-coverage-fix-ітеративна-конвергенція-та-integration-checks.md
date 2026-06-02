# n-coverage-fix: Ітеративна конвергенція через COVERAGE.md та Integration Repo Checks

**Status:** Accepted
**Date:** 2026-05-30

## Context and Problem Statement

Потрібно автоматично підвищувати mutation score без ручного аналізу вцілілих мутантів. Скіл `n-coverage-fix` реалізує цикл: запуск метрик → читання вцілілих мутантів → написання тестів — максимум 3 рази. Паралельно виявлено, що тест `integration-repo-checks.test.mjs` блокував весь `bun run coverage`, якщо реальні CLI-бінарники повертали помилку (невідповідність версій у CHANGELOG vs package.json).

## Considered Options

**Для n-coverage-fix:**
* Ітеративний цикл (max 3 ітерації): `bun run coverage` → читання `COVERAGE.md` → запис тестів → повторити
* Інші варіанти в transcript не обговорювалися.

**Для integration-repo-checks:**
* Виклик реальних бінарників (`conftest`, `opa`, `regal`) з PATH у subprocess
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Ітеративний цикл через COVERAGE.md з реальними бінарниками в integration-тестах", because `COVERAGE.md` слугує файловим інтерфейсом між провайдером метрик і fix-агентом: провайдер записує JSON-список вцілілих мутантів у секцію `## Вцілілі мутанти`, агент читає його й дописує тести. Реальні бінарники в integration-тестах виявляють розбіжності, які моки приховали б.

### Consequences

* Good, because агент не потребує прямого доступу до Stryker-API — достатньо прочитати `COVERAGE.md`.
* Good, because integration-тест виявляє реальні розбіжності: невідповідність `npm/CHANGELOG.md [1.35.0]` та `npm/package.json version "1.35.1"` була виявлена саме через реальний `conftest`.
* Bad, because якщо vitest-тести падають до запуску Stryker, `COVERAGE.md` залишається з застарілими даними (спостережено: `mutation.json` датований May 28, `COVERAGE.md` — May 30, вміст не оновлювався через виняток у vitest).
* Bad, because залежність від реальних бінарників у PATH означає, що падіння integration-тесту блокує весь `bun run coverage` і Stryker не запускається.

## More Information

- Скіл: `.cursor/skills/n-coverage-fix/SKILL.md`
- Файл-інтерфейс: `COVERAGE.md` (секція `## Вцілілі мутанти`, поле `"file"` + `"mutants"`)
- Провайдер метрик: `npm/rules/js-lint/coverage/coverage.mjs` (vitest + Stryker з `vitest-runner`)
- Оркестратор: `npm/rules/test/coverage/coverage.mjs`, прапор `--fix` запускає `coverage-fix.mjs`
- Stryker incremental cache: `npm/reports/stryker/incremental.json`
- Integration-тест: `npm/tests/integration-repo-checks.test.mjs`
- Хелпер subprocess: `npm/scripts/lib/run-conftest-batch.mjs`
- Бінарники: `conftest` (`/opt/homebrew/bin/conftest`, OPA 1.15.2), `opa`, `regal`
