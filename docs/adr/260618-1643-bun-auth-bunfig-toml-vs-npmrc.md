---
type: ADR
title: "Bun auth: bunfig.toml install.scopes vs ~/.npmrc"
description: Для приватних пакетів @nitra у Bun робочий токен треба розміщувати у ~/.npmrc, коли scope і default registry мають той самий host.
---

**Status:** Accepted
**Date:** 2026-06-18

## Context and Problem Statement

У проєкті `abie/b2b` команда `npx @nitra/cursor@latest` оновила `package.json` до `^12.0.3`, але наступний `bun i` завершився `404` під час завантаження приватного пакета `@nitra/abie-shared@^0.4.1`.

Transcript фіксує причину: Bun відправляв токен із глобального `~/.npmrc`, а не токен із `[install.scopes]` у `bunfig.toml`, бо обидві конфігурації вказували на той самий host `registry.npmjs.org`.

## Considered Options

- Використовувати токен з `bunfig.toml` `[install.scopes]."@nitra"`, який уже був налаштований, але ігнорувався у фактичному запиті.
- Перенести робочий `@nitra`-токен у `~/.npmrc` як default token для `//registry.npmjs.org/:_authToken=…`.
- Замінити plaintext-токени у `bunfig.toml` на env-var інтерполяцію `token = "$NPM_TOKEN"` / `token = "$CAPAWESOME_TOKEN"` і додати `bunfig.toml` до `.gitignore`.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Перенести робочий `@nitra`-токен у `~/.npmrc`", because transcript показує, що Bun фактично відправляє токен з `~/.npmrc` для default registry, тому саме цей токен має мати доступ до `@nitra/*`; scope-token з `bunfig.toml` ігнорується, коли URL scope збігається з default registry.

### Consequences

- Good, because `bun i` має резолвити `@nitra/abie-shared@0.4.1`: transcript фіксує, що робочий токен повертає HTTP 200 і бачить версії `0.3.0`–`0.6.4`.
- Bad, because transcript фіксує security-ризик: `bunfig.toml` лишається git-tracked і містить plaintext npm-token та GitHub PAT; ці токени треба ротувати.
- Neutral, because transcript не містить підтвердження, що env-var інтерполяцію і `.gitignore` уже впроваджено; це зафіксовано лише як рекомендацію.

## More Information

- `abie/b2b/bunfig.toml` — git-tracked файл із `[install.scopes]."@nitra".token` і `[install.scopes]."@capawesome-team".token` у plaintext.
- `~/.npmrc` — глобальний файл; transcript фіксує, що на момент проблеми він містив токен, який повертав HTTP 404 для `@nitra/abie-shared`.
- Verbose-log `bun i` підтвердив, що Bun відправляв `Authorization: Bearer ...` саме з глобального `~/.npmrc`.
- Рекомендація з transcript: замінити plaintext у `bunfig.toml` на `token = "$NPM_TOKEN"` / `token = "$CAPAWESOME_TOKEN"`, додати файл до `.gitignore` і перевипустити обидва токени.
- `@nitra/abie-shared` latest у transcript: `0.6.4`; `abie/b2b` пінить `^0.4.1`, lockfile містив `0.3.0`.
