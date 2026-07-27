---
type: JS Module
title: main.mjs
resource: plugins/ci-azure/rules/ci_artifact/consume_azure/main.mjs
docgen:
  crc: 8cefa299
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Для активного `ci:azure` у `package.json` знаходить придатний до виконання опис артефактів і одразу показує проблеми колекції, якщо вони є. Далі для кожного артефакта з цього опису звіряє вміст цільового файлу з вимогами перевірки та у `lint` повідомляє лише про фактичні невідповідності.

## Поведінка

1. Перевіряє, чи для активного `ci:azure` у `package.json` є придатний до виконання опис артефактів, і одразу фіксує проблеми колекції, якщо вони є.
2. Для кожного релевантного артефакта звіряє очікувану поведінку з поточним вмістом цільового файлу та позначає лише реальні невідповідності.
3. Якщо для внеску неможливо відновити канонічну команду, повідомляє про шаблонну помилку на цільовому файлі й не продовжує перевірку цього випадку.
4. Якщо перевірка не застосовується до поточного файлу, мовчки пропускає його; це свідомо покриває ситуацію, коли потрібний pipeline-файл лежить в іншому concern і його відсутність не є порушенням тут.
5. Повертає підсумок перевірки через `lint` без змін у файловій системі чи базі даних.

## Публічний API

- lint — Detector generic-consumer-а слоту `ci.artifact@1` для `ci:azure` (spec §7.3, Фаза 3):
перевіряє наявність канонічного lint-кроку (АБО загального full-lint fallback-у) на будь-якій
глибині `azure-pipelines.yml` — без жодного PHP/lang-specific literal тут (v1 diagnostic-only,
`fix: false` — немає T0-фіксу, лише порушення).

## Сценарії використання

- `plugins/ci-azure/rules/ci_artifact/consume_azure/tests/consume.test.mjs` (ci-azure ci.artifact consumer) — patch-existing: pipeline відсутній → 0 violations (окремий концерн azure-pipelines); contains-step: canonical крок відсутній на будь-якій глибині → violation; contains-step: canonical крок на глибині stages→jobs→steps знаходиться; contains-step: canonical крок на голому jobs→steps (без stages) знаходиться; приймає загальний full-lint fallback замість domain-команди; ще 4

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
