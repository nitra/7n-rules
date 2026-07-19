---
type: ADR
title: "Bun auth: bunfig.toml install.scopes vs ~/.npmrc"
description: Рішення зафіксувало використання робочого @nitra-токена в ~/.npmrc для bun install, коли scope registry збігається з default registry.
---

**Status:** Accepted

**Date:** 2026-06-18

## Context and Problem Statement

У проєкті `abie/b2b` команда `npx @nitra/cursor@latest` оновила `package.json` до `^12.0.3`, але подальший `bun i` завершився `404` під час завантаження приватного пакета `@nitra/abie-shared@^0.4.1`.

Transcript фіксує причину: bun відправляв токен із глобального `~/.npmrc`, а не токен із `[install.scopes]` у `bunfig.toml`, бо обидва налаштування вказували на той самий host `registry.npmjs.org`.

## Considered Options

- Використовувати токен з `bunfig.toml` `[install.scopes]."@nitra"`, який уже був налаштований, але ігнорувався bun у цьому сценарії.
- Перенести робочий `@nitra`-токен у `~/.npmrc` як default token для `//registry.npmjs.org/:_authToken=…`.
- Замінити plaintext-токени у `bunfig.toml` на env-var інтерполяцію (`token = "$NPM_TOKEN"`) і додати `bunfig.toml` до `.gitignore`.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Перенести робочий `@nitra`-токен у `~/.npmrc`", because bun відправляє токен із `~/.npmrc` для default registry, тому саме цей токен має мати доступ до `@nitra/*`; токен з `bunfig.toml` `[install.scopes]` ігнорується, коли URL scope збігається з default registry.

### Consequences

- Good, because `bun i` має резолвити `@nitra/abie-shared@0.4.1`; transcript фіксує, що робочий token повертав HTTP 200 і бачив версії від `0.3.0` до `0.6.4`.
- Bad, because `bunfig.toml` залишався git-tracked із plaintext секретами: npm token для `@nitra` і GitHub PAT для `@capawesome-team`; transcript прямо фіксує потребу ротації цих секретів.
- Neutral, because transcript містить рекомендацію перейти на `token = "$NPM_TOKEN"` / `token = "$CAPAWESOME_TOKEN"` і додати `bunfig.toml` до `.gitignore`, але не підтверджує виконання цієї міграції.

## More Information

- Проєкт: `abie/b2b`.
- Файл `abie/b2b/bunfig.toml` був git-tracked і містив `[install.scopes]."@nitra".token` та `[install.scopes]."@capawesome-team".token` у plaintext.
- Глобальний `~/.npmrc` містив токен, який повертав HTTP 404 для `@nitra/abie-shared`.
- Verbose-log `bun i` показав `Authorization: Bearer ...` саме з глобального `~/.npmrc`.
- `@nitra/abie-shared` latest у transcript: `0.6.4`; `b2b` пінить `^0.4.1`, lockfile містив `0.3.0`.
