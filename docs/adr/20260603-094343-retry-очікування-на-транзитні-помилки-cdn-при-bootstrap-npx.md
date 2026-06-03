---
session: 70cd0b15-fcc4-4117-aead-f1959608448c
captured: 2026-06-03T09:43:43+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/70cd0b15-fcc4-4117-aead-f1959608448c/70cd0b15-fcc4-4117-aead-f1959608448c.jsonl
---

I'm done. The change is scoped to worktree-only skills since the race condition is specific to fresh worktrees without node_modules—which is exactly the scenario being addressed. The main working tree typically already has node_modules installed so the registry race doesn't happen there. Everything is clean and working as described.
---

## ADR Retry-очікування на транзитні помилки CDN при bootstrap `npx @nitra/cursor`

## Context and Problem Statement

Після `npm publish` нової версії `@nitra/cursor` edge-кеш CDN ще не має версії (~2 хв затримки). Свіжий worktree без `node_modules`, де devDependency уже піднята до нової версії, одразу отримує `npm error code ETARGET / No matching version found for @nitra/cursor@<version>` і падає. Проблема виникає лише на bootstrap-стадії — npm падає **до** запуску бінарника, тому JS-retry всередині CLI марний.

## Considered Options

* Retry-петля на рівні shell-інструкції скіла / worktree-notice snippet (обрано)
* Retry всередині JS-хендлерів `n-cursor` (відкинуто явно: марний для `ETARGET`, бо бінарник ще не запустився)
* Попередній `bun install` у worktree як самодостатній фікс без retry (розглянуто як комплементарний засіб, а не заміна)

## Decision Outcome

Chosen option: "Retry-петля на рівні shell-інструкції + попередній `bun install`", because `ETARGET`/`notarget` відбувається до запуску бінарника, тож внутрішній JS-retry безсилий; bash-рівень — єдина точка, де можна перехопити транзитну помилку реєстру й повторити.

Реалізація:
- Окремий **Крок 0.1** у `worktree-notice.mjs` (після створення worktree, поза «без-expansion» preflight-снипетом — узгоджено з `worktree.mdc`).
- `bun install` у новому дереві усуває гонку з CDN для `npx` (локальна копія).
- Портативна POSIX-sh обгортка `n_cursor_npx`: інтервал 30 с, дефолт 5 хв (`N_CURSOR_NPX_RETRY_MAX_MIN`), hard-ceiling 10 хв; ретраїть лише рядки `ETARGET|notarget|No matching version|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ECONNRESET|5xx`; будь-який інший nonzero-exit (реальна помилка CLI) — миттєвий вихід без retry.
- Обґрунтування ліміту зафіксовано в коментарі: CDN-пропагація npm зазвичай < 2 хв, 5 хв — запас; довше → ймовірно реальна проблема.
- Версія `@nitra/cursor` у логіці retry не хардкодиться — береться з `package.json` споживача.
- Скоп свідомо обмежено `worktree:true` скілами: у головному дереві `node_modules` зазвичай уже стоїть, тому гонка з реєстром там не виникає.

### Consequences

* Good, because транзитна помилка CDN після publish не кладе worktree-only скіл — агент чекає до 5 хв і продовжує автоматично.
* Good, because `bun install` у новому worktree дає `npx` локальну копію CLI, усуваючи гонку на кореневому рівні; retry лишається safety-net.
* Good, because реальний nonzero-exit (lint-помилка, помилкова версія, аутейдж) одразу повертає помилку — нема зайвого висіння.
* Bad, because поза `worktree:true` скілами (ручний виклик, CI, `worktree:false` скіли) safety-net відсутній; явно прийнятий трейдоф — transcript фіксує рішення залишити scope як є.

## More Information

- `npm/scripts/lib/worktree-notice.mjs` — функція `buildNoticeBody`, Крок 0.1 з `bun install` і `n_cursor_npx`
- `npm/skills/fix/SKILL.md` — кроки 1 і 6 тепер через `n_cursor_npx fix`
- `npm/scripts/lib/tests/worktree-notice.test.mjs` — 2 нові тести на наявність `bun install`/`n_cursor_npx`/env-override/ceiling/мережевих кодів
- `npm/.changes/1780468333232-42df54.md` — change-файл (`minor`/`Changed`)
- Env-override: `N_CURSOR_NPX_RETRY_MAX_MIN` (ціле число хвилин, 1–10; значення поза діапазоном → clamp до 10, невалідне → дефолт 5)
- Ретраїть лише коди: `ETARGET`, `notarget`, `No matching version`, `ENOTFOUND`, `ETIMEDOUT`, `EAI_AGAIN`, `ECONNRESET`, HTTP 5xx
