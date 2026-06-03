---
session: b6bfe2b1-7a9a-47f9-9f80-a8bac7833bb2
captured: 2026-06-03T10:44:03+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/b6bfe2b1-7a9a-47f9-9f80-a8bac7833bb2.jsonl
---

## ADR Заміна `error_log off` на `error_log /dev/null crit;` у правилі nginx-default-tpl

## Context and Problem Statement
У правилі `nginx-default-tpl` директива `error_log off;` вважалась канонічною. Однак `off` nginx трактує як ім'я файлу (`/etc/nginx/off`), що спричиняє падіння під `readOnlyRootFilesystem`. Правило мало бути виправлене в перевірці, автоматичній міграції, канонічному `.mdc`-прикладі та тестовій фікстурі.

## Considered Options
* Замінити `error_log off;` на `error_log /dev/null crit;` у перевірці, авто-міграції, .mdc та фікстурі
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Замінити `error_log off;` на `error_log /dev/null crit;`", because `/dev/null` — writable device (на відміну від `/etc/nginx/off`), тому не падає під `readOnlyRootFilesystem`; `crit` обмежує шум логів.

### Consequences
* Good, because transcript фіксує очікувану користь: правило більше не генерує файл `/etc/nginx/off` при `readOnlyRootFilesystem`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли:
- `npm/rules/nginx-default-tpl/js/template.mjs` — нова функція `migrateErrorLogOffDirective()` (regex `/error_log\s+off\s*;/gu`), викликається з `check()`; перевірка змінена з `c.includes('error_log off')` на `c.includes('error_log /dev/null crit')`.
- `npm/rules/nginx-default-tpl/nginx-default-tpl.mdc` — канонічний приклад з коментарем-поясненням.
- `npm/rules/nginx-default-tpl/js/tests/template/fixtures/default.conf.template` — оновлена фікстура.
- `npm/rules/nginx-default-tpl/js/tests/template/tests/check.test.mjs` — два нових тести для `migrateErrorLogOffDirective`.
- `npm/.changes/1780470438809-46704f.md` — change-файл `bump: patch`, `section: Fixed`.

---

## ADR Авто-встановлення `hk` і `conftest` залежно від платформи в CLI `@nitra/cursor`

## Context and Problem Statement
Скіли `n-fix` і `n-lint` потребують зовнішніх бінарників `hk` (git-hook manager) і `conftest` (rego policy runner). Вони не встановлювались автоматично: відсутність інструменту або призводила до hard-fail (conftest), або до несвідомого пропуску перевірки. Через це агент міг завершити хід без change-файлу, бо `hk` не запускав pre-commit hook.

## Considered Options
* Авто-встановлення через пакетний менеджер платформи (brew / Scoop / GitHub Release)
* Завантаження прибілдених бінарників з GitHub Releases на всіх платформах (пінована версія, SHA256)
* Тільки hint-підказка + hard-fail (поточний стан conftest)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Авто-встановлення через пакетний менеджер платформи (brew / Scoop / GitHub Release)", because для macOS і Windows підхід з пакетним менеджером (brew / Scoop) прийнятний і передбачає наявний тулінг; для Linux — GitHub Release binary як єдиний надійний варіант. Версія встановлюється latest без пінування й перевірки, оскільки team свідомо приймає цей компроміс.

### Consequences
* Good, because transcript фіксує очікувану користь: команда не витрачає час на ручне встановлення; pre-commit hook після `hk install` не дозволяє закомітити зміни в `npm/` без change-файлу.
* Bad, because версії `hk` і `conftest` можуть розходитись між платформами (brew latest ≠ Scoop latest ≠ Linux release) — узгоджена поведінка rego-правил не гарантована між членами команди.

## More Information
Матриця пакетних менеджерів (підтверджена пошуком по реєстрах):

| OS | hk | conftest |
|---|---|---|
| macOS | `brew install hk` | `brew install conftest` |
| Windows | `scoop install hk` | `scoop install conftest` |
| Linux | GitHub Release binary | GitHub Release binary |

`winget` не має ані `hk`, ані `conftest` (`jdx` — тільки `mise`; `open-policy-agent` — тільки `opa`). Обидва є у `ScoopInstaller/Main`.

Поведінкові правила (з transcript):
- `n-fix`: після встановлення бінарника `hk` — також виконати `hk install` (вписати pre-commit git-hook); у CI (`CI=true`) — `hk install` пропустити.
- `n-lint`: після встановлення `conftest` — продовжити виконання.
- При невдачі встановлення будь-якого інструменту — **warning + continue** (не hard-fail) для обох.
- Існуючий seam: `npm/scripts/lib/run-conftest-batch.mjs` → `resolveCmd('conftest')` з поточним hard-fail-hint (`brew install conftest` / `conftest.dev/install`) — замінюється на авто-install логіку.
