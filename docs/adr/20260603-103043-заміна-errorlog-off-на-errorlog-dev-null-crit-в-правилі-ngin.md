---
session: b6bfe2b1-7a9a-47f9-9f80-a8bac7833bb2
captured: 2026-06-03T10:30:43+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/b6bfe2b1-7a9a-47f9-9f80-a8bac7833bb2.jsonl
---

## ADR Заміна `error_log off` на `error_log /dev/null crit` в правилі nginx-default-tpl

## Context and Problem Statement
Директива `error_log off;` у шаблоні `default.conf.template` є невалідною для nginx: рядок `"off"` трактується як ім'я файлу (`/etc/nginx/off`), що призводить до падіння контейнера під `readOnlyRootFilesystem`. Потрібно виправити як правило перевірки, так і канонічний шаблон.

## Considered Options
* Замінити `error_log off;` на `error_log /dev/null crit;` — запис у writable device з мінімальним рівнем логування
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Замінити `error_log off;` на `error_log /dev/null crit;`", because `/dev/null` є writable device і доступний навіть під `readOnlyRootFilesystem`, а рівень `crit` фільтрує зайві логи.

### Consequences
* Good, because transcript фіксує очікувану користь: шаблон більше не падає в контейнерах з `readOnlyRootFilesystem`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Зміни внесено у три файли: `npm/rules/nginx-default-tpl/js/template.mjs` (рядок перевірки `'відсутнє error_log off'` → нова перевірка на `error_log /dev/null crit`), `npm/rules/nginx-default-tpl/nginx-default-tpl.mdc` (канонічний приклад), `npm/rules/nginx-default-tpl/js/tests/template/fixtures/default.conf.template` (фікстура). Усі 50 тестів пройшли після зміни.

---

## ADR Авто-міграція директиви `error_log off` у наявних шаблонах

## Context and Problem Statement
Після зміни правила перевірки з `error_log off` на `error_log /dev/null crit` вже розгорнуті `default.conf.template`-файли у репозиторіях-споживачах автоматично не оновлюються, тож правило одразу фейлитиме їх без можливості авто-виправлення.

## Considered Options
* Додати функцію `migrateErrorLogOffDirective()` за зразком наявної `migrateDefaultTplConfFiles()` — авто-заміна в усіх знайдених `default.conf.template`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати функцію `migrateErrorLogOffDirective()`", because в репо вже існує аналогічний міграційний патерн (`migrateDefaultTplConfFiles`), що мутує файли і звітує через `pass()`; нова функція слідує тій самій конвенції.

### Consequences
* Good, because transcript фіксує очікувану користь: виклик з `check()` гарантує авто-фікс шаблону без ручного втручання, `pass`-звіт залишає слід у виводу правила.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Функція використовує regex `/error_log\s+off\s*;/gu` для покриття довільних пробілів. Реєстрація відбувається у `npm/rules/nginx-default-tpl/js/template.mjs`. Два тести додано у `check.test.mjs` (заміна + no-op). Change-файл: `npm/.changes/1780470438809-46704f.md` (`bump: patch`, section `Fixed`).

---

## ADR Авто-встановлення `hk` у `n-fix` та `conftest` у `n-lint`

## Context and Problem Statement
Скіли `n-fix` і `n-lint` залежать від зовнішніх бінарників (`hk` та `conftest` відповідно), які можуть бути відсутні у розробника. Сесія зафіксувала намір покласти відповідальність за наявність цих інструментів на CLI `@nitra/cursor`, а не на ручне налаштування.

## Considered Options
* Авто-встановлення через package manager (brew для macOS, аналоги для Linux і Windows) з підказкою як fallback
* Лише детект + підказка без авто-встановлення
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Авто-встановлення через package manager з підказкою як fallback", because команда є внутрішньою (`@nitra/cursor`), тому авто-bootstrap залежностей прийнятний; підказка залишається для платформ або сценаріїв, де авто-встановлення неможливе.

### Consequences
* Good, because transcript фіксує очікувану користь: всі споживачі `n-fix` / `n-lint` матимуть необхідні бінарники без ручного налаштування.
* Neutral, because transcript не містить підтвердження наслідку: конкретний механізм встановлення на Linux і Windows не обговорювався, реалізація в сесії не розпочата.

## More Information
Рішення ухвалено під кінець сесії; імплементація не почалась. Потребує крос-платформного визначення package manager (brew / apt / winget або аналоги), а також обробки граничних випадків: поза git-репо, `CI=true`, конфлікт з іншими hook-frameworks (husky/lefthook). Точки входу — скіли `.cursor/skills/n-fix/SKILL.md` і `.cursor/skills/n-lint/SKILL.md`.
