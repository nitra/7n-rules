---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T06:30:21+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

Аналізую сесію та підготовлю ADR-документи.

На підставі transcript:
1. Проведено brainstroming-сесія щодо заміни `auto.md` → `meta.json` + `worktree`
2. Прийнято 9 дизайн-рішень
3. Написано spec і план

## ADR: Заміна `skills/*/auto.md` на структурований `meta.json`

## Context and Problem Statement
`npm/skills/<id>/auto.md` зберігав умову автоактивації скіла у вигляді плоского текстового рядка (`завжди`, `[rule,...]`). З появою потреби зберігати також поле `worktree` стало очевидно, що одноцільовий формат `auto.md` не масштабується — кожне нове поле вимагало б нового файлу.

## Considered Options
* Новий структурований файл `meta.json` (одне джерело правди для всіх метаданих скіла)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`meta.json` — JSON-файл з полями `auto` (умова активації) та `worktree` (булеве)", because `auto.md` — це односторонній plain-text, що не дозволяє додавати нові поля без окремих файлів; JSON з JSON-схемою вже є усталеним патерном у репо (`n-cursor.json`, `npm/schemas/`), легко валідується `check`-концерном.

### Consequences
* Good, because transcript фіксує очікувану користь: одне джерело правди для метаданих скіла, машинна валідація через JSON-схему, можливість додавати нові поля без нових файлів.
* Bad, because `auto`-поле лишається рядком `"завжди"` (не `"always"`), щоб зберегти сумісність з літералом `ALWAYS_LITERAL` у `auto-skills.mjs`; зміна потребує точного 1:1-перенесення значень, що легко порушити.

## More Information
- Видалити 9 файлів `npm/skills/<id>/auto.md`, створити 9 `npm/skills/<id>/meta.json`.
- Споживач: `npm/scripts/auto-skills.mjs` — функція `discoverSkillAutoActivation`/`parseSkillAutoSpec` читатиме `meta.json.auto` замість `auto.md`.
- Схема: `npm/schemas/skill-meta.json` (draft-07, як `n-cursor.json`).
- Spec: `docs/superpowers/specs/2026-05-31-skill-meta-json-worktree-design.md`.
- Plan: `docs/superpowers/plans/2026-05-31-skill-meta-json-worktree.md`.

---

## ADR: Поле `worktree` у `meta.json` — булеве, синхронізується в `SKILL.md`

## Context and Problem Statement
Деякі скіли мутують репо і виграють від ізоляції в окремому git-worktree; інші є реактивними (працюють на незакомічених змінах поточного checkout) або read-only, і worktree для них шкідливий або беззмістовний. Потрібен механізм, який декларативно зберігає це налаштування і передає його агенту під час виконання.

## Considered Options
* Булеве поле `worktree: true/false` у `meta.json` (мінімальна семантика, максимальна простота)
* Enum з трьох станів (`required`/`allowed`/`forbidden`)
* Булеве + окреме поле `parallelSafe`

## Decision Outcome
Chosen option: "булеве поле `worktree`", because agент отримує однозначну відповідь (так/ні), а семантику паралельності не потрібно кодувати окремо: `worktree: true` автоматично означає «один інстанс за раз» (наявний `withLock` вже забезпечує серіалізацію).

### Consequences
* Good, because transcript фіксує очікувану користь: проста машиночитана семантика, без зайвих станів; паралельність covered наявним механізмом.
* Bad, because булеве не розрізняє «ізоляція бажана» від «ізоляція обовʼязкова»; якщо в майбутньому зʼявиться такий нюанс, доведеться розширювати схему.

## More Information
- Принцип вибору значення: `worktree: true` — генеративні скіли (fix, taze, coverage-fix, fix-tests, adr-normalize); `worktree: false` — реактивні (lint — читає незакомічені зміни) і read-only (llm-patch, publish-telegram, start-check).
- Значення `worktree: true` задекларовано для 5 скілів, `false` — для 4.

---

## ADR: Доставка `worktree`-прапорця агенту через вбудований блок у `SKILL.md` (варіант D2)

## Context and Problem Statement
Поле `worktree` у `meta.json` зберігається у пакеті та **не копіюється** в `.cursor/skills/n-<id>/` (аналогічно до нинішнього `auto.md`). Проте агент читає `SKILL.md` із `.cursor/skills/n-<id>/SKILL.md` — тобто `meta.json` агент не бачить. Потрібен спосіб донести worktree-налаштування до агента без зайвих файлів у проєкті.

## Considered Options
* Вшити worktree-блок у копію `SKILL.md` під час синку (D2 — markdown-секція з маркерами)
* Новий файл, що копіюється в `.cursor/skills/n-<id>/` (D1)
* Тільки YAML frontmatter у `SKILL.md` (структуроване, але агент може проігнорувати)

