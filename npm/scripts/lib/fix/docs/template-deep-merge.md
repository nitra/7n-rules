---
type: JS Module
title: template-deep-merge.mjs
resource: npm/scripts/lib/fix/template-deep-merge.mjs
docgen:
  crc: b04d82e4
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 60
---

## Огляд

Спільний T0-autofix writer для policy-концернів "один target-файл + один канонічний
`template/*.snippet.{json,jsonc,yml,yaml}`" (`engine:"template"` і `engine:"rego"`
з тим самим snippet-шаблоном). Deep-merge snippet → target: об'єкти мерджаться по
ключах, масиви — union за структурним підмножинним збігом (`checkSnippet`-семантика,
як у детекторі — жодного окремого визначення "збігу"); якщо структурного збігу немає,
але є елемент з тим самим `name`/`uses` (`identityKey`) — той елемент оновлюється
on-place, а не дублюється поряд (напр. bump канонічного `run`/версії `uses`); листя —
перезаписується канонічним значенням. Файл відсутній → копіюється сам snippet (без merge).

JSON/JSONC — plain-object merge + `JSON.stringify`. YAML — `yaml` Document API
(`setIn`/`addIn`/`hasIn`), щоб зберегти коментарі й форматування наявного файлу;
створюється лише те, чого бракує.

Кожен викличний concern передає лише `{ id, targetPath }` — сам writer резолвить
snippet-файл у `template/` свого concern-а через `ctx.concernDir` (той самий
механізм, що й `vscode-ext-add.mjs`).

## Публічний API

- createTemplateFixPattern — Створює T0-патерн, що приводить `targetPath` у відповідність `template/*.snippet.*`
свого concern-а (deep-merge, idempotent). Один writer — для будь-якого single-target
snippet-концерну (`engine:"template"` чи `engine:"rego"` з тим самим snippet-шаблоном).

## Сценарії використання

- `npm/scripts/lib/tests/template-deep-merge.test.mjs` (createTemplateFixPattern — JSON; createTemplateFixPattern — YAML) — файл відсутній → створюється зі snippet; файл є, полю бракує потрібного значення → мердж додає, не ламає існуюче; вже відповідає snippet → без змін (idempotent); невалідний JSON у target → не чіпає (touchedFiles порожній); workflow-файл відсутній → створюється зі snippet as-is; ще 6

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
