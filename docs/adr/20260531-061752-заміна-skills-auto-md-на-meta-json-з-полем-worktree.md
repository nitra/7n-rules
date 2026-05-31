---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T06:17:52+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

давай зробимо щоб замість auto.md був файл з налаштуваннями по кожному скілу і туди буде мігровано auto (а сам auto.md буде видалено), а також там буде налаштування яке буде визначати чи скіл запускається у worktree чи ні
---

## ADR Заміна `skills/*/auto.md` на `meta.json` з полем `worktree`

## Context and Problem Statement

У `npm/skills/<id>/` існував плоский файл `auto.md`, який тримав лише одну умову автоактивації скіла (`завжди` або масив правил). З появою потреби в полі `worktree` (декларація, чи скіл виконується в ізольованому git-worktree) одного рядка в `auto.md` стало недостатньо; структуроване сховище налаштувань скіла відсутнє.

## Considered Options

* Залишити `auto.md`, додати окремий файл (наприклад `worktree.md`)
* Замінити `auto.md` на структурований `meta.json` зі всіма налаштуваннями скіла (обрано)
* YAML-frontmatter файл (`meta.yaml` або `meta.md`)

## Decision Outcome

Chosen option: "Замінити `auto.md` на `meta.json`", because JSON однозначно парситься, легко валідується через існуючі JSON-схеми в `npm/schemas/`, і дозволяє тримати `auto` та `worktree` в одному місці без змін у форматі, який читається іншими інструментами.

Формат:
```json
{ "auto": "завжди", "worktree": true }
```
- `auto`: `"завжди"` | `["adr"]` | поле відсутнє — пряма міграція семантики `auto.md`.
- `worktree`: обовʼязкове булеве. `true` забороняє паралельний запуск.
- `meta.json` у `.cursor/skills/n-<id>/` **не копіюється** (пакетно-внутрішній).

### Consequences

* Good, because transcript фіксує очікувану користь: одне структуроване джерело правди для всіх налаштувань скіла; JSON-схема в `npm/schemas/skill-meta.json` гарантує валідність; машиночитаність спрощує майбутнє додавання полів.
* Bad, because `auto.md` для 29 правил (`npm/rules/<id>/auto.md`) лишається окремим механізмом — уніфікація rules перенесена в Spec B і тимчасово співіснуватимуть два формати.

## More Information

- Spec: `docs/superpowers/specs/2026-05-31-skill-meta-json-worktree-design.md`
- План: `docs/superpowers/plans/2026-05-31-skill-meta-json-worktree.md`
- Коміти: `79e38d1` (spec), `f53b097` (план)
- Файли, що змінюються: `npm/scripts/auto-skills.mjs`, `npm/bin/n-cursor.js` (`syncSkills`), 9 файлів `npm/skills/*/meta.json` (нові), 9 `npm/skills/*/auto.md` (видаляються)
- Нова JSON-схема: `npm/schemas/skill-meta.json`
- D2-sync: при `worktree:true` у копію `SKILL.md` вшивається блок між маркерами `<!-- n-cursor:worktree:start -->` / `<!-- n-cursor:worktree:end -->`

---

## ADR Семантика поля `worktree` у `meta.json` скіла

## Context and Problem Statement

Додаючи `worktree`-поле до `meta.json`, потрібно визначити, скільки значень воно приймає і що означає `true` для паралельного виконання скілів.

## Considered Options

* Булеве `true`/`false`
* Enum із трьох станів (`required` / `allowed` / `forbidden`)
* Enum + окремий прапорець `parallelSafe`

## Decision Outcome

Chosen option: "Булеве `true`/`false`", because обраний підхід мінімальний і достатній: паралельність вже серіалізується через `withLock` (крос-worktree мʼютекс); додатковий `parallelSafe` дублював би наявний механізм. `worktree: true` автоматично означає «один інстанс за раз» — це єдина додаткова семантика, яка потрібна.

Розкладка 9 скілів:
- `worktree: true`: `fix`, `taze`, `coverage-fix`, `fix-tests`, `adr-normalize`
- `worktree: false`: `lint`, `start-check`, `llm-patch`, `publish-telegram`

Принцип: `true` — генеративні скіли (зміни з детермінованого джерела); `false` — реактивні (працюють на незакомічених змінах поточного checkout) і read-only.

### Consequences

* Good, because transcript фіксує очікувану користь: простий булеве легше перевіряти в JSON-схемі та читати людині; принцип «генеративний vs реактивний» дає чітке правило для нових скілів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- `lint` залишений `false` не через CPU-вагу (вирішено `withLock`), а тому що він реактивний: лінтить незакомічені зміни поточного checkout, які worktree відрізає.
- Split `lint` на «важкий CI + worktree» і «легкий агент» — запланований окремим Spec B.
- Spec: `docs/superpowers/specs/2026-05-31-skill-meta-json-worktree-design.md`

---

## ADR Спосіб доставки `worktree`-прапорця до агента

## Context and Problem Statement

`meta.json` є пакетно-внутрішнім файлом і не копіюється в проєкт. Агент виконує скіл, читаючи `.cursor/skills/n-<id>/SKILL.md`. Потрібно визначити, яким чином поле `worktree: true` потрапляє до агента під час виконання скіла.

## Considered Options

* Окремий файл копіюється поруч із `SKILL.md` у `.cursor/skills/n-<id>/`
* Worktree-прапорець вшивається в копію `SKILL.md` під час синку (`syncSkills`) у вигляді markdown-блоку між маркерами (обрано)
* Worktree-прапорець додається у YAML frontmatter копії `SKILL.md`

## Decision Outcome

Chosen option: "D2 — ідемпотентний markdown-блок між маркерами у `SKILL.md`", because агент і так зобовʼязаний прочитати `SKILL.md` перед виконанням; явний людиночитаний текст «виконуй у worktree, не паралель» діє надійніше за frontmatter-поле, яке агент може проігнорувати. Маркери `<!-- n-cursor:worktree:start -->` / `<!-- n-cursor:worktree:end -->` забезпечують ідемпотентний ре-синк.

При `worktree: false` блок не додається (або видаляється при ре-синку).

### Consequences

* Good, because transcript фіксує очікувану користь: жодного нового файлу в проєкті; інструкція потрапляє в контекст агента гарантовано; ре-синк ідемпотентний.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Блок, що вшивається:
```markdown
<!-- n-cursor:worktree:start -->
> **Worktree:** виконуй цей скіл в окремому git-worktree (`git worktree add`); **не** запускай паралельно — один інстанс за раз.
<!-- n-cursor:worktree:end -->
```
Реалізація: `npm/scripts/lib/worktree-notice.mjs` (новий), викликається з `syncSkills` у `npm/bin/n-cursor.js`.
