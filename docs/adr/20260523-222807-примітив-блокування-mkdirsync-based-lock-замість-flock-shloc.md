---
session: 15a0a2e6-de28-4a12-8fa8-3cee36f7fe61
captured: 2026-05-23T22:28:07+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/15a0a2e6-de28-4a12-8fa8-3cee36f7fe61.jsonl
---

## ADR Примітив блокування — `mkdirSync`-based lock замість `flock` / `shlock` / `proper-lockfile`

## Context and Problem Statement
На macOS системна команда `flock` відсутня (`flock not found`). Наявний `/usr/bin/shlock` дає лише взаємне виключення без дедуплікації. Потрібен атомарний примітив без зовнішніх залежностей.

## Considered Options
* `mkdirSync`-based lock — `fs.mkdirSync()` атомарний на APFS; `owner.json` з PID для перевірки застарілості через `process.kill(pid, 0)`
* `/usr/bin/shlock` — є на macOS, але дає лише mutual exclusion; дедуп все одно писати самостійно; залежність від зовнішнього бінарника
* npm-пакет `proper-lockfile` — кросплатформний, але не вміє дедуп; зовнішня залежність заради ~150 рядків

## Decision Outcome
Chosen option: "`mkdirSync`-based lock", because дає повний контроль над JSON-дедупом, не потребує зовнішніх залежностей і покриває macOS/APFS без обхідних рішень.

### Consequences
* Good, because transcript фіксує очікувану користь: ~150 рядків чистого bun-коду, вся логіка перевірки застарілості PID і TTL зосереджена в одному модулі `with-lock.mjs`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізація: `npm/scripts/utils/with-lock.mjs`. Застарілий лок виявляється через `process.kill(pid, 0)` + максимальний вік 30 хв. Існуючий прецедент `mkdir`-lock у проєкті: `.claude/hooks/.normalize.lock` (коментар у `normalize-decisions.sh:56` визнає відсутність `flock` на macOS).

---

## ADR Поведінка при зайнятому локу — wait + deduplicate

## Context and Problem Statement
Кілька незалежних агентів можуть одночасно запустити одну й ту саму важку команду (наприклад `lint-ga`). Потрібно вирішити, що робить другий агент, коли лок уже зайнятий.

## Considered Options
* Чекати в черзі (poll-and-wait)
* Негайно завершитись з помилкою (fail-fast)
* Чекати + дедуплікувати — якщо перший прогін завершився успіхом із тим самим станом, другий агент перевикористовує результат без повторного запуску

## Decision Outcome
Chosen option: "Чекати + дедуплікувати", because усуває марні повторні прогони, коли N агентів лінтять ідентичне дерево.

### Consequences
* Good, because transcript фіксує очікувану користь: агент Б отримує `exit 0` і лог `♻️ деdup — те саме дерево пройшло Xс тому, пропускаю` без повторного запуску важкої команди.
* Bad, because дедуп активний лише при `exitCode === 0`; невдалий прогон завжди переганяється — транскрипт це підтверджує як свідому поведінку.

## More Information
Таймаут очікування 20 хв; при перевищенні — попередження і виконання без локу (краще ніж вічне зависання). API: `withLock(key, runFn, opts) → Promise<number>`. Чиста функція рішення `shouldDedup` виноситься окремо для юніт-тестів. Файли: `npm/scripts/utils/with-lock.mjs`, `npm/scripts/utils/tests/with-lock.test.mjs`.

---

## ADR Гранулярність взаємного виключення — per-command lock

## Context and Problem Statement
Паралельні агенти можуть запускати різні важкі команди (`lint-ga`, `lint-rego`, `lint-text` тощо). Потрібно вирішити, чи всі вони конкурують за один лок.

## Considered Options
* Один глобальний лок — лише одна важка команда одночасно
* Лок на команду (per-command key) — `lint-ga` і `lint-rego` можуть іти паралельно; конкурують лише виклики однієї й тієї ж команди

## Decision Outcome
Chosen option: "Лок на команду", because дозволяє незалежним командам йти паралельно і не гальмує агентів без потреби.

### Consequences
* Good, because transcript фіксує очікувану користь: гранулярність `key` (`'lint-ga'`, `'lint-rego'` тощо) вбудована в API `withLock(key, ...)`, тому кожна команда отримує власний каталог стану `<key>.lock/` і `<key>.result.json`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`key` — рядок-ідентичність: `'lint-ga'`, `'lint-rego'` тощо. Стан: `node_modules/.cache/n-cursor/<key>/lock/` і `node_modules/.cache/n-cursor/<key>/result.json`.