## Decision Outcome
Chosen option: "вшити ідемпотентний markdown-блок між маркерами `<!-- n-cursor:worktree:start -->`/`<!-- n-cursor:worktree:end -->` у копію `SKILL.md`", because агент читає `SKILL.md` як інструкцію — явний людиночитаний рядок «виконуй у worktree, не паралель» діє надійніше за структуровані поля, які агент може не інтерпретувати; маркери забезпечують ідемпотентний ре-синк.

### Consequences
* Good, because transcript фіксує очікувану користь: агент бачить інструкцію в тому ж файлі, що й алгоритм скіла; синк ідемпотентний; `meta.json` залишається пакетно-внутрішнім.
* Bad, because `SKILL.md` стає частково генерованим — автор скіла не повинен вручну редагувати секцію між маркерами; потрібна дисципліна (документовано в `scripts.mdc`).

## More Information
- При `worktree: false` блок не додається; якщо він існував — видаляється при ре-синку.
- `meta.json` у проєкт не копіюється (аналогічно до нинішнього `auto.md`).
- Файли: `npm/bin/n-cursor.js` функція `syncSkills` (~рядок 744), новий модуль `npm/scripts/lib/worktree-notice.mjs`.
- Spec: `docs/superpowers/specs/2026-05-31-skill-meta-json-worktree-design.md`.

---

## ADR: Rules `auto.md` — data-driven міграція (G1) виноситься в Spec B

## Context and Problem Statement
`npm/rules/<id>/auto.md` (29 правил) теж є `auto.md`-файлами, але вони мають принципово іншу природу: їхній вміст — людська проза-документація; реальна логіка автодетекту захардкоджена в `auto-rules.mjs` (`AUTO_RULE_ORDER`, `AUTO_RULE_DEPENDENCIES`, `autoRuleChecks`). Постало питання, чи уніфікувати rules і skills в одному spec.

## Considered Options
* Включити rules у Spec A (skills + rules в одному spec)
* Виокремити rules у Spec B: data-driven підхід (G1) — реєстр предикатів, порядок і залежності в `meta.json`, переписування ядра `auto-rules.mjs`

## Decision Outcome
Chosen option: "Spec B — окремий spec для rules", because `auto-rules.mjs` складніша система (29 правил, `collectAutoRuleFacts`, факти проєкту, 8 правил з незводимими до даних перевірками), і її повна data-driven міграція приблизно вдвічі більша за skills-частину; змішування двох мігарцій в одному spec збільшило б ризик і тривалість.

### Consequences
* Good, because transcript фіксує очікувану користь: кожен spec має чистий власний цикл; Spec A (skills) менший, ізольованіший, швидше тестується.
* Bad, because тимчасово в репо співіснують два механізми: `skills/*/meta.json` і `rules/*/auto.md`; це документується як явний форвард-ref у Spec A.

## More Information
- Spec B: повна data-driven міграція `auto-rules.mjs` з реєстром предикатів (G1): прості умови → дані (`anyFile`, `pathExists`, `requiresRules`); складні → `{"auto":{"predicate":"gqlTaggedTemplate"}}` з реалізацією в реєстрі.
- 8 правил групи 4 (graphql, js-bun-db, hasura, js-mssql, js-bun-redis, abie, efes, js-run) мають незводимі до даних перевірки — їхній сканер залишиться кодом, але декларація стане даними.

---

## ADR: Інвентарний файл `.n-worktree.md` у кожному worktree

## Context and Problem Statement
При виконанні скілів з `worktree: true` агент створює git-worktree без будь-якого запису про призначення. Через деякий час стає незрозуміло, які worktree активні і навіщо кожен створювався, що ускладнює інвентаризацію та прибирання.

## Considered Options
* Файл `.n-worktree.md` у корені кожного worktree (агент пише при створенні, файл не в git-історії)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "файл `.n-worktree.md` у корені worktree, доданий до `.git/info/exclude`", because `.git/info/exclude` — локальний exclude репо, ніколи не комітиться й не потрапляє в `git status`; файл слугує виключно для інвентаризації через `git worktree list` + читання `.n-worktree.md`; агент пише його як частину worktree-інструкції, вшитої в D2-блок `SKILL.md`.

### Consequences
* Good, because transcript фіксує очікувану користь: кожен worktree має агентно і людинозрозумілий опис призначення; інвентаризація зводиться до `git worktree list` + читання файлів.
* Bad, because Neutral, because transcript не містить підтвердження наслідку — файл пишеться агентом і не верифікується тестами (є лише кроки у Task 9 плану).

## More Information
- Task 9 плану: `docs/superpowers/plans/2026-05-31-skill-meta-json-worktree.md`, розділ «Task 9».
- `.git/info/exclude` — файл-per-worktree, тому запис автоматично ізольований в кожному worktree.
- Вміст `.n-worktree.md`: назва скіла, гілка, дата створення, мета виконання.
