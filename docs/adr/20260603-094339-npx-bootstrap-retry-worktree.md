---
type: ADR
title: "Retry-обгортка bootstrap-виклику `npx @nitra/cursor` у worktree-only скілах"
---

# Retry-обгортка bootstrap-виклику `npx @nitra/cursor` у worktree-only скілах

**Status:** Accepted
**Date:** 2026-06-03

## Context and Problem Statement
Після `npm publish` нової версії `@nitra/cursor` edge-кеш CDN реєстру ще не отримав пакет (~2 хв затримки). Свіжий worktree без `node_modules`, де devDependency вже оновлена до нової версії, одразу запускає `npx @nitra/cursor <cmd>` і отримує `npm error code ETARGET / No matching version found for @nitra/cursor@x.y.z` — npm падає до запуску бінарника, тому JS-retry всередині CLI марний.

## Considered Options
- Retry-обгортка на рівні shell-інструкції скіла / worktree-notice (портативний POSIX-sh loop, матч stderr по `ETARGET`/мережевих кодах)
- Retry у JS-хендлерах `n-cursor` (відкинуто: `ETARGET` виникає до запуску бінарника — бінарник ще не запустився)
- `bun install` у worktree одразу після `worktree add` як комплементарний засіб (локальна копія пакета усуває гонку з CDN; retry залишається safety-net)
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Retry-обгортка `n_cursor_npx` на рівні shell-інструкції + `bun install` після `worktree add`", because `ETARGET` відбувається до запуску бінарника, тож внутрішній JS-retry безсилий; bash-рівень — єдина точка перехоплення транзитної помилки реєстру. `bun install` у новому дереві усуває першопричину гонки (локальна копія дає `npx` доступ без реєстру); retry-петля залишається safety-net.

Scope обмежено `worktree:true` скілами (fix, lint, taze, fix-tests, coverage-fix, docgen, adr-normalize): гонка виникає лише в свіжих деревах без `node_modules`; у головному дереві `node_modules` зазвичай уже встановлено.

### Consequences
- Good, because `bun install` усуває гонку з CDN першопричинно — `npx` не звертається до реєстру, якщо пакет уже встановлений локально.
- Good, because retry-обгортка є safety-net: інтервал 30 с, дефолт 5 хв (`N_CURSOR_NPX_RETRY_MAX_MIN`), hard-ceiling 10 хв; ретраїть лише транзитні коди (`ETARGET|notarget|No matching version|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ECONNRESET|ERR_SOCKET|5xx`); будь-який інший nonzero-exit (реальна помилка CLI) — миттєвий вихід без retry.
- Good, because версія `@nitra/cursor` у логіці retry не хардкодиться — береться з `package.json` споживача.
- Bad, because safety-net покриває лише `worktree:true` скіли; ручні/CI-виклики `npx @nitra/cursor` поза worktree-блоком захисту не отримують.

## More Information
- `npm/scripts/lib/worktree-notice.mjs` — Крок 0.1 (після no-expansion preflight-snippet, узгоджено з `worktree.mdc`): `bun install` + визначення POSIX-sh функції `n_cursor_npx()`.
- `npm/skills/fix/SKILL.md` — кроки 1 і 6 перейшли на `n_cursor_npx fix`.
- `npm/scripts/lib/tests/worktree-notice.test.mjs` — 2 нові тести: наявність `bun install`, `n_cursor_npx`, env-override, ceiling, мережевих кодів.
- `npm/.changes/1780468333232-42df54.md` — change-файл `minor/Changed`.
- Env-override: `N_CURSOR_NPX_RETRY_MAX_MIN` (ціле, 1–10; поза діапазоном → clamp до 10, невалідне → дефолт 5).
- Обґрунтування ліміту: CDN-пропагація npm зазвичай < 2 хв; 5 хв — запас; довше → ймовірно реальна проблема (невірна версія / аутейдж).
