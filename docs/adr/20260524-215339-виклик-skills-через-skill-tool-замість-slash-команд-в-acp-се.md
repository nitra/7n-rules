---
session: 67092753-dd58-41fc-95cc-62403acd1407
captured: 2026-05-24T21:53:39+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/67092753-dd58-41fc-95cc-62403acd1407.jsonl
---

## ADR Виклик skills через `Skill` tool замість slash-команд в ACP-середовищах

## Context and Problem Statement
При використанні Claude Code через **Agent Client Protocol** (ACP) — наприклад, у Zed або Neovim — клієнт повідомляє `Available commands: none`, і slash-команди типу `/n-lint`, `/n-fix` не виконуються. ACP-міст не транслює slash-команди до харнеса як «команди клієнта».

## Considered Options
* Викликати skill через `Skill` tool безпосередньо (обхід ACP-обмеження)
* Запустити `claude` без ACP, де slash-команди працюють штатно
* Виконати дію вручну в терміналі (наприклад, `bun run lint` замість `/n-lint`)

## Decision Outcome
Chosen option: "Викликати skill через `Skill` tool безпосередньо", because ACP-міст ламається лише на рівні переліку команд клієнта, тоді як tool-виклики він проксує нормально — тобто `Skill(skill="n-lint")` спрацьовує там, де `/n-lint` недоступна.

### Consequences
* Good, because transcript фіксує очікувану користь: skills виконуються з повним набором тулів (Read/Edit/Bash/Grep) у контексті поточної сесії без обходу через окремий процес чи субагент.
* Bad, because виклик через `Skill` tool вимагає явного запиту до Claude (людина або агент мають ініціювати `Skill(…)` вручну), тоді як slash-команда могла б бути однорядковим shortcut у клієнті.

## More Information
- Skills завантажуються з `.claude/skills/<name>/SKILL.md` та плагінів; на старті сесії харнес передає лише метадані (name + description), повний вміст — лише при виклику `Skill`.
- Заборона паралельних eslint задокументована в `CLAUDE.md`: `bun run lint` має бути одним послідовним прогоном.
- Перевірка CHANGELOG перед фінішем: `npx @nitra/cursor check changelog` (feedback_changelog).
- ACP-специфічна поведінка не пов'язана з конкретним файлом у репо — це поведінка протоколу між клієнтом і харнесом.
