---
type: JS Module
title: blocking-inventory.mjs
resource: npm/scripts/lib/lint-surface/blocking-inventory.mjs
docgen:
  crc: dce1fafd
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Інвентар concern-ів для `ADR 260716-1354-внутрішній-паралелізм-lint-оркестратора`, чиї detector-и ще не доведені до async non-blocking шляху. `SERIAL_LANE_CONCERNS` і `isSerialLane` фіксують, що `detectAll` виконує ці concern-и в serial lane — строго послідовно, без перекриття між собою. Тут не можна заявляти паралелізм для detector-ів, які ще викликають `spawnSync`/`execSync` напряму або через shared helper, бо це блокує event loop і робить паралельний пул ілюзорним. Міграція йде за інваріантом: helper → caller-и (`await`) → прибрати відповідний запис звідси → розширити `docs/blocking-inventory-guard.test.mjs`; guard-тест має підтвердити, що жоден із цих concern-ів більше не викликає `spawnSync`/`execSync`.

## Поведінка

- `SERIAL_LANE_CONCERNS` — перелік concern-ів, які `detectAll` тримає в serial lane, бо їхній detector ще не доведено до non-blocking шляху; сюди свідомо не включені вже переведені на async/`spawnAsync` concern-и.
- `isSerialLane` — визначає, чи належить вказаний concern до serial lane, щоб оркестратор не оголошував паралельність там, де ще є blocking-виклики напряму або через shared helper.

## Публічний API

- SERIAL_LANE_CONCERNS — Повний перелік serial-lane concern-ів у форматі `${ruleId}/${concernId}`: 19 напряму заданих і 3, що додаються через shared helper; разом 22.
- isSerialLane — Визначає, чи concern має лишатися в serial lane для `detectAll`, коли non-blocking ще не доведено.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
