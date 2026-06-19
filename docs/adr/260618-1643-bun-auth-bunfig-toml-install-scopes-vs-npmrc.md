---
session: 55427876-48a8-4f72-8997-e05df0b40f38
captured: 2026-06-18T16:43:07+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/55427876-48a8-4f72-8997-e05df0b40f38.jsonl
---

---

## ADR Bun auth — `bunfig.toml` `[install.scopes]` vs `~/.npmrc`

## Context and Problem Statement
У проєкті `abie/b2b` команда `npx @nitra/cursor@latest` успішно оновила `package.json` до `^12.0.3`, але подальший `bun i` завершився з `404` під час спроби завантажити приватний пакет `@nitra/abie-shared@^0.4.1`. Причина: bun використовував токен із глобального `~/.npmrc`, а не токен із `[install.scopes]` у `bunfig.toml`, оскільки обидва вказують на один і той самий host `registry.npmjs.org`.

## Considered Options
* Використовувати токен з `bunfig.toml` `[install.scopes]."@nitra"` (вже налаштований, але ігнорується)
* Перенести робочий `@nitra`-токен у `~/.npmrc` як дефолтний (`//registry.npmjs.org/:_authToken=…`)
* Замінити plaintext-токени у `bunfig.toml` на env-var інтерполяцію (`token = "$NPM_TOKEN"`) і додати `bunfig.toml` до `.gitignore`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Перенести робочий `@nitra`-токен у `~/.npmrc`", because це негайно усуває конфлікт: bun відправляє токен з `~/.npmrc` для дефолтного registry, тому саме там має бути токен із доступом до `@nitra/*`; токен з `bunfig.toml` `[install.scopes]` ігнорується, коли URL scope збігається з дефолтним registry.

### Consequences
* Good, because `bun i` почне резолвити `@nitra/abie-shared@0.4.1` (verified: token `npm_jQ8LJ…` повертає HTTP 200, всі версії від `0.3.0` до `0.6.4` видимі).
* Bad, because `bunfig.toml` залишається git-tracked із двома секретами в plaintext: npm-токен (`npm_jQ8LJ…`) і GitHub PAT (`ghp_G1g…` для `@capawesome-team`). Transcript прямо фіксує це як ризик — секрети доступні всім з доступом до репо і потребують ротації.

## More Information
- Файл `abie/b2b/bunfig.toml` — git-tracked, не в `.gitignore`; містить `[install.scopes]."@nitra".token` і `[install.scopes]."@capawesome-team".token` у plaintext.
- `~/.npmrc` — глобальний; містить токен `npm_DyLRO…`, який повертає HTTP 404 для `@nitra/abie-shared`.
- Verbose-лог `bun i` підтвердив: `Authorization: Bearer npm_DyLRO…` — саме глобальний токен відправляється на `registry.npmjs.org`.
- Рекомендація з transcript: замінити plaintext-значення у `bunfig.toml` на `token = "$NPM_TOKEN"` / `token = "$CAPAWESOME_TOKEN"` і додати файл до `.gitignore`; паралельно перевипустити обидва токени.
- `@nitra/abie-shared` latest: `0.6.4`; b2b зараз пінить `^0.4.1` (lockfile містив `0.3.0`).
