---
type: JS Module
title: agent-fix.mjs
resource: llm-lib/lib/agent-fix.mjs
docgen:
  crc: 907ba309
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 55
  issues: no-overview,short-behavior,best-of-2:retry-lost
---

## Публічний API

- buildVerifyFeedbackPrompt — Будує фідбек-prompt verify-ітерації: точний вивід canonical-перевірки + нагадування
обмежень (той самий semantic-collateral guard, що й у buildFixPrompt).
- buildFixPrompt — Будує fix-промпт для рунга: правило + порушення + (опц.) target-файли + (опц.) feedback
попереднього провалу + жорсткий блок обмежень (лише механічні зміни) + інструкція
«ast_facts перед edit, self_check після».

Блок обмежень — перший шар semantic-collateral guard (спека pi-migration §12,
addendum 2026-07-05): слабкі локальні моделі схильні «виправляти» правило семантичною
правкою (хардкод значення, симуляція поведінки) — промпт явно це забороняє, а
verdict-veto consumer-а (re-check) відхиляє такі правки поза target-файлами.
- runAgentFix — Проводить ОДНУ агентну fix-спробу (рунг) для правила.

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
