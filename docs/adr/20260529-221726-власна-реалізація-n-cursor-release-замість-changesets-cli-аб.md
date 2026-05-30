---
session: 9b851872-974e-4842-96a2-14ae3cf1a806
captured: 2026-05-29T22:17:26+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/9b851872-974e-4842-96a2-14ae3cf1a806.jsonl
---

## ADR Власна реалізація `n-cursor release` замість `@changesets/cli` або Beachball

## Context and Problem Statement
Монорепо містить JS і Python workspace; паралельні агенти та розробники редагують `version` у `package.json`/`pyproject.toml` і верхні рядки `CHANGELOG.md` в різних гілках, що гарантує git-конфлікт при merge. Потрібен механізм, що прибирає ручне редагування цих файлів із feature-гілок.

## Considered Options
* `@changesets/cli` — поширена JS-монорепо бібліотека; підтримує тільки npm-workspace, має власний формат changelog
* Beachball (Microsoft) — надає `beachball check` (PR-гейт) і `beachball publish` (bump+changelog+npm); JSON change-файли, але тільки JS, semver-типи не збігаються з Keep-a-Changelog категоріями
* Власна реалізація у `n-cursor` (`n-cursor change` + `n-cursor release`) — перевикористовує `package-manifest.mjs` (вже детектує JS і Python workspace), повний контроль над форматом

## Decision Outcome
Chosen option: "Власна реалізація у `n-cursor`", because у монорепо є Python workspace (`pyproject.toml`), які `@changesets/cli` і Beachball не підтримують архітектурно (не конфіг, а хак), а формат CHANGELOG (`### Added/Changed/Fixed/Removed`, українська категоризація) однаково довелося б перевизначати окремим рендерером.

### Consequences
* Good, because transcript фіксує очікувану користь: однаковий механізм для JS і Python, нуль зовнішніх залежностей у споживчому проєкті, перевикористання вже наявного `package-manifest.mjs`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Порівняння Beachball обговорено в сесії: `beachball check` семантично еквівалентне новому `check changelog`; `beachball publish` — аналог `n-cursor release`. Відмова від Beachball мотивована Python-only лімітом і невідповідністю типів. Спека: `docs/superpowers/specs/2026-05-29-n-cursor-release-design.md`.

---

## ADR Per-workspace розташування `.changes/` директорій

## Context and Problem Statement
Change-файли мають однозначно відображати, якого workspace стосується зміна, і не конфліктувати при merge паралельних гілок, де кожна гілка вносить зміни до різних workspace.

## Considered Options
* Per-workspace: `<ws>/.changes/<unique>.md` — локація = таргет, без явного `packageName` у файлі
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Per-workspace `.changes/<unique>.md`", because агент, що працює в конкретному workspace, кладе change-файл туди без ризику помилитися з пакетом, а `release` переюзає `package-manifest.mjs` для виявлення workspace (включно з Python).

### Consequences
* Good, because transcript фіксує очікувану користь: нуль конфліктів між паралельними агентами — два файли в різних `<ws>/.changes/` не перетинаються; відповідає наявній філософії «кожен пакет повністю володіє своїм CHANGELOG + version».
* Bad, because зміна, що зачіпає кілька workspace, вимагає кілька окремих change-файлів (по одному в кожен відповідний `<ws>/.changes/`).

## More Information
Корінь монорепо (`.`) change-файлів не має — він не версіонується. Реалізація: `npm/rules/release/lib/workspace-reader.mjs` + `npm/rules/release/lib/change-file.mjs`. План: `docs/superpowers/plans/2026-05-29-n-cursor-release.md`, Task 1–2.

---

## ADR CI-only реліз (aggregate + bump + CHANGELOG виключно на `main`)

## Context and Problem Statement
Ручний крок `version +1` у feature-гілках від спільної бази є архітектурною причиною конфлікту: два розробники/агенти роблять `+1` від тієї самої version — виходить однакова версія в різних гілках.

## Considered Options
* A — `n-cursor release` тільки в CI на `main` (серіалізована єдина точка агрегації)
* B — `release` локально при merge worktree назад перед пушем
* C — обидва: агент пише change-файл, `check` — PR-гейт, `release` — CI

## Decision Outcome
Chosen option: "A — `n-cursor release` тільки в CI на `main`", because це максимальна автоматизація («hands-off»): bump і publish відбуваються в одному CI job'і без жодного локального релізного кроку, серіалізація через `concurrency` у workflow запобігає гонкам.

