---
session: 67092753-dd58-41fc-95cc-62403acd1407
captured: 2026-05-25T17:45:50+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/67092753-dd58-41fc-95cc-62403acd1407.jsonl
---

## ADR Стратегія виклику skills у claude-acp-режимі

## Context and Problem Statement

Клієнт `claude-acp` (використовується в Zed, Neovim та подібних ACP-інтеграціях) повертає `Available commands: none`, тому slash-команди типу `/n-lint` недоступні безпосередньо в чаті. При цьому внутрішній `Skill` tool агента продовжує працювати через ACP-міст як звичайний tool call.

## Considered Options

* Просити агента природною мовою (`виконай n-lint`, `запусти skill n-lint`)
* Переходити на нативний `claude` CLI (`claude` або `claude -p "/n-lint"`) поза ACP
* Читати `.cursor/skills/<name>/SKILL.md` вручну і виконувати кроки самостійно

## Decision Outcome

Chosen option: "Просити агента природною мовою", because ACP-міст коректно проксює `Skill` tool як звичайний tool call, тоді як slash-команди клієнта ACP наразі не транслює. Достатньо написати в чат, наприклад, «виконай n-lint» — агент розпізнає намір і викличе `Skill(skill="n-lint")` самостійно.

### Consequences

* Good, because підхід не потребує зміни клієнта чи переходу на окремий термінал — працює в будь-якому ACP-сумісному редакторі.
* Bad, because залежить від того, що агент правильно зіставить природний запит з потрібним skill; неточне формулювання може призвести до виклику не того skill або до відсутності виклику.

## More Information

- Skills-метадані (name + description) завантажуються на старт сесії з `.cursor/skills/<name>/SKILL.md` та плагінів; повний вміст підвантажується лазнево при виклику `Skill` tool.
- Альтернатива: `claude` (інтерактивний) або `claude -p "/n-lint"` (one-shot) у звичайному терміналі — slash-команди там працюють штатно.
- Альтернатива для ручного запуску: `cat .cursor/skills/n-lint/SKILL.md`, далі — `bun run lint` у корені монорепо (одним послідовним прогоном, відповідно до заборони в CLAUDE.md).
