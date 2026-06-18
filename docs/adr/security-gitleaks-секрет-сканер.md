---
type: ADR
title: "Правило security — секрет-сканер через gitleaks"
---

# Правило security — секрет-сканер через gitleaks

**Status:** Accepted
**Date:** 2026-05-16

## Контекст

У репозиторії не було автоматизованого захисту від випадкового коміту секретів (API-ключів, токенів). Потрібна інтеграція в загальний `lint`-пайплайн, що спрацьовує на всіх проєктах автоматично, незалежно від стеку.

## Рішення

Створено нове правило `security` у `npm/rules/security/` з `alwaysApply: true` і `auto.md = завжди`. Правило вимагає:

1. `scripts.lint-security: gitleaks detect --no-banner` у `package.json`.
2. Включення `bun run lint-security` в агрегований `scripts.lint`.
3. Файл `.gitleaks.toml` у корені репозиторію з `useDefault = true` у секції `[extend]`.
4. Відсутності `gitleaks` у `(dev)Dependencies` — це бінарний інструмент, не npm-залежність.

Rego-частина (`policy/package_json/`) валідує `package.json` per-document (9 unit-тестів). JS-частина (`fix/gitleaks/check.mjs`) перевіряє файлову систему: наявність `.gitleaks.toml` і значення поля `useDefault`. Dogfood виконано безпосередньо в репозиторії `cursor`: додано `lint-security` у `package.json`, створено `.gitleaks.toml`, записано зміни в CHANGELOG. Версія `@nitra/cursor` підвищена з `1.11.17` до `1.12.0`.

## Обґрунтування

`gitleaks` — де-факто стандарт для статичного скану git-репозиторіїв на секрети. Режим `detect --no-banner` дає чистий CI-вивід без зайвого шуму. Правило позначено always-on, бо секрет-сканер не залежить від стеку й однаково корисний кожному проєкту — так само як `text` чи `adr`.

## Розглянуті альтернативи

`truffleHog` (складніша установка), `detect-secrets` (Python-залежність), `secretlint` (npm, але повільніший) не розглядалися предметно. Обрано `gitleaks detect` як найпростіший одно-бінарний варіант із встановленням через `brew install gitleaks`.

## Зачіпає

`npm/rules/security/` (новий каталог), `npm/scripts/auto-rules.mjs`, `npm/scripts/auto-rules.test.mjs`, `package.json` (кореневий), `.gitleaks.toml` (новий файл), `CHANGELOG.md`, `npm/CHANGELOG.md`, `npm/package.json`
