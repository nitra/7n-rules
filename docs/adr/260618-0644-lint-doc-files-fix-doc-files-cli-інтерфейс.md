---
type: ADR
title: Команди lint-doc-files та fix-doc-files як CLI-інтерфейс для файлової документації
description: Файлова документація перевіряється і генерується через окремі CLI-команди lint-doc-files та fix-doc-files.
---

**Status:** Accepted
**Date:** 2026-06-18

## Context and Problem Statement

Користувач запитав, чи є команда `npx @nitra/cursor doc-files` або аналог для генерації файлової документації. Transcript фіксує, що CLI `@nitra/cursor` має дві спеціалізовані підкоманди: `lint-doc-files` для перевірки застарілих або відсутніх `.md`-документів і `fix-doc-files` для генерації або оновлення документації.

## Considered Options

- `npx @nitra/cursor lint-doc-files` разом із `npx @nitra/cursor fix-doc-files` як детермінований lint → fix цикл.
- `npx @nitra/cursor docgen scan|modules` разом із ручним dispatch Claude-субагентів через skill `/n-docgen`.

## Decision Outcome

Chosen option: "`lint-doc-files` / `fix-doc-files` як основний CLI-інтерфейс", because transcript фіксує, що ці команди виконують повний цикл через JS-оркестрацію з локальним LLM `omlx` без потреби запускати Claude-агента вручну; `docgen scan/modules` лишаються допоміжними scanner-командами для skill-flow.

### Consequences

- Good, because `fix-doc-files` запускає генерацію локально через `omlx` і підтримує `--limit`, `--from`, `--overwrite`, `--stamp`.
- Good, because `lint-doc-files` має машинний і hook-режими через `--json`, `--missing-only`, `--hook`, `--git`, `--degraded`.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because transcript не містить підтвердження, чи старі `docgen scan/modules` мають бути видалені або лише залишені як допоміжний інтерфейс.

## More Information

- CLI entrypoint: `npm/bin/n-cursor.js`, `case 'lint-doc-files'` і `case 'fix-doc-files'`.
- Lint-модуль: `npm/rules/doc-files/lint/lint.mjs`, `runLintDocFilesCli`.
- Генератор: `npm/rules/doc-files/js/docgen-files-batch.mjs`, `runDocFilesGenCli`, `runDocFilesStampCli`.
- Hook-протокол: `--hook` для PostToolUse і `--git` для Stop-hook; transcript фіксує exit 2 при drift.
- Gate-поріг: `N_CURSOR_DOC_FILES_GATE_MAX`, дефолт 50.
- Команди:
  - `npx @nitra/cursor lint-doc-files`
  - `npx @nitra/cursor fix-doc-files`
  - `npx @nitra/cursor fix-doc-files --stamp`

## Update 2026-06-18

- `doc-files` реалізує JS-оркестрований CLI з CRC-gate: команда обходить файли, batch-ить роботу, викликає локальну модель і штампує CRC у frontmatter.
- Агент лише запускає команду і читає підсумок, не тримаючи сотні файлів у context.
- CRC у frontmatter дозволяє пропускати незмінені файли, тому повторний запуск ідемпотентний.
- Повʼязані файли з transcript: `npm/rules/doc-files/js/docgen-files-batch.mjs`, `npm/skills/doc-files/SKILL.md`, `npm/skills/doc-files/meta.json`, `docs/specs/2026-06-10-docgen-split-doc-files-doc-aggregate-design.md`, `docs/doc-files-skill.md`.
