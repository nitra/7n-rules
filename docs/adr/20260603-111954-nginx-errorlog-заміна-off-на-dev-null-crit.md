---
session: b6bfe2b1-7a9a-47f9-9f80-a8bac7833bb2
captured: 2026-06-03T11:19:54+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/b6bfe2b1-7a9a-47f9-9f80-a8bac7833bb2.jsonl
---

Секцію виправлено — відповідає реальному коду.

**Стан задачі:** `ensure-tool.mjs` вже є і закомічений, WIP-тести (`ga` + `text`) у тебе на робочому дереві. Те, що ми проговорили й збирались реалізувати — вже зроблено. Я додав (`scripts.mdc`) generic правило для майбутніх зовнішніх тулів, щоб воно було нормативним і не треба було пояснювати підхід наступного разу.

---

Now I need to produce the ADR documentation. Let me analyze what decisions were made in this transcript.

## ADR nginx error_log: заміна `off` на `/dev/null crit`

## Context and Problem Statement
Правило `nginx-default-tpl` вимагало директиву `error_log off;` у канонічному шаблоні `default.conf.template`. Користувач зазначив, що `error_log off` — технічно невалідна nginx-директива: `off` трактується як ім'я файлу (`/etc/nginx/off`), що призводить до помилки під `readOnlyRootFilesystem`.

## Considered Options
* `error_log /dev/null crit;` — запис у writable device, що є стандартним способом вимкнути error-лог у nginx.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`error_log /dev/null crit;`", because `/dev/null` — writable device і це єдина коректна форма вимкнення error-логу в nginx, що не падає під `readOnlyRootFilesystem`.

### Consequences
* Good, because transcript фіксує очікувану користь: шаблон тепер валідний для nginx у середовищах з `readOnlyRootFilesystem`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінені файли: `npm/rules/nginx-default-tpl/js/template.mjs`, `npm/rules/nginx-default-tpl/nginx-default-tpl.mdc`, `npm/rules/nginx-default-tpl/js/tests/template/fixtures/default.conf.template`, `npm/rules/nginx-default-tpl/js/tests/template/tests/check.test.mjs`.
- Нова функція авто-міграції `migrateErrorLogOffDirective()` у `template.mjs`: regex `/error_log\s+off\s*;/gu`, замінює на `error_log /dev/null crit;` у всіх знайдених `default.conf.template`.
- Change-файл: `npm/.changes/1780470438809-46704f.md` (bump: patch, section: Fixed).

---

## ADR Авто-встановлення зовнішніх CLI-інструментів: per-platform matrix з hard-fail

## Context and Problem Statement
Скрипти пакета `@nitra/cursor` спавнять зовнішні бінарники (`conftest`, `hk`, `shellcheck`, та ін.). Раніше при відсутності бінарника виводився текстовий hint і відбувався hard-fail, але кожен call-site мав власну ad-hoc логіку підказки, а самі інструменти ніколи не встановлювались автоматично.

## Considered Options
* Авто-встановлення через системний пакетний менеджер (brew / scoop / GitHub Releases для Linux).
* Завантаження пінованого бінарника з GitHub Releases на всіх платформах (без пакетних менеджерів).
* Тільки hint + hard-fail (поточна поведінка, без авто-install).

## Decision Outcome
Chosen option: "Авто-встановлення через системний пакетний менеджер з fallback на GitHub Releases", because: macOS — brew (завжди є в команди), Windows — scoop (winget не має ні `hk`, ні `conftest`; є лише `jdx.mise` та `opa`), Linux — GitHub Release binary; scoop-fallback на Linux також GitHub Release.

### Consequences
* Good, because transcript фіксує очікувану користь: `n-fix` і `n-lint` зможуть авто-встановити залежності замість того, щоб падати з підказкою на кожній новій машині.
* Bad, because версії між платформами можуть розходитись (brew/scoop дають latest, GitHub Release — пінований). Transcript свідомо приймає це рішення: "ставимо latest і не перевіряємо".

## More Information
- Рішення закріплено в `npm/scripts/lib/ensure-tool.mjs` (єдиний seam: `ensureTool(toolId)`).
- Реєстр тулів (`TOOLS`) знаходиться inline в `ensure-tool.mjs`: `{ brew, scoop, githubFallback }` на тул.
- Platform matrix: macOS → `brew install <formula>`; Windows → `scoop install <app>` → fallback GitHub binary; Linux → GitHub Release binary + `chmod +x`.
- Opt-out: `N_CURSOR_NO_AUTO_INSTALL=1`.
- `hk` особливість: `ensureHkInstall(hkBin)` — додатково виконує `hk install` (вписати pre-commit git-hook) з CI-гардом (`process.env.CI`). Якщо `hk install` не вдається — warn-and-continue (не hard-fail).
- Контрольована наявність у пакетних менеджерах: winget **не має** `hk` (лише `jdx.mise`) і **не має** `conftest` (лише `open-policy-agent.opa`). Scoop Main має обидва: `hk` (hk.jdx.dev) і `conftest` (v0.68.2).
- Загальне правило зафіксоване в `.cursor/rules/scripts.mdc`, секція «Зовнішні CLI-інструменти: резолв і авто-встановлення».

---

## ADR Changelog change-файл: `hk install` у скілі `n-fix`, а не в усіх сценаріях

## Context and Problem Statement
Після додавання авто-встановлення `hk` виникло питання, де і коли виконувати `hk install` (вписати pre-commit git-hook). Виконання в CI або при кожному `check`-запуску недоцільне.

## Considered Options
* `hk install` тільки в потоці `n-fix` з CI-гардом.
* `hk install` при кожному запуску CLI (включно з `check`, `change`, `worktree`).

## Decision Outcome
Chosen option: "`hk install` тільки в потоці `n-fix` з CI-гардом", because git-hook на commit у CI марний, а зміна `.git/hooks` під час звичайного `check` є неочікуваною побічною дією.

### Consequences
* Good, because transcript фіксує очікувану користь: `n-fix` розгортає pre-commit hook тільки там, де це доречно — на локальній машині розробника.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Реалізовано в `npm/bin/n-cursor.js`: `ensureTool('hk')` → `ensureHkInstall(hkBin)` — в case `'fix'`, а не в корені CLI.
- `ensureHkInstall` містить гард `process.env.CI`: якщо `CI=true` — пропускаємо `hk install`.
