---
type: JS Module
title: run-fix.mjs
resource: npm/scripts/lib/lint-surface/run-fix.mjs
docgen:
  crc: 3b664cd6
  model: omlx/gemma-4-e2b-it-4bit
  tier: local-min
  score: 75
---

## Огляд

Central fix-pipeline unified lint surface (spec 2026-06-29 §Fix Role / §Tier Ladder).

Послідовно, per concern:
  detect → (clean: keep) → T0 (permanent, поза rollback) → snapshot S1 →
  detect → (clean: keep) → ladder[restore S1 → worker → detect]* → (exhausted: rollback S1)

Ролі чесні: detector тільки виявляє; T0 і worker тільки змінюють; success визначає
ВИКЛЮЧНО canonical re-detect. Worker не володіє rollback/tier/ladder — лише один attempt.

Моделі rung-ів визначаються universal policy resolver. Cloud fallback не маскується
під local rung, а однакова cloud-модель не запускається повторно на сусідньому
rung. Усі workers мають backstop timeout, крім `doc-files`: довга генерація
лишається приєднаною до foreground CLI, доки завершиться або користувач натисне Ctrl-C.

## Публічний API

- fixConcern — Проводить ОДИН concern по pipeline: T0 → S1 → ladder. Повертає чи закрито.
- runFixPipeline — Повний fix-pipeline: detect усе → fix кожен провальний concern → exit code.

## Сценарії використання

- `npm/scripts/lib/lint-surface/tests/run-fix.test.mjs` (runFixPipeline — базові вердикти; runFixPipeline — T0 permanent) — clean → 0, worker не викликається; ctx.verify (Фаза A1): item-scoped canonical вердикт доступний worker-у, verifyMax заданий; worker закриває на першому rung → 0; T0 закриває сам → worker не потрібен; T0-зміни виживають rollback-у при повному провалі worker-а; ще 31

## Гарантії поведінки

- Кешує результати в межах одного прогону.
