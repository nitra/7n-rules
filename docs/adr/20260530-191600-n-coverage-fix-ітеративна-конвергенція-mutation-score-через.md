---
session: 9b2ddf67-dce0-4298-88ca-c524605c3c76
captured: 2026-05-30T19:16:00+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/9b2ddf67-dce0-4298-88ca-c524605c3c76.jsonl
---

## ADR n-coverage-fix: ітеративна конвергенція mutation score через COVERAGE.md

## Context and Problem Statement
Потрібно автоматично підвищити mutation score без ручного аналізу вцілілих мутантів. Скіл `n-coverage-fix` реалізує цикл: запуск метрик → читання вцілілих → написання тестів — максимум 3 рази.

## Considered Options
* Ітеративний цикл (max 3 ітерації): `bun run coverage` → читання `COVERAGE.md` → запис тестів → повторити
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Ітеративний цикл через COVERAGE.md", because `COVERAGE.md` слугує файловим інтерфейсом між провайдером метрик і fix-агентом: провайдер записує JSON-список вцілілих мутантів у секцію `## Вцілілі мутанти`, агент читає його й дописує тести.

### Consequences
* Good, because transcript фіксує очікувану користь: агент не потребує прямого доступу до Stryker-API — достатньо прочитати `COVERAGE.md`.
* Bad, because якщо vitest-тести падають до запуску Stryker, `COVERAGE.md` залишається з застарілими даними (спостережено: `mutation.json` датований May 28, `COVERAGE.md` — May 30, але вміст не оновлювався через виняток у vitest).

## More Information
- Скіл: `.cursor/skills/n-coverage-fix/SKILL.md`
- Файл-інтерфейс: `COVERAGE.md` (секція `## Вцілілі мутанти`, поле `"file"` + `"mutants"`)
- Провайдер метрик: `npm/rules/js-lint/coverage/coverage.mjs` (vitest + Stryker з `vitest-runner`)
- Оркестратор: `npm/rules/test/coverage/coverage.mjs`, прапор `--fix` запускає `coverage-fix.mjs`
- Spryker incremental cache: `npm/reports/stryker/incremental.json`

---

## ADR integration-repo-checks: реальні CLI-бінарники замість моків

## Context and Problem Statement
Тест `integration-repo-checks.test.mjs` перевіряє узгодженість репозиторію з поточним деревом `cursor`. Під час дебагінгу блокування coverage-циклу було виявлено, що тест викликає реальні системні утиліти.

## Considered Options
* Виклик реальних бінарників (`conftest`, `opa`, `regal`) з PATH у subprocess
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Виклик реальних бінарників з PATH", because тест перевіряє поведінку реального оточення: `conftest` (`/opt/homebrew/bin/conftest`, OPA 1.15.2), `opa`, `regal` запускаються як subprocess через `run-conftest-batch.mjs`.

### Consequences
* Good, because тест виявляє реальні розбіжності, які моки приховали б — зокрема, невідповідність версії `npm/CHANGELOG.md [1.35.0]` та `npm/package.json version "1.35.1"`.
* Bad, because залежність від реальних бінарників у PATH означає, що падіння тесту блокує весь `bun run coverage`, і Stryker не запускається. Neutral, because transcript не містить підтвердження наслідку щодо CI-оточення.

## More Information
- Тест: `npm/tests/integration-repo-checks.test.mjs`
- Хелпер subprocess: `npm/scripts/lib/run-conftest-batch.mjs`
- Виявлена помилка в сесії: `npm/CHANGELOG.md: перша секція [1.35.0] не збігається з npm/package.json version "1.35.1"` — coverage-цикл зупинився на цьому кроці
