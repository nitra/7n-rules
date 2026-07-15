---
type: ADR
title: "N_LOCAL_MIN_MODEL для локальної omlx-моделі docgen"
description: Локальна модель для fix-doc-files має задаватися через канонічний тир-env N_LOCAL_MIN_MODEL замість docgen-специфічного env.
---

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

`fix-doc-files` викликає локальний omlx-сервер. Пакетний дефолт моделі `mlx-community--gemma-4-e2b-it-4bit` не збігався з іменем, яке повертає omlx-сервер: `gemma-4-e2b-it-4bit` без HF-org-префікса. Спочатку розглядався docgen-специфічний env `N_CURSOR_DOCGEN_MODEL`, але потрібно було знайти універсальний env для всіх скілів.

## Considered Options

- Лишити `N_CURSOR_DOCGEN_MODEL` як docgen-specific env.
- Self-heal у пакеті: при `model not found` зрізати `<org>--` префікс.
- Використати існуючий `N_LOCAL_MIN_MODEL` як universal env тир-системи `resolveModel('min')`.

## Decision Outcome

Chosen option: "Використати `N_LOCAL_MIN_MODEL`", because пакет уже має `resolveModel('min')`, а docgen читає `N_CURSOR_DOCGEN_MODEL ?? resolveModel('min')`, тому `N_LOCAL_MIN_MODEL` застосовується автоматично без зміни пакета.

### Consequences

- Good, because один рядок у `~/.zshenv` налаштовує модель для docgen і для інших скілів, які використовують тир `min`.
- Good, because transcript фіксує успішну генерацію `fix-doc-files` без env-префікса в команді зі score=100.
- Bad, because дефолт у пакеті `mlx-community--gemma-4-e2b-it-4bit` лишився несумісним із локальним omlx-ідентифікатором і без env усе ще може давати `Model not found`.

## More Information

Transcript facts:

- Встановлено `export N_LOCAL_MIN_MODEL=omlx/gemma-4-e2b-it-4bit` у `~/.zshenv`.
- `npm/lib/models.mjs` містить `resolveModel` і `LOCAL_MIN`.
- `~/.zshenv` підхоплюється non-interactive zsh.
- Модель `gemma-4-e4b-it-OptiQ-4bit` не підходить на 16GB Mac: потребує 13.07GB, ceiling omlx = 11.84GB.
- `gemma-4-e2b-it-4bit` вміщується на цій машині.
- Self-heal для de-prefixed id не реалізовано в цій сесії.
