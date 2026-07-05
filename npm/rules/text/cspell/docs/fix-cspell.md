---
type: JS Module
title: fix-cspell.mjs
resource: npm/rules/text/cspell/fix-cspell.mjs
docgen:
  crc: 554ef39d
  model: manual
  tier: local-min
---

## Огляд

T0-autofix для policy-concern-а `text/cspell`: приводить `.cspell.json` до канону **merge-записом**, а не wholesale-перезаписом. Причина — інцидент у consumer-репо (nitra/task), де скаффолд-перезапис зніс локальний масив `words` і repo-специфічні `ignorePaths` (`target/**`, `src-tauri/gen/**`). Канон читається з template концерну (`template/.cspell.json.snippet.json`, `template/.cspell.json.contains.json`), не з тексту violation.

## Поведінка

- Патерн `cspell-merge` застосовується, коли серед violations концерну є `policy-file-missing` або `policy-deny`.
- Відсутній `.cspell.json` → створюється зі snippet-канону, `import`-потреб із contains і дефолтним `language: "en,uk"`.
- Наявний `.cspell.json` → merge:
  - масиви зі snippet (`ignorePaths`) — union: існуючі елементи лишаються попереду, відсутні канонічні дописуються в кінець;
  - скаляри зі snippet (`version`) — виставляються в канонічне значення;
  - contains (`import`) — якщо жоден існуючий запис не містить потрібного підрядка (`@nitra/cspell-dict`), підрядок дописується окремим елементом;
  - `language` — presence-only: дефолт додається лише коли поля немає, кастомне значення не перезаписується.
- Без змін (уже канонічний конфіг) → файл не записується взагалі (`touchedFiles: []`) — ідемпотентність байт-у-байт.
- Запис — `JSON.stringify(cfg, null, 2)` + завершальний `\n`; перед записом викликається `ctx.recordWrite`.

## Гарантії поведінки

- Існуючі `words`, `flagWords`, `ignorePaths` і будь-які інші поля конфігу **ніколи не видаляються і не перезаписуються** — канонічне лише додається.
- Заборонені import-и (`@cspell/dict-*`) не вирізаються автоматично — їх видалення лишається ручним рішенням.
- Невалідний JSON у `.cspell.json` → файл не чіпається, патерн повертає `{ touchedFiles: [] }` (без винятків назовні).
- Відсутні/невалідні template-файли канону → патерн no-op.

## Де використовується

Central fix-pipeline (`scripts/lib/lint-surface/run-fix.mjs`) підхоплює `patterns` з `fix-cspell.mjs` як T0 концерну `text/cspell`; оскільки концерн має `fixability: "config"`, LLM-ladder для нього не запускається — цей детермінований merge є єдиним авто-фіксом.
