---
type: JS Module
title: chains-report.mjs
resource: llm-lib/lib/chains-report.mjs
docgen:
  crc: 21b5f666
---

## Огляд

Pure-агрегатор аналітики ланцюжків з trace-записів: per-kind і per-rule метрики (chains, success/partial/fail, escalation-rate, cloud calls/tokens), топ кандидатів на T0-дистиляцію (юніти, що завжди ескалюють у cloud або взагалі cloud-only), незакриті ланцюжки (креші). Нічого не читає сам — читання файла в bin/chains-report.mjs (CLI n-llm-chains-report).

## Поведінка

buildChainsReport — фільтрує kind:'chain' записи (опц. sinceTs), агрегує perKind/perRule (для fix-concern правило = префікс unit до '/'), рахує t0Candidates (cloudCalls>0 і escalated+cloudOnly == chains, сорт за cloudTokens) і unclosed (step-записи з chainId без фінального запису).
parseTraceJsonl — по-рядковий парс JSONL з пропуском сміття (best-effort writer).

## Публічний API

buildChainsReport(records, {sinceTs?}) → {perKind, perRule, t0Candidates, unclosed, totals}.
parseTraceJsonl(text) → object[].

## Гарантії поведінки

- Read-only і pure: жодного IO.
- Старі trace-записи без chain-полів не ламають звіт — ігноруються.
- Незакриті ланцюжки не входять у rate-метрики.
