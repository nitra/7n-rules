---
type: JS Module
title: orchestrate.mjs
resource: npm/skills/git-reconcile/js/orchestrate.mjs
docgen:
  crc: f9dd9d0d
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 55
  issues: no-overview,short-behavior,best-of-2:retry-lost
---

## Публічний API

- parseWorktrees — Парсить `git worktree list --porcelain` у branch→path.
- dedupeRefs — Дедуплікує local/remote refs одного commit: remote має пріоритет, але
worktree-protection локального ref переноситься у запис.
- conflictFiles — Витягає конфліктні файли з `git merge-tree`.
- inventoryRepository — Збирає детермінований Git inventory. Нічого не видаляє і не змінює у
checkout, крім оновлення remote refs через fetch --prune.
- buildTriagePrompt — Формує bounded semantic-triage prompt. Git-факти вже пораховані JS; модель
не виконує shell-команди й повертає лише JSON-рішення.
- parseDecisionEnvelope — Витягає JSON object із чистої або fenced відповіді.
- callRunner — Викликає вибраний LLM runner для одного bounded-завдання.
- branchSlug — Перетворює довільний title/ref на branch slug.
- formatReport — Формує deterministic report.
- runGitReconcileOrchestrator — JS-оркестратор: inventory → bounded LLM triage → deterministic PR pipeline.
Нічого не видаляє; `drop` є лише рекомендацією у звіті.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Кешує результати в межах одного прогону.
