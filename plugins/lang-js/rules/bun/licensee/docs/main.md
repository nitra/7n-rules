---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/bun/licensee/main.mjs
docgen:
  crc: e8cfa42d
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 75
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

lint-поверхня bun/licensee: read-only detector ліцензій npm-залежностей (`licensee`).
Генерація дефолтного `.licensee.json` — окремий T0-fix (`fix-licensee.mjs`), не в detector-і.

## Публічний API

- lint — Detector bun/licensee: ліцензії npm-залежностей через `licensee` (read-only).

## Сценарії використання

- `plugins/lang-js/rules/bun/licensee/tests/main.test.mjs` (bun/licensee detector) — немає .licensee.json → licensee-config-missing, spawnAsync не викликається; status 0 → без порушень; status 1 + непорожній stderr (die()) → fail-open діагностика, НЕ violation; status 1 + порожній stderr, непорожній stdout (--errors-only print()) → license-violation з деталлю; бун не в PATH → bun-missing; ще 3

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