### Consequences
* Good, because transcript фіксує очікувану користь: worktree-агенти лише накопичують `.changes/*.md`, ніколи не редагують `CHANGELOG.md`/`version` — конфлікт зникає в корені.
* Bad, because bump і publish мають бути в одному CI job'і (окремими workflow не розбити без PAT/Deploy Key, оскільки commit-back через `GITHUB_TOKEN` не ретригерить workflow).

## More Information
`npm-publish.yml` потребує `permissions.contents: write` (було `read`) і `persist-credentials: true`. `fetch-depth: 0` — для читання commit-range fallback. Спека: секція «Правки CI та правила». План: Task 9.

---

## ADR Гібридне авторство change-файлів: явний агент + CI-fallback

## Context and Problem Statement
Потрібно визначити, хто і коли створює `.changes/*.md`: автор зміни вручну/агент явно, або CI автоматично з комітів, або комбінація.

## Considered Options
* 1 — агент/людина пише change-файл явно (`n-cursor change`); `check` — блокуючий гейт
* 2 — `release` у CI повністю авто-генерує запис із Conventional Commits; change-файлів нема
* 3 — агент пише явно; `check` — м'яке попередження; CI має fallback-синтез із комітів якщо change-файлу нема

## Decision Outcome
Chosen option: "3 — гібрид", because «максимально автоматизовано не має означати втратити сенс CHANGELOG»: агент знає свій намір і формує точний запис, CI-fallback гарантує, що навіть пропущений change-файл не зламає реліз.

### Consequences
* Good, because transcript фіксує очікувану користь: якість CHANGELOG = якість явно написаного запису (не евристика з комітів); реліз ніколи не залишається порожнім через забутий change-файл.
* Bad, because `check changelog` стає м'яким попередженням, а не блокером, що теоретично дозволяє мерджити PR без change-файлу.

## More Information
Fallback-синтез реалізується в `npm/rules/release/lib/fallback.mjs` (Plan Task 5). `n-cursor change` — новий subcommand у `npm/bin/n-cursor.js` (Plan Task 4). `check changelog` семантика описана в `n-changelog.mdc` v3.0.

---

## ADR Per-package git теги `<name>@<version>` у монорепо

## Context and Problem Statement
Монорепо з незалежним версіонуванням по workspace потребує git-тегів для кожного релізу, щоб `release` міг визначити commit-range для fallback-синтезу. Потрібно обрати схему тегування.

## Considered Options
* Варіант 1 — per-package тег `<name>@<version>` (напр. `@nitra/cursor@1.31.0`)
* Варіант 2 — один тег на CI-прогін `release-<timestamp>` / `v2026.05.29`

## Decision Outcome
Chosen option: "Варіант 1 — per-package `<name>@<version>`", because тег однозначно маппиться на (пакет, версія) і безкоштовно дає базу для fallback: `git describe --match 'foo@*'` повертає «останній реліз пакета foo» — ця база потрібна Task 5 (`fallback.mjs`) для визначення commit-range. Без per-package тегів fallback потребував би окремого механізму.

### Consequences
* Good, because transcript фіксує очікувану користь: канонічний підхід (changesets, Beachball, Lerna independent mode); готова основа для майбутніх GitHub Releases.
* Bad, because для scoped-імені `@scope/name` тег містить слеш → `refs/tags/scope/name@version` (вкладений ref); це стандартна поведінка changesets, але деякі інструменти потребують явного налаштування.

## More Information
Тег встановлюється `release`-оркестратором після commit-back у `main` (Plan Task 6, крок «Поставити git-тег `<name>@<version>`»). Спека: секція «Алгоритм `release` на пакет».

---

## ADR Формат імені change-файлу: `<timestamp>-<short-rand>.md`

## Context and Problem Statement
Паралельні агенти в різних worktree можуть записати change-файл в той самий момент (однакова мілісекунда), тому чисто timestamp-ім'я не гарантує унікальності.

## Considered Options
* Чистий timestamp
* Хеш контенту або id worktree-гілки
* `<timestamp>-<short-rand>` — timestamp для читабельного порядку + короткий рандомний суфікс

## Decision Outcome
Chosen option: "`<timestamp>-<short-rand>.md`", because timestamp дає читабельний хронологічний порядок, а рандомний суфікс усуває ймовірність колізії при одночасному записі двох агентів в одну мілісекунду.

### Consequences
* Good, because transcript фіксує очікувану користь: нуль merge-конфліктів (два файли з різними іменами) і читабельний порядок у директорії `.changes/`.
* Neutral, because transcript не містить підтвердження наслідку щодо детермінізму у тестах (timestamp не детермінований — тести мають мокати час або порівнювати за вмістом, а не іменем).

## More Information
Реалізується у `npm/rules/release/lib/change-file.mjs`, функція генерації імені. Plan Task 1, крок «Write minimal implementation».
