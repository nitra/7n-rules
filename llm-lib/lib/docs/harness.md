---
type: JS Module
title: harness.mjs
resource: llm-lib/lib/harness.mjs
docgen:
  crc: 3ff88af8
---

## Огляд

Run-harness фасад (Фаза A4): єдиний декларативний вхід над трьома раннерами пакета (`runOneShot` / `runAgentFix` / `runAgentSkill`). Consumer описує ЩО запустити профілем-обʼєктом, а не набором позиційних opts; той самий профіль серіалізується у JSON — це те, що дозволяє майбутньому MT-адаптеру мапити вузол графа на конфігурацію без коду. Фасад тонкий: резолвить профіль у opts і делегує в наявний раннер, не дублюючи їхньої логіки (write-guard, verify-loop, toolset-и лишаються в раннерах).

## Поведінка

Профіль — обʼєкт `{ schema_version, kind, …налаштування }`, де `kind` (`fix`/`skill`/`one-shot`) привʼязує його до раннера, а решта полів (tier, model, timeoutMs, maxTokens, thinkingLevel, verifyMax, anchoredEdits, webTools) стають дефолтами opts. `schema_version` присутній з першої версії й перевіряється на сумісність — несумісний або невідомий `kind` дає структуровану помилку валідації ще до раннера.

`createHarness({ profiles })` повертає обʼєкт із `run(spec)` і `profileNames()`. У `run` профіль задається іменем (з мапи) або інлайн-обʼєктом, а per-виклик поля (динаміка: cwd, violation, verify, messages, prompt тощо) зливаються поверх дефолтів профілю й перекривають збіжні. Далі harness делегує з правильними позиційними аргументами кожного раннера: `fix` → `(ruleId, violation, cwd, opts)`, `skill` → `(prompt, opts)`, `one-shot` → `(opts)`. Поля `kind`/`schema_version` у opts раннера не потрапляють.

Раннери тягнуться lazy (динамічний import у гілці потрібного `kind`) — top-level модуль лишається вільним від pi; у тестах раннери інжектуються через `deps`.

## Публічний API

HARNESS_SCHEMA_VERSION — поточна версія схеми профілю.
validateProfile — перевіряє `kind` і `schema_version`, повертає `{ok}` або `{ok:false, error}`.
createHarness — будує harness із іменованих профілів; `run(spec)` запускає задачу, `profileNames()` перелічує профілі.

## Гарантії поведінки

- Контракт раннерів не змінюється: harness лише перекладає профіль+виклик у їхні аргументи й повертає їхній результат як є.
- Невалідний/невідомий профіль зупиняється до виклику раннера (жодного часткового ефекту).
- Top-level pi-free: жодного pi-import, поки не викликано `run` відповідного kind.
