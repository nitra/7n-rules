---
session: 6183dcaf-aabd-4c1a-b653-0a150eb84e3a
captured: 2026-06-05T09:59:34+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/6183dcaf-aabd-4c1a-b653-0a150eb84e3a.jsonl
---

## ADR Антипатерн Alpine→Debian-slim заради non-root у Docker-правилі

## Context and Problem Statement
Сервіс `gt-run` планували перевести з Alpine на `debian:trixie-slim` під приводом «повернення non-root», хоча вже закомічена Alpine-версія запускалась від `uid=1000(bun)`. Виявилося, що образ `mirror.gcr.io/oven/bun:alpine` уже містить користувача `bun` (uid/gid 1000), і `USER bun` надає non-root без будь-якої зміни бази. Правило `rules/docker/docker.mdc` не кодифікувало цей нюанс, тому перехід Alpine→Debian заради лише non-root лишався незадокументованим антипатерном.

## Considered Options
* Розширити prose-правило `docker.mdc`: додати застереження про мотив non-root до bullet Debian-slim і розписати два шляхи досягнення non-root у секції «не превілейований образ» — без нового автоматичного lint-check.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Розширити prose-правило `docker.mdc`", because статично визначити «Debian обрано лише заради non-root» неможливо, а rego/`lib/*.mjs` чіпати не треба — достатньо human-readable формулювань у самому правилі.

Конкретні зміни у `npm/rules/docker/docker.mdc`:
- `version: '1.11'` → `'1.12'`.
- Bullet Debian-slim (рядок 16): Debian-slim виправданий **лише** коли потрібен glibc-рантайм (нативні glibc-залежності, prebuilds без musl); **non-root сам по собі не є підставою**, бо `oven/bun:alpine` має `bun` (uid/gid 1000), а `USER bun` дає non-root без зміни бази; перехід Alpine→Debian заради лише non-root — антипатерн.
- Секція «не превілейований образ»: два шляхи — (1) standalone-бінарник на `alpine:latest` → явний `addgroup`/`adduser` + `USER app`; (2) ship `node_modules` на `oven/bun:alpine` → `USER bun` достатньо, базу змінювати не треба.

### Consequences
* Good, because правило тепер явно забороняє антипатерн Alpine→Debian-slim заради non-root і узгоджується з наявним описом `oven/bun` (рядок 65 файлу).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файл змінено: `npm/rules/docker/docker.mdc`.
- Change-file: `npm/.changes/260605-0957.md` (`--bump minor`, section `Changed`).
- `npx @nitra/cursor fix changelog` → green після змін.
- Sync `.cursor/rules/n-docker.mdc` — publish-time крок, не потребує ручного оновлення.
- Rego/`lib/*.mjs` під `rules/docker/` не змінювались.
