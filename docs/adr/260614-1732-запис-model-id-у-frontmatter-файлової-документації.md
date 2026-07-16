---
type: ADR
title: Запис model-id у frontmatter файлової документації
description: Docgen-файли зберігають model-id генератора у frontmatter, щоб бачити, якою локальною моделлю створено документацію.
---

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

Frontmatter файлових docgen-документів фіксував `source` і `crc`, а також опційний quality-блок, але не зберігав модель, якою згенеровано markdown. Після заміни локальної tier-`min` моделі з `gemma-4-e2b-it-4bit` на `gemma-4-e4b-it-OptiQ-4bit` стало неможливо ретроспективно відрізнити документи, створені старою моделлю, від документів, створених новою.

## Considered Options

- Phase 1: пасивно записувати `model` у frontmatter; drift-детектор реалізувати пізніше.
- Одразу реалізувати і запис `model`, і drift-детектор, щоб `lint-doc-files` позначав документацію stale при зміні моделі.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Phase 1: пасивний запис `model` у frontmatter; drift-детектор — пізніше", because користувач явно сказав «Phase 1 зараз, а drift-детектор пізніше».

### Consequences

- Good, because після зміни локальної моделі у frontmatter видно, якою моделлю згенеровано конкретний md-файл.
- Good, because старі документи лишаються сумісними: поле `model` опційне, а parser повертає `model: null` для frontmatter без цього поля.
- Good, because `--stamp`-режим без LLM зберігає наявне значення `model` через `readDocModel(docAbs)`.
- Bad, because без drift-детектора `lint-doc-files` не вважає документ stale лише через зміну моделі; старі документи лишаються свіжими за CRC до реалізації фази 2.
- Neutral, because transcript не містить підтвердження фінальної політики для документів, які ще не мають `model` у frontmatter.

## More Information

- Змінені файли: `npm/rules/doc-files/js/docgen-crc.mjs`, `npm/rules/doc-files/js/docgen-files-batch.mjs`, `npm/rules/doc-files/js/tests/docgen-crc.test.mjs`.
- Нові/змінені символи: `MODEL_RE`, `readDocModel()`, `buildDocFrontmatter(source, crc, quality=null, model=null)`, `stampDoc(md, source, crc, quality=null, model=null)`, `parseDocFrontmatter` → `data.model`.
- Формат поля у frontmatter:

```yaml
docgen:
source: src/lib/foo.js
crc: a3f1c9e0
model: omlx/gemma-4-e4b-it-OptiQ-4bit
```

- Значення — повний model-id з provider prefix, як повертає `resolveModel`.
- У generation path `result.model` з `generateDoc` передається до `stampDoc`.
- У `--stamp` path без LLM поточне значення читається з документа і зберігається.
- Локальну tier-`min` модель у `~/.zshenv` оновлено з `omlx/gemma-4-e2b-it-4bit` на `omlx/gemma-4-e4b-it-OptiQ-4bit`.
- `resolveModel('min')` читає `N_LOCAL_MIN_MODEL` і має резервний каскад `N_LOCAL_MIN_MODEL` → `N_LOCAL_AVG_MODEL` → `N_LOCAL_MAX_MODEL` → `N_CLOUD_MIN_MODEL`.
- Health-check після зміни моделі підтвердив `{"ok":true}`.
- Тести docgen-crc після змін: 19/19 passed.

## Update 2026-06-14

- Додатково зафіксовано початкову мотивацію: `fix-doc-files` / `fix-doc-files --stamp` раніше штампували лише `source`, `crc` і опційні `score`/`issues`, тому фактична LLM-модель зберігалася лише в runtime stdout.
- Зачеплені місця з аналізу: `npm/rules/doc-files/js/docgen-crc.mjs`, `npm/rules/doc-files/js/docgen-files-batch.mjs`, `npm/rules/doc-files/lint/tests/lint.test.mjs`.
- Env-ланцюжок моделі на момент аналізу: `N_CURSOR_DOCGEN_MODEL` → `resolveModel('min')` → `omlx/${DEFAULT_OMLX_MODEL}`.
