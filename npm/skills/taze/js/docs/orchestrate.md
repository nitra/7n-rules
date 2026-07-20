---
type: JS Module
title: orchestrate.mjs
resource: npm/skills/taze/js/orchestrate.mjs
docgen:
  crc: 63cee070
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Оркеструє taze як чистий цикл по EcosystemProvider-ах (фаза 5a spec lang-plugins-extraction: ядро — двигун без мовної специфіки). ВСІ екосистеми, включно з npm/bun (`@7n/rules-lang-js`), приходять з плагінів (extension-point `taze`): для кожного провайдера — detect → available → backup → bump → diff, далі по одному ізольованому виклику раннера на кожен major-запис (`promptFor` провайдера), потім cleanup і композиція Markdown-звіту. Виконує файлові операції і запускає зовнішні команди (git, npx для worktree-бутстрапу, команди провайдерів) — не read-only.

## Поведінка

- **callRunner** — диспетчер одного ітеративного виклику: `pi` — вбудований pi-агент (текст через `deps.out`), `cursor`/`codex` — napi-міст ACP (`@7n/llm-lib/acp`).
- **loadPluginTazeProviders** — завантажує провайдерів з активних плагінів: `.n-rules.json`/автодетект → `resolvePlugins` (плагін доставляється автоматично при першому запуску) → handler-модулі extension-point `taze` → валідація `assertEcosystemProvider`; битий плагін — warning і пропуск, не провал.
- **formatReport** — Markdown-звіт: рівноправна секція на кожну екосистему з manifests (без manifests — тиша) + загальний підсумок; без окремого LLM-виклику.
- **runTazeOrchestrator** — повний прогін: гарантує ізольований worktree (авто-створює `<branch>-taze` через `npx @7n/mt worktree create`, після завершення переносить зміни назад і прибирає авто-створене дерево), проганяє кожного провайдера наскрізь і повертає `{ ok, report, ecosystems }`. Без жодного taze-провайдера — попередження (для npm/bun-гілки потрібен `@7n/rules-lang-js`).
- **bringChangesBackToOriginal** / **removeAutoCreatedWorktree** — перенесення незакомічених змін з авто-створеного worktree у вихідне дерево і його прибирання.

## Публічний API

- callRunner — виклик обраного раннера (`pi`/`cursor`/`codex`) з одним промптом.
- loadPluginTazeProviders — валідні EcosystemProvider-и з handler-модулів плагінів.
- formatReport — фінальний Markdown-звіт із записів екосистем.
- runTazeOrchestrator — повна оркестрація taze; `deps.ecosystemProviders` повністю замінює список провайдерів (для тестів).
- bringChangesBackToOriginal / removeAutoCreatedWorktree — життєвий цикл авто-створеного worktree.

## Гарантії поведінки

- Виконує файлові операції і запускає зовнішні команди — НЕ read-only.
- Кроки оркестрації виконуються лише в ізольованому worktree; авто-створене дерево прибирається у `finally` навіть при винятку, зміни переносяться назад.
- Виняток усередині одного провайдера (bump/diff/команда) не зупиняє інших — фіксується в `error` запису екосистеми й у звіті; `ok` результату тоді false.
- Падіння одного пакета в ізольованому виклику раннера не втрачає прогрес по інших записах.
