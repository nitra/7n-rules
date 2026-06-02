---
session: 6fe23dd0-c98a-4062-9d55-2dc4ce97b956
captured: 2026-06-02T09:27:25+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/6fe23dd0-c98a-4062-9d55-2dc4ce97b956.jsonl
---

## ADR Flow-стан як sibling-файл поруч з worktree-директорією

## Context and Problem Statement
`flow review` потребує `base_commit` та метаданих задачі (level, risk, plan, status), щоб побудувати правильний `git diff`. Постало питання, де зберігати цей стан відносно git-worktree — всередині нього чи поруч.

## Considered Options
* Sibling-файл `.worktrees/<branch>.flow.json` (поряд із директорією worktree)
* Файл всередині worktree-директорії

## Decision Outcome
Chosen option: "Sibling-файл `.worktrees/<branch>.flow.json`", because так стан видимий інструментам ззовні директорії worktree (наприклад, `flow review` читає його через `statePath`, обчислений у `state-store.mjs` за путем worktree) і не забруднює git-індекс самого worktree.

### Consequences
* Good, because transcript фіксує очікувану користь: `readState(statePath)` у `review.mjs:116–121` знаходить стан через стандартну конвенцію `<worktree-path>.flow.json`, без потреби заходити всередину.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/scripts/dispatcher/lib/state-store.mjs:4–7` — документація конвенції sibling-файлу
- `npm/scripts/dispatcher/lib/review.mjs:116–123` — читання стану й вилучення `base_commit`
- `npm/scripts/dispatcher/lib/commands.mjs:99–117` — запис стану після `worktree add`

---

## ADR `flow init` як ідемпотентна надмножина `worktree add`

## Context and Problem Statement
Worktree може бути створений як через `flow init`, так і через голий `n-cursor worktree add`. У другому випадку flow-стан відсутній, і `flow review` / `verify` / `release` не мають що читати. Потрібна можливість "добрати" стан без знесення існуючого worktree.

## Considered Options
* `flow init` перевіряє через `isLinkedWorktree(cwd)`: якщо вже у worktree — пропускає `worktree add`, але пише `.flow.json`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`flow init` з перевіркою `isLinkedWorktree`", because це дозволяє повторно викликати `flow init` зсередини вже існуючого worktree для ініціалізації стану без подвійного вкладання ізоляції.

### Consequences
* Good, because transcript фіксує очікувану користь: виклик `npx @nitra/cursor flow init feat/coverage-changed-gate "..."` у `.worktrees/feat-coverage-changed-gate/` вивів `flow: уже в worktree … — не вкладаю новий` і записав `feat-coverage-changed-gate.flow.json`, не знищуючи existing worktree.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/scripts/dispatcher/lib/commands.mjs:76–77` — guard `if (isLinkedWorktree(cwd))`
- `npm/scripts/dispatcher/lib/commands.mjs:79` — `worktree add` викликається лише коли guard не спрацьовує
- Команда, виконана в сесії: `cd .worktrees/feat-coverage-changed-gate && npx @nitra/cursor flow init feat/coverage-changed-gate "..."` → вивела `init: feat/coverage-changed-gate (level 1, risk low) → …feat-coverage-changed-gate.flow.json`
