# Slug-найменування чернеток ADR у capture-decisions.sh

**Status:** Accepted
**Date:** 2026-05-16

## Контекст

Stop-hook `capture-decisions.sh` зберігав ADR-чернетки з іменем `<timestamp>-<session-hash[0:8]>.md` (наприклад, `20260516-090349-e513a1f0.md`). Такий формат нечитабельний у git status та IDE, а нормалізатор (`normalize-decisions.sh`) мусив виконувати `rewrite`-операції для перейменування у slug-формат — окремий LLM-виклик на кожен файл.

## Рішення/Процедура/Факт

У `capture-decisions.sh` (canonical: `npm/.claude-template/hooks/`, синхронізовано у `.claude/hooks/`) після отримання LLM-відповіді парситься перший рядок `## [ADR|Runbook|Knowledge] <heading>`. `awk` витягує heading, `tr`/`sed` будують kebab-slug: lowercase, пробіли та розділові знаки → `-`, дозволено кирилицю та `a-z 0-9 -`, truncate до 60 символів. Формат файлу: `<YYYYMMDD-HHMMSS>-<slug>.md`. При колізії імен у ту саму секунду — суфікс `-2`, `-3`. Fallback до `<TS>-<session-id[0:8]>.md`, якщо heading не розпізнано. Версія 1.11.15.

## Обґрунтування

LLM-відповідь вже містить читабельний heading як частину існуючого промпта — додатковий виклик не потрібен. Timestamp-prefix гарантує унікальність між різними сесіями з однаковою темою. Нормалізатор тепер обмежується `delete`/`merge-into` для дублікатів — `rewrite`-операції стають рідкісними.

## Розглянуті альтернативи

- Тільки slug без timestamp-prefix — відхилено через ризик колізій між сесіями з однаковою темою.
- Окремий LLM-виклик для генерації slug одразу при capture — відхилено, бо подвоює час виконання Stop-hook.
- Залишити session-hash у назві (статус-кво) — відхилено через нечитабельність у git history та IDE.

## Зачіпає

`npm/.claude-template/hooks/capture-decisions.sh`, `.claude/hooks/capture-decisions.sh` (обидва синхронізовані), `npm/CHANGELOG.md`. Версія: 1.11.15.
