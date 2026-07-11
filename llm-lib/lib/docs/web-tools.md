---
type: JS Module
title: web-tools.mjs
resource: llm-lib/lib/web-tools.mjs
docgen:
  crc: 4242c966
---

## Огляд

Web-доступ для cloud-профілів run-harness (Фаза A3): пара pi-tools `web_search`/`web_fetch` — мінімальне ядро без нових залежностей (референс — pi-web-access, без його fallback-ланцюгів провайдерів і browser-режимів). Вмикається лише явним профілем consumer-а (agent-fix `opts.webTools`, за дизайном — cloud-тири); дефолт вимкнено.

## Поведінка

`web_fetch` ходить лише на публічні http(s)-адреси: SSRF-guard блокує інші схеми, `localhost`/`*.local`/`*.internal` і літеральні приватні IP (v4-діапазони, v6 loopback/link-local/ULA); redirect-и проходяться вручну (до 3 hop-ів) з guard-перевіркою кожного hop-а. HTML зводиться до тексту власним мінімальним стрипером (script/style/noscript вирізаються ітеративно без regex-backtracking, блокові теги → переноси, entity декодуються); json/plain віддаються як є. Відповідь обрізається лімітом (`maxChars`, дефолт 20k символів) з чесним прапорцем `truncated`; таймаут запиту 20s.

`web_search` працює через ОДНОГО провайдера: явний `N_LLM_SEARCH_PROVIDER` або перший наявний ключ (`BRAVE_API_KEY` → `TAVILY_API_KEY` → `EXA_API_KEY`); результати нормалізуються до `{title, url, snippet}`. Без жодного ключа tool чесно повертає структуровану відмову з інструкцією конфігурації — не виняток.

Вміст сторінок повертається tool-result-ом (дані, не інструкції) — prompt-injection зі сторінок не отримує системного рівня; помилки обох tools — структурований JSON-текст із причиною.

## Публічний API

assertPublicHttpUrl — SSRF-guard: розбирає URL або кидає Error з причиною відмови.
htmlToText — мінімальна html→text екстракція (без DOM-залежностей).
fetchPage — fetch з guard-ом на кожному redirect-hop-і, таймаутом і лімітом розміру.
resolveSearchProvider — вибір search-провайдера за env.
createWebTools — фабрика tool-дефініцій `web_search`/`web_fetch` (defineTool і fetch інжектяться — модуль pi-free).

## Де використовується

`agent-fix.mjs`: `opts.webTools: true` додає обидва tools у сесію (перші споживачі — правила з зовнішнім знанням: pin-перевірки ga, taze-подібні). Прапорець фіксується у trace для аналізу.

## Гарантії поведінки

- Жодного мережевого виклику без явного tool-виклику агента; лише http/https на публічні адреси.
- Відповіді обмежені за розміром; guard-відмови детерміновані й пояснені.
- Модуль pi-free; усі зовнішні ефекти (fetch, env) інжектовані — тести без мережі.