---

## ADR Умова дедуплікації — SHA-256 відбиток git-дерева + TTL

## Context and Problem Statement
Для перевикористання результату попереднього прогону потрібен критерій «чи змінився стан коду» та «чи не застарів результат».

## Considered Options
* Лише TTL — результат вважається чинним N хвилин після завершення
* Лише хеш git-дерева — результат чинний, поки стан дерева не змінився
* Хеш + TTL — результат чинний, якщо і дерево не змінилось, і не минув TTL (10 хв)

## Decision Outcome
Chosen option: "Хеш + TTL", because TTL запобігає використанню занадто старого кешу навіть при незмінному дереві; хеш забезпечує кореляцію з реальним станом файлів.

### Consequences
* Good, because transcript фіксує очікувану користь: сценарій «N субагентів лінтять однаковий стан» дає ідеальний збіг і чистий дедуп; TTL 10 хв обраний як розумний баланс свіжості й ефективності.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Fingerprint = SHA-256 від `git rev-parse HEAD` + `git diff HEAD` + (для кожного untracked-файла з `git ls-files --others --exclude-standard`: шлях + `git hash-object`). Поза git-репо → `null` → дедуп вимкнено, лок далі працює. Реалізація: `npm/scripts/utils/worktree-fingerprint.mjs`, тести: `npm/scripts/utils/tests/worktree-fingerprint.test.mjs`.

---

## ADR Точка інтеграції локу — вбудований у команду, не окрема обгортка `guard`

## Context and Problem Statement
Лок можна реалізувати як окрему підкоманду-обгортку (`n-cursor guard lint -- bun run lint`), яку мають викликати скіли, або як логіку всередині самої команди, яку агент запускає як завжди.

## Considered Options
* Обгортка-команда `n-cursor guard <key> -- <команда>` — скіли явно викликають обгортку; прямий виклик `bun run lint` обходить лок
* Вбудовано в команду — лок є частиною реалізації `runLintGaCli`; скіли, `package.json`, агент викликають `bun run lint-ga` без змін

## Decision Outcome
Chosen option: "Вбудовано в команду", because окрема обгортка — це слабке місце: агент може легко обійти її, викликавши `bun run lint` напряму; вбудований лок гарантований незалежно від точки виклику.

### Consequences
* Good, because transcript фіксує очікувану користь: скіли, `package.json`, виклики CLI — без змін; лок інтринсивний і не потребує дисципліни від агентів.
* Bad, because лок потрібно додавати вручну в кожну нову команду — автоматичне застосування неможливе.

## More Information
Інтеграція в `npm/rules/ga/lint/lint.mjs:168`:
```js
export const runLintGaCli = () => withLock('lint-ga', runLintGaSteps)
```
Поточна логіка перейменована в приватну `runLintGaSteps()`. Виклик у `npm/bin/n-cursor.js` (case `'lint-ga'`) незмінний. Розкочування на `lint-rego`, `lint-text`, `lint-k8s`, `lint-docker` — наступними ітераціями за тим самим зразком.

---

## ADR Місце зберігання стану локу — `node_modules/.cache/n-cursor/`

## Context and Problem Statement
Файли стану (`lock/`, `result.json`) потрібно зберігати так, щоб вони не потрапляли до git, не вимагали окремого запису в `.gitignore`, і були безпечні при паралельному доступі.

## Considered Options
* `node_modules/.cache/n-cursor/<key>/` — вже gitignored через стандартний `node_modules` pattern; знесеться при `bun i`, що безпечно (під час інсталяції лінту нема)
* `.n-cursor/guard/` у корені репо — потребує окремого запису в `.gitignore`; видно у `git status`

## Decision Outcome
Chosen option: "`node_modules/.cache/n-cursor/<key>/`", because вже gitignored без додаткових записів; узгоджується з конвенцією інструментів зберігати кеш у `node_modules/.cache/`.

### Consequences
* Good, because transcript фіксує очікувану користь: не забруднює `git status`, не потребує змін `.gitignore`.
* Bad, because `bun i` або `rm -rf node_modules` знесе кеш — усі агенти запускатимуть команди заново; transcript визнає це прийнятним («безпечно, бо під час інсталяції лінту нема»).

## More Information
Структура стану: `node_modules/.cache/n-cursor/<key>/lock/owner.json` (`{pid, host, startedAt, fingerprint}`) і `node_modules/.cache/n-cursor/<key>/result.json` (`{finishedAt, exitCode, fingerprint}`).
