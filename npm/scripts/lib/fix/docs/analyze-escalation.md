---
type: JS Module
title: analyze-escalation.mjs
resource: npm/scripts/lib/fix/analyze-escalation.mjs
docgen:
  crc: f802e47f
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

Аналітика escalation-логу fix-конформності. Читає записи рунгів драбини (`escalation-log.mjs`) — весь лог або записи одного прогону (від байтового зсуву), — ділить на чанки за бюджетом символів і просить хмарну **avg**-модель запропонувати, як зменшити LLM-залежність: нові детерміновані T0-патерни, уточнення `.mdc`-інструкцій або зміни скриптів пакета. Результат — markdown-звіт у `.n-cursor/fix-escalation-analysis.md` (append із timestamp). Викликається CLI `n-cursor analyze-escalation` (весь лог) і наприкінці `lint --full` (записи прогону).

## Поведінка

`readEscalationRecords` читає JSONL від байтового зсуву (зсув на межі рядка — мультибайт не б'ється; биті рядки пропускаються); `escalationLogSize` дає зсув для scope «цей прогін». `chunkRecords` стискає записи й ділить на чанки, щоб JSON кожного не перевищив бюджет. `analyzeEscalations` (синхронний — callLlm spawnSync-based) робить виклик avg-моделі по кожному чанку, а за кількох чанків — фінальний синтез; помилки моделі ковтаються в `null` (аналіз не валить lint). `maybeAnalyzeEscalation` — хук lint: gated kill-switch `N_CURSOR_FIX_ANALYZE`, наявністю `CLOUD_AVG` і записів.

## Публічний API

- `analysisEnabled()` — чи дозволено авто-аналіз (kill-switch `N_CURSOR_FIX_ANALYZE`).
- `escalationLogSize(path?)` — розмір логу в байтах (since-offset).
- `readEscalationRecords(path, sinceOffset?)` — записи від зсуву.
- `chunkRecords(records, maxChars?)` — чанки стиснених записів.
- `analyzeEscalations(records, opts?)` — `{ report, chunks, reason }`; `opts.callLlm` інжектовний.
- `analysisReportPath(cwd?)` / `writeAnalysisReport(report, cwd, ts)` — шлях/запис звіту.
- `runEscalationAnalysisCli(args, cwd?)` — CLI: весь лог → звіт.
- `maybeAnalyzeEscalation(cwd, sinceOffset, log)` — хук наприкінці `lint --full`.

## Гарантії поведінки

- Звертається до мережі лише при виклику avg-моделі (через pi/omlx за префіксом model-id).
- Помилки виклику моделі перехоплює (fail-safe): аналіз не впливає на exit-код lint.
