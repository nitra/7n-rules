---
session: 23e553b6-6bb0-45e4-bb88-629bade3d8f7
captured: 2026-05-31T15:55:31+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor--claude-worktrees-keen-swanson-f7dff6/23e553b6-6bb0-45e4-bb88-629bade3d8f7.jsonl
---

Є дублікат у git index — однаковий blob під двома кодуваннями `×` (macOS NFC/NFD). Unstage зайвий, лишаємо лише spec:
[assistant]
[tool: Bash] {"command":"cd /Users/vitaliytv/www/nitra/cursor/.claude/worktrees/keen-swanson-f7dff6 && git reset HEAD \"docs/adr/20260531-141658-n-cursor-×-superpowers-lifecycle-composition.md\" 2>&1 && git status","description":"Unstage duplicate ADR entry"}
[user]
[tool_result] On branch claude/keen-swanson-f7dff6
Changes to be committed:
(use "git reset HEAD <file>..." to unstage)

new file:   docs/specs/2026-05-31-n-cursor-superpowers-composition-design.md
[assistant]
[tool: Bash] {"command":"cd /Users/vitaliytv/www/nitra/cursor/.claude/worktrees/keen-swanson-f7dff6 && git commit -m \"$(cat <<'EOF'\ndocs(specs): lifecycle composition spec (n-cursor × superpowers)\n\nADR вже в HEAD (ad98ac8). Spec фіксує повне рішення: compose-not-duplicate,\nContract Gate, 8-фазний lifecycle-ланцюжок, traceability через front-matter,\nautonomous-mode (pi.dev), та Capability Router як свідомо відкладену альтернативу.\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>\nEOF\n)\"","description":"Commit spec file"}
[user]
[tool_result] [claude/keen-swanson-f7dff6 c8dfe28] docs(specs): lifecycle composition spec (n-cursor × superpowers)
1 file changed, 177 insertions(+)
create mode 100644 docs/specs/2026-05-31-n-cursor-superpowers-composition-design.md
[assistant]
Spec закомічений. Ось де лежить:

`docs/specs/2026-05-31-n-cursor-superpowers-composition-design.md` (commit `c8dfe28`)
`docs/adr/20260531-141658-n-cursor-×-superpowers-lifecycle-composition.md` (commit `ad98ac8`, вже існував)

**Що зафіксовано в документах:**
- Принцип **compose-not-duplicate**: `n-cursor` володіє lifecycle-spine, superpowers referenced як sub-phase
- **8-фазний ланцюжок** `задача → ADR → spec → план → код → тести → документація → changelog → notify` з front-matter-лінками по спільному `id`
- **Contract Gate** (`n-cursor verify`) — єдиний блокуючий gate, однаковий для interactive та pi.dev
- **Baseline без superpowers** — `n-cursor` матеріалізує мінімальний lifecycle при `npx @nitra/cursor`
- **Capability Router** — явно відкладено з named-тригером
- 4 Open Questions для наступного рев'ю (OQ-1..4)

Коли будеш готовий переходити до плану реалізації — `/n-llm-patch` або `superpowers:writing-plans` від spec-файлу.

---
---

Ось виявлені рішення з цієї сесії:

## ADR Compose-not-duplicate: n-cursor × superpowers lifecycle

## Context and Problem Statement
`@nitra/cursor` CLI і `superpowers`-скіли (процедурні підказки для агента: `brainstorming`, `writing-plans`, `test-driven-development`) взаємодіють без явного зв'язку. Не існує єдиного lifecycle-ланцюжка від задачі до коду й документації, а оточення без `superpowers` (CI, pi.dev) мусять продовжувати працювати.

## Considered Options
* **Contract Gate + lifecycle-spine (compose, не duplicate)** — `n-cursor` володіє spine; `superpowers` referenced як sub-phase у середині.
* **Capability Router / `capability-matrix.json`** — два шляхи виконання залежно від матриці можливостей моделі (`native_workflows` vs скриптовий оркестратор).
* **In-house orchestrator** — повна реімплементація lifecycle всередині `@nitra/cursor`, без залежності від `superpowers`.

## Decision Outcome
Chosen option: **"Contract Gate + lifecycle-spine (compose, не duplicate)"**, because детекції активної моделі в кодовій базі нема (`coverage-classify` хардкодить `'claude-sonnet-4-6'`); `native_workflows` — фіча харнеса, а не прапорець моделі; `superpowers`-кеш ефемерний (зник під час сесії); патчити апстрім не можна; `using-git-worktrees` уже спроєктований делегувати нативному тулу одним рядком.

### Consequences
* Good, because 8-фазний ланцюжок `задача → ADR → spec → план → код → тести → документація → changelog → notify` трасується через front-matter-лінки по спільному `id` — незалежно від моделі чи присутності `superpowers`.
* Good, because `n-cursor verify` (Contract Gate) є єдиним блокуючим gate і однаково працює в інтерактивному та автономному (pi.dev) режимах.
* Good, because Capability Router задокументований як свідомо відкладена альтернатива з named-тригером (стабільний програмний handoff в Anthropic API / `claude-agent-sdk`).
* Neutral, because автономна launcher-роль `n-cursor` vs pi.dev-host лишається Open Question (OQ-1) — наслідки залежать від цього вибору.

## More Information
- Spec: `docs/specs/2026-05-31-n-cursor-superpowers-composition-design.md` (commit `c8dfe28`)
- ADR: `docs/adr/20260531-141658-n-cursor-×-superpowers-lifecycle-composition.md` (commit `ad98ac8`)
- Прецедент headless-сабагентів у репо: `npm/scripts/coverage-fix.mjs` (@anthropic-ai/claude-agent-sdk)
- Прецедент pi.dev-extension: `.pi/extensions/n-cursor-adr`
- `@nitra/cursor` v1.39.0 (`npm/package.json`)
- `using-git-worktrees` SKILL.md (superpowers 5.1.0, ефемерний кеш): рядок 55 — «якщо є нативний тул — використай його»
