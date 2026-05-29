---
session: 9b851872-974e-4842-96a2-14ae3cf1a806
captured: 2026-05-29T21:03:40+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/9b851872-974e-4842-96a2-14ae3cf1a806.jsonl
---

## ADR Перехід до change-файлів замість ручного bump/CHANGELOG у n-cursor

## Context and Problem Statement

При паралельній розробці (особливо субагенти у git worktrees, а також колеги у різних гілках) кожен PR вручну редагує `CHANGELOG.md` (верхня секція) і `package.json` (`version`). Оскільки обидва файли мають спільну «точку вставки», merge завжди породжує git-конфлікт. Правило `n-changelog.mdc` v2.6 — з його STOP-блоком «ручний patch +1 + нова секція CHANGELOG» — є безпосередньою причиною цього патерну.

## Considered Options

* **Свій скрипт — per-workspace `.changes/*.md` + `n-cursor release`** (обрано)
* **`@changesets/cli`** — зрілий JS-інструмент, але JS-only, не покриває Python-workspace
* **Beachball (Microsoft)** — найближчий за API (check / publish), але так само JS-only і модель типів (лише semver-bump без `### Added/Changed/Fixed`) не збігається з наявним форматом CHANGELOG
* **`merge=union` у `.gitattributes`** — тактичний фікс для CHANGELOG, не лікує конфлікт у `version`

## Decision Outcome

Chosen option: "Свій скрипт — per-workspace `.changes/*.md` + `n-cursor release`", because жоден off-the-shelf інструмент не підтримує одночасно JS і Python workspace, а формат Keep-a-Changelog (`### Added/Changed/Fixed/Removed`) не збігається з моделлю semver-bump changesets/Beachball. `n-cursor` вже містить детекцію обох типів workspace (`package-manifest.mjs`), тому свій генератор є природним розширенням наявної інфраструктури.

### Consequences

* Good, because transcript фіксує очікувану користь: два агенти/розробники більше не колізять на CHANGELOG/version, бо кожен пише окремий `.changes/<unique>.md` у своєму workspace і ніколи не редагує спільні рядки.
* Good, because transcript фіксує очікувану користь: `n-cursor release` у CI серіалізує bump + генерацію CHANGELOG + тегування + commit-back в єдиній точці на `main`, усуваючи ручний крок з feature-гілок.
* Good, because transcript фіксує очікувану користь: Python-workspace покриваються нарівні з npm через наявний `package-manifest.mjs`, що не вміє жоден off-the-shelf інструмент.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Дизайн-документ: `docs/superpowers/specs/2026-05-29-n-cursor-release-design.md`
- Наявний rule: `.cursor/rules/n-changelog.mdc` v2.6 (STOP-блок з ручним bump) — потребує переписати до v3.0
- CI-файл: `.github/workflows/npm-publish.yml` — додати крок `npx @nitra/cursor release` + `permissions: contents: write` + `persist-credentials: true`
- Ключові наявні модулі: `npm/rules/changelog/lib/package-manifest.mjs`, `npm/rules/changelog/js/consistency.mjs`
- Change-файл кладеться у `<workspace>/.changes/<unique>.md`; frontmatter: `bump: patch|minor|major`, `section: Added|Changed|Fixed|Removed`
- Fallback у CI: якщо `.changes/` порожній для зміненого workspace — `release` синтезує generic-запис із commit-меседжів (warning, не error)
- Template release-workflow буде винесено в `npm/github-actions/` для scope B (будь-який споживач `@nitra/cursor`)

---

## ADR Реліз відбувається виключно в CI на `main`, без локального кроку

## Context and Problem Statement

Після ухвалення per-workspace change-файлів залишалось вирішити, **де** і **ким** запускається агрегація `.changes/*.md` → bump + CHANGELOG + tag. Worktree-агенти виконують незалежні фічі паралельно, тому локальна «release-точка» вимагала б координації між ними.

## Considered Options

* **CI на `main` (Патерн A)** — `n-cursor release` як крок у `npm-publish.yml` (обрано)
* **Локально на merge worktree (Патерн B)** — швидший фідбек, але потребує hook на злиття worktree
* **Release PR (Патерн C / release-please)** — бот накопичує, людина мерджить PR-реліз; найчистіше, але додатковий бот-workflow

## Decision Outcome

Chosen option: "CI на `main` (Патерн A)", because це максимальна автоматизація: merge у main → CI автоматично релізить без будь-яких дій локально. Лягає на наявний `npm-publish.yml` з мінімальними правками (`contents: write`, `persist-credentials: true`, `fetch-depth: 0`).

### Consequences

* Good, because transcript фіксує очікувану користь: `concurrency: cancel-in-progress: false` (зміна з поточного `true`) серіалізує release-джоби і унеможливлює гонку кількох паралельних releases.
* Good, because transcript фіксує очікувану користь: commit-back через `GITHUB_TOKEN` навмисно не ретригерить workflow — тому bump і publish знаходяться в одному job і не зациклюються.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Файл: `.github/workflows/npm-publish.yml` — тригер `paths` розширюється на `**/.changes/**`
- Зміни permissions: `contents: write` (було `read`)
- Зміни checkout: `persist-credentials: true`, `fetch-depth: 0`
- `n-cursor release` виконується **до** кроку `JS-DevTools/npm-publish` — тобто publish бачить уже піднятий `version`
- `cancel-in-progress` у `concurrency` має бути `false` для release-job, щоб не обривати реліз посередині

---

## ADR Гібридне авторство change-файлів: агент пише явно, CI має fallback

## Context and Problem Statement

Обрано per-workspace `.changes/*.md` замість ручного редагування CHANGELOG. Постало питання: хто і як створює ці файли — явно агент/людина, або CI генерує їх автоматично з commit-меседжів.

## Considered Options

* **Явний запис (`n-cursor change`)** — автор пише `.changes/<unique>.md` замість CHANGELOG
* **Авто-генерація з git-diff/комітів у CI** — агент нічого не пише, `release` виводить bump і опис із commit-меседжів
* **Гібрид (обрано):** агент пише явно → CI має fallback для забутих change-файлів

## Decision Outcome

Chosen option: "Гібрид", because «максимально автоматизовано» не має означати «втратити сенс CHANGELOG» — агент знає свій намір краще, ніж евристика з commit-меседжів. CI-fallback гарантує, що реліз ніколи не буде порожнім навіть якщо файл забули.

### Consequences

* Good, because transcript фіксує очікувану користь: `check changelog` стає м'яким попередженням (warn, не блокер), бо CI-fallback підстрахує — агент не зупиняється при відсутньому change-файлі.
* Good, because transcript фіксує очікувану користь: якість CHANGELOG зберігається — автор явно вказує `section: Added|Changed|Fixed|Removed` і людиночитаний опис.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Нова підкоманда: `n-cursor change` — інтерактивно або через прапорці записує `.changes/<unique>.md`
- Fallback-логіка в `n-cursor release`: якщо workspace має зміни (за git-diff), але `.changes/` порожній — синтезує generic-запис з commit-меседжів і логує `warning`
- `n-changelog.mdc` STOP-блок переписується: крок 1 (ручний `version +1`) і крок 2 (ручна секція CHANGELOG) замінюються на «поклади `<ws>/.changes/<unique>.md`»
- Ручний bump лишається дозволеним (legacy/hotfix): `check` приймає **або** change-файл, **або** підняту версію
