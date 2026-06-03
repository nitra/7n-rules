---
session: 70cd0b15-fcc4-4117-aead-f1959608448c
captured: 2026-06-03T09:43:39+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/70cd0b15-fcc4-4117-aead-f1959608448c/70cd0b15-fcc4-4117-aead-f1959608448c.jsonl
---

---
[user]
<timestamp>Wednesday, Jun 3, 2026, 10:23 AM (UTC+3)</timestamp>
<user_query>
analyze session and write adr
</user_query>

---

## ADR retry-обгортки bootstrap-виклику `npx @nitra/cursor` у worktree-only скілах

## Context and Problem Statement

Після `npm publish` нової версії `@nitra/cursor` свіжий worktree без `node_modules` одразу запускає `npx @nitra/cursor <cmd>`, але edge-кеш CDN реєстру ще не отримав пакет. Це призводить до помилки `ETARGET` / `No matching version found for @nitra/cursor@x.y.z`, яка зникає через ~2 хв після пропагації. Retry потрібен лише на транзитних помилках реєстру/мережі — реальний nonzero-exit (CLI запустився і повернув помилку від `fix`/lint) ретраїти не можна.

## Considered Options

* Retry-обгортка на рівні shell-інструкції скіла / worktree-notice (портативний bash-loop, матч stderr по `ETARGET`/мережевих кодах)
* Retry у JS-хендлерах `n-cursor` (відкинуто: на `ETARGET` npm падає до запуску бінарника)
* Комплементарно: `bun install` у worktree одразу після `worktree add` (локальна копія пакета усуває гонку з CDN; retry залишається safety-net)

## Decision Outcome

Chosen option: "Retry-обгортка `n_cursor_npx` на рівні shell-інструкції + `bun install` після `worktree add`", because JS-рівень недосяжний коли npm падає до запуску бінарника (`ETARGET`), тоді як bash-loop може матчити stderr і розрізняти транзитні помилки реєстру від реальних CLI-помилок. `bun install` у новому дереві усуває першопричину гонки; retry-петля лишається safety-net.

Scope обмежено `worktree:true` скілами (7 скілів: `fix`, `lint`, `taze`, `fix-tests`, `coverage-fix`, `docgen`, `adr-normalize`), бо гонка виникає тільки в свіжих деревах без `node_modules`; у головному дереві `node_modules` зазвичай уже стоїть і `npx` бере локальну копію.

### Consequences

* Good, because `bun install` усуває гонку з CDN першопричинно — `npx` більше не йде в реєстр, якщо пакет вже встановлений локально.
* Good, because retry-обгортка є safety-net для випадків, де `bun install` не допоміг (нова версія ще не в lockfile, CI без кешу тощо); інтервал 30 с, дефолт 5 хв, hard-ceiling 10 хв, env-override `N_CURSOR_NPX_RETRY_MAX_MIN`.
* Good, because реальний nonzero-exit CLI (наприклад, `fix` знайшов порушення) не ретраїться — миттєвий вихід.
* Bad, because retry-петля і `bun install` покривають лише `worktree:true` скіли; ручні/CI-виклики `npx @nitra/cursor` поза worktree-блоком захисту не отримують.

## More Information

Змінені файли:
- `npm/scripts/lib/worktree-notice.mjs` — Крок 0.1 (окремий крок після no-expansion preflight-snippet, узгоджено з `worktree.mdc`): `bun install` + визначення `n_cursor_npx()`
- `npm/skills/fix/SKILL.md` — кроки 1 і 6 перейшли на `n_cursor_npx fix`
- `npm/scripts/lib/tests/worktree-notice.test.mjs` — 2 нові тести на наявність `bun install`, `n_cursor_npx`, env-override, ceiling, мережевих кодів
- `npm/.changes/1780468333232-42df54.md` — change-файл `minor/Changed`

Retry розрізняє транзитні помилки матчем stderr: `ETARGET|notarget|No matching version|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ECONNRESET|ERR_SOCKET|503|502|500|504`. Будь-який інший nonzero-exit — `break` без retry.

Обґрунтування ліміту 5 хв: CDN-пропагація npm зазвичай < 2 хв; 5 хв — запас; довше → ймовірно реальна проблема (невірна версія / аутейдж), краще віддати помилку, ніж висіти.
