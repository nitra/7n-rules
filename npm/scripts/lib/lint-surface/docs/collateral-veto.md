---
type: JS Module
title: collateral-veto.mjs
resource: npm/scripts/lib/lint-surface/collateral-veto.mjs
docgen:
  crc: 96d4ee38
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 55
  issues: no-overview,short-behavior,best-of-2:retry-lost
---

## Публічний API

- realpathBestEffort — realpath шляху з найкращих зусиль: для наявного — повний realpath; для ще-неіснуючого —
realpath батьківської теки + basename; інакше — як є. Знімає розбіжність symlink-шляхів
(macOS `/tmp` → `/private/tmp`) між snapshot-ключами і target-set (той самий патерн,
що у write-guard llm-lib). Експортовано, щоб caller relativize-ив результати veto від
так само нормалізованого cwd.
- resolveTargetSet — Нормалізує target-set порушення у множину realpath-абсолютних шляхів — спільна
основа і для collateral-veto (файли ПОЗА target-set), і для test-gate
(файли ВСЕРЕДИНІ target-set, для яких перевіряються сестринські тести).
- findCollateralEdits — Обчислює collateral-правки rung-а: наявні (на момент S1) файли, змінені поза
target-set порушення. Runner на непорожньому результаті відхиляє clean-вердикт
rung-а (rollback + feedback + телеметрія `kind:"collateral-veto"`).
  modifiedExisting — абсолютні шляхи наявних файлів, змінених відносно S1
  (`snapshot.modifiedExisting()`); targetFiles — файли порушення
  (`violations[].file ∪ item.files`), відносні до cwd або абсолютні.
- HUNK_WINDOW — Дефолтне вікно (рядків з обох боків `violation.data.line`), у межах якого зміна вважається «поруч із порушенням».
- findInFileCollateralEdits — In-file hunk-level veto (§12 addendum 2026-07-24): rung змінив файл, що вже входить
у target-set порушення, але змінений рядковий діапазон виходить за межі вікна навколо
КОЖНОЇ `violation.data.line` цього файлу — сигнал колатеральної правки поза власне
порушенням (клас upsert-order.js: LLM видалив сусідній задокументований обхід бага,
виправляючи doc-comment над функцією). Fail-open: якщо для файлу немає жодного
порушення з відомим `line`, hunk неможливо відповідально обмежити — повертає null.
  preImage/current — вміст файлу до/після rung-а; violationLines — номери рядків
  порушень ЦЬОГО rung-а в ЦЬОМУ файлі; window — половина ширини допустимого вікна.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
