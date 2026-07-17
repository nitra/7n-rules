---
type: ADR
title: "Model id у frontmatter docgen-файлів"
description: Згенерована файлова документація має зберігати `model` у frontmatter, щоб було видно, якою LLM-моделлю створено документ.
---

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

Frontmatter файлової документації, яку генерує docgen, фіксував `source` і `crc`, а також опційні quality-поля, але не зберігав ідентифікатор моделі. Після оновлення локальної tier-`min` моделі з `gemma-4-e2b-it-4bit` на `gemma-4-e4b-it-OptiQ-4bit` без поля `model` неможливо визначити, які документи створені старою моделлю, а які — новою.

## Considered Options

- Phase 1: пасивно записувати `model` у frontmatter; drift-детектор реалізувати пізніше.
- Одразу реалізувати і запис `model`, і drift-детектор, щоб `lint-doc-files` позначав документацію stale при зміні моделі.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Phase 1: пасивно записувати `model` у frontmatter; drift-детектор реалізувати пізніше", because user явно сказав: «Phase 1 зараз, а drift-детектор пізніше».

### Consequences

- Good, because у frontmatter видно, якою моделлю згенеровано конкретний md-файл.
- Good, because старі документи без `model` лишаються сумісними: parser повертає `model: null`.
- Good, because `--stamp` шлях без LLM може зберігати наявне значення `model` через `readDocModel(docAbs)`.
- Bad, because без drift-детектора `lint-doc-files` не вважає документ stale лише через зміну моделі; CRC може лишатися свіжим.
- Neutral, because transcript фіксує зміну `N_LOCAL_MIN_MODEL` у `~/.zshenv` на `omlx/gemma-4-e4b-it-OptiQ-4bit`, але це окреме налаштування середовища, а не формат frontmatter.

## More Information

- Змінені файли: `npm/rules/doc-files/js/docgen-crc.mjs`, `npm/rules/doc-files/js/docgen-files-batch.mjs`, `npm/rules/doc-files/js/tests/docgen-crc.test.mjs`.
- Нові або змінені символи: `MODEL_RE`, `readDocModel()`, `buildDocFrontmatter(source, crc, quality=null, model=null)`, `stampDoc(md, source, crc, quality=null, model=null)`, `parseDocFrontmatter` → `data.model`.
- Формат поля у frontmatter: `docgen.model: omlx/gemma-4-e4b-it-OptiQ-4bit`.
- Значення — повний model-id з provider prefix, як повертає `resolveModel`.
- У generation path `result.model` з `generateDoc` передається до `stampDoc`.
- Transcript фіксує, що тести `docgen-crc` пройшли: 19/19.
- Суміжне налаштування середовища: `~/.zshenv:4`, `N_LOCAL_MIN_MODEL=omlx/gemma-4-e4b-it-OptiQ-4bit`; попереднє значення — `omlx/gemma-4-e2b-it-4bit`.
