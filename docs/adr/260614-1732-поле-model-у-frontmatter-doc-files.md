---
type: ADR
title: Поле model у frontmatter файлової документації
description: Фіксувати model-id у frontmatter doc-files, щоб бачити, якою LLM-моделлю згенеровано конкретний markdown-файл.
---

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

Frontmatter файлових docs, які генерує docgen, фіксував `source` і `crc`, а також опційний quality-блок, але не зберігав model-id генератора. Оскільки локальні моделі змінюються, без поля `model` неможливо визначити, чи конкретний markdown-файл згенеровано старою або новою моделлю.

## Considered Options

- Phase 1: пасивно записувати `model` у frontmatter, а drift-детектор реалізувати пізніше.
- Одразу реалізувати і запис `model`, і drift-детектор, де `lint-doc-files` позначає документацію stale при зміні моделі.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Phase 1: пасивно записувати `model` у frontmatter", because користувач явно сказав `Phase 1 зараз, а drift-детектор пізніше`.

### Consequences

- Good, because після зміни моделі з frontmatter буде видно, які docs згенеровано старою моделлю.
- Bad, because без drift-детектора `lint-doc-files` не помічає розбіжності моделі: старі docs лишаються свіжими за CRC, доки phase 2 не буде реалізовано.
- Neutral, because поле `model` опційне для back-compat: старі docs парсяться з `model: null`.

## More Information

- Змінені файли: `npm/rules/doc-files/js/docgen-crc.mjs`, `npm/rules/doc-files/js/docgen-files-batch.mjs`, `npm/rules/doc-files/js/tests/docgen-crc.test.mjs`.
- Нові або змінені символи: `MODEL_RE`, `readDocModel()`, `buildDocFrontmatter(source, crc, quality=null, model=null)`, `stampDoc(md, source, crc, quality=null, model=null)`, `parseDocFrontmatter` → `data.model`.
- Формат нового поля:

```yaml
docgen:
  source: src/lib/foo.js
  crc: a3f1c9e0
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
```

- Значення — повний model-id із префіксом провайдера, як повертає `resolveModel`.
- У gen-шляху `result.model` з `generateDoc` передається у `stampDoc`.
- У `--stamp`-шляху без LLM `readDocModel(docAbs)` зберігає наявне значення з frontmatter.
- Пов'язана конфігураційна зміна моделі: `N_LOCAL_MIN_MODEL` у `~/.zshenv` було оновлено з `omlx/gemma-4-e2b-it-4bit` на `omlx/gemma-4-e4b-it-OptiQ-4bit`; transcript фіксує, що відповідний health-check повернув `{"ok":true}`.
- Тести docgen-crc після змін: 19/19 пройдено.

## Update 2026-06-14

- Початковий аналіз зафіксував, що `fix-doc-files` / `fix-doc-files --stamp` штампували у frontmatter лише `source`, `crc` і опційно `score`/`issues`, а фактичний model-id лишався тільки у stdout-логах.
- Зачеплені місця: `npm/rules/doc-files/js/docgen-crc.mjs`, `npm/rules/doc-files/js/docgen-files-batch.mjs`, `npm/rules/doc-files/lint/tests/lint.test.mjs`.
- Для `--stamp`-режиму transcript вимагав явної поведінки без LLM: не вигадувати нову модель, а або пропускати поле, або зберігати попереднє значення.
