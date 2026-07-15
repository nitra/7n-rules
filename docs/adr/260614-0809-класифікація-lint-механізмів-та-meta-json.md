---
type: ADR
title: "Класифікація lint-механізмів та meta.json:lint"
description: Lint-механізми класифікуються за per-file/full scope і CI-override, щоб локальний агент, CI та повний аудит запускали коректний набір перевірок.
---

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

Оркестратор `n-cursor lint` мав класифікацію `quick` / `ci`, яка змішувала дві незалежні ознаки: чи детектор технічно дробиться на окремі файли та в якому контексті він запускається. Через це не можна було коректно виразити механізми на кшталт `security`: per-file локально, але повний скан у CI.

Потрібно стандартизувати поведінку lint для трьох контекстів: локальний агент, CI та ручний повний аудит.

## Considered Options

* Зберегти `quick` / `ci` і документувати поведінку описово.
* Ввести дві ортогональні осі: `scope: per-file|full` і опційний `ci: full`.

## Decision Outcome

Chosen option: "Дві ортогональні осі scope + ci", because transcript фіксує потребу відокремити технічну здатність детектора дробитися від режиму запуску в CI; так `security` може бути per-file локально і full у CI без нового магічного рядка.

Фінальна класифікація:

| Механізм | `meta.json:lint` | Причина |
| --- | --- | --- |
| `js-lint`, `style-lint`, `doc-files`, `text` | `per-file` | per-document детектори |
| `security` | `{scope: per-file, ci: full}` | per-file локально, full у CI |
| `js-lint-ci` (`jscpd` + `knip`), `rego`, `ga` | `full` | крос-файловий або whole-tree аналіз |

Три контексти деривуються з цих полів:

* локальний агент запускає лише `scope == per-file` по changed-vs-origin;
* CI запускає всі механізми, де `effectiveCi = ci ?? scope`;
* `--full` запускає всі механізми повним прогоном.

### Consequences

* Good, because локальний агент не блокується важкими whole-tree перевірками на кшталт `knip`, `jscpd`, `rego` і `ga`.
* Good, because `security` у CI лишається повним сканом як defense-in-depth.
* Bad, because валідатори `parseRuleLintPhase` і `rule_meta.mjs:checkLintField` треба оновити для нового обʼєктного формату.

## More Information

Канонічна спека: `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md`. Файли валідації: `npm/scripts/lib/rule-meta.mjs` і `npm/rules/npm-module/js/rule_meta.mjs`. База diff для per-file механізмів має бути уніфікована через `npm/scripts/lib/changed-files.mjs::resolveChangedBase()` і `collectChangedFilesSince()`.

## Update 2026-06-14

Драфт додатково фіксує, що `lint-doc` без аргументів працює як changed-vs-origin, `lint-doc --full` запускає повний скан, а `lint-doc --since <ref>` задає явну базу. CI для doc-документації має падати і на `missing`, і на `crc-mismatch`; `--missing-only` лишається опцією команди, але не CI-режимом. Канон lint-класифікації винесено в новий модуль `npm/rules/lint`, який описує взаємодію правил і контекст запуску без дублювання логіки окремих детекторів.
