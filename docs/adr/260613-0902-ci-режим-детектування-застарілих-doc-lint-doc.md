---
session: 4b386ce5-70e3-4c5a-b5f6-bcdd5aef68ed
captured: 2026-06-13T09:02:12+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/4b386ce5-70e3-4c5a-b5f6-bcdd5aef68ed.jsonl
---

Ось три ADR, що фіксують рішення сесії:

---

## ADR CI режим детектування застарілих doc: lint-doc

## Context and Problem Statement

Інструмент `lint-doc` виявляє два стани застарілості документації: `missing` (doc-файл відсутній) та `crc-mismatch` (doc існує, але CRC у frontmatter не збігається з поточним CRC джерела). Потрібно визначити, який із цих станів має призводити до `exit 1` у CI, щоб документація не розходилася з кодом непомітно.

## Considered Options

* **Повне детектування застарілості** — CI завершується з `exit 1` як при `missing`, так і при `crc-mismatch`
* **`--missing-only`** — CI завершується з `exit 1` лише при `missing`; стан `crc-mismatch` ігнорується

## Decision Outcome

Chosen option: "Повне детектування застарілості", because `--missing-only` залишає головну прогалину відкритою — doc-файли мовчки розходяться з кодом після змін у джерелі, і CI цього не помічає.

### Consequences

* Good, because будь-яке розходження між кодом і документацією виявляється в CI автоматично — жодного тихого drift.
* Good, because розробник отримує сигнал одразу після зміни джерела, а не після накопичення tech-debt.
* Bad, because перед увімкненням CI обов'язково потрібен Step 0: `bun run fix-doc` до нульового стану stale; інакше перший прогін одразу червоний на накопиченому борзі.
* Bad, because `--missing-only` як CLI-опція залишається, але не використовується в CI — можлива плутанина у нових учасників команди.

## More Information

* Специфікація: `docs/superpowers/specs/2026-06-12-doc-files-lint-doc-fix-doc-split.md`
* Step 0 перед активацією CI: `bun run fix-doc` — обнуляє стан `missing` і `crc-mismatch`
* `--missing-only` залишається як CLI-опція для локального/ручного використання, але не підключається до CI-пайплайну

---

## ADR lint-doc --since: уніфікований інтерфейс для агентів і CI

## Context and Problem Statement

Локальні агенти, що редагують файли до commit-а, потребують перевіряти лише змінені файли відносно `origin`, а не тільки відносно `HEAD`. CI має використовувати ту саму CLI-команду — без YAML-рівневої diff-логіки — щоб поведінка локально і в pipeline збігалася. Існуючий `--git` режим (`vs HEAD`) не покриває вже закомічені зміни в гілці, тому потрібен новий режим із merge-base-семантикою.

## Considered Options

* `lint-doc --since <ref>` — `git diff --name-only --merge-base <ref>` проти working tree (включає uncommitted зміни), базовий ref = `@{upstream}`, fallback до `origin/HEAD`
* Передача шляхів через YAML і виклик `lint-doc <paths...>` — CI-сторона формує список файлів самостійно, CLI лише валідує

## Decision Outcome

Chosen option: "`lint-doc --since <ref>`", because це єдина точка входу для агентів і CI, охоплює uncommitted зміни, reuse-ує merge-base-семантику git, і усуває дублювання diff-логіки в YAML.

### Consequences

* Good, because локальний агент і CI викликають ідентичну команду — немає розбіжності між середовищами.
* Good, because `--merge-base` коректно виключає зміни, що вже є в `<ref>`, незалежно від кількості commit-ів у гілці.
* Good, because both-direction mapping зберігається: змінений source → його doc; змінений/видалений doc → його source.
* Good, because `--git` (vs `HEAD`) залишається як Stop-gate у PostToolUse хуку (exit 2) — швидка перевірка без зміни семантики.
* Bad, because при detached HEAD або непропушеній гілці upstream не резолвиться — режим автоматично fallback-ається до `--full`, що може бути повільніше.
* Bad, because CI push-to-main вимагає явного `$LAST_GREEN` SHA, що додає залежність від зовнішнього стану pipeline.

## More Information

Режими виклику:
```
# Локальний агент (upstream = origin/main або аналог)
lint-doc --since

# Локальний агент з явним ref
lint-doc --since origin/main

# CI: PR
lint-doc --since origin/$BASE_REF

# CI: push до main
lint-doc --since $LAST_GREEN   # SHA: gh run list --workflow lint-doc.yml --status success --limit 1 --json headSha
```

Логіка вибору файлів: `git diff --name-only --merge-base <ref>` (проти working tree).

Fallback-ланцюжок для base ref: `@{upstream}` → `origin/HEAD` → `--full`.

Існуючий `--git` режим залишається активним як PostToolUse хук зі `exit 2` (Stop-gate), не замінюється.

---

## ADR Інверсія дефолту lint-doc: без аргументів = delta, --full = повний скан

## Context and Problem Statement

Раніше `lint-doc` без аргументів запускав повний скан усіх файлів репозиторію, що є зайвим під час виконання агентом часткового завдання. Агенти, що викликають `lint-doc` у середині задачі, мають бачити лише власні зміни. Повний скан залишається потрібним як явна базова аудит-операція, але не як дефолт.

## Considered Options

* Залишити `lint-doc` (без аргументів) = повний скан, додати окремий прапор для delta-режиму
* Інвертувати дефолт: `lint-doc` (без аргументів) = delta vs `@{upstream}` / `origin/HEAD`; `lint-doc --full` = явний повний скан
* Додати автоматичний fallback на `--full` при зміні scan-конфігурації (`docgen-ignore.mjs`)

## Decision Outcome

Chosen option: "Інвертований дефолт: lint-doc без аргументів = delta", because агенти, що викликають `lint-doc` у середині задачі, за замовчуванням отримують лише релевантний diff і не витрачають ресурси на повний скан.

### Consequences

* Good, because `bun run lint-doc` у кореневому lint-ланцюжку перевіряє лише зміни відносно origin — швидко і по суті.
* Good, because агент не отримує шум від файлів, яких він не торкався.
* Good, because явний `--full` сигналізує навмисний базовий аудит, а не випадковий повний прогін.
* Good, because безпечний fallback: якщо upstream не резолвиться (detached HEAD, гілка не запушена) — автоматично застосовується `--full`, тобто ніколи не під-перевіряє.
* Bad, because автоматичний fallback на `--full` при зміні `docgen-ignore.mjs` чи іншої scan-конфігурації — явно відхилений; відповідальність на розробнику запустити `--full` вручну після таких змін.
* Bad, because новий дефолт може здивувати людей, звиклих до попередньої поведінки повного скану без аргументів.

## More Information

Фінальний CLI після інверсії:
```
lint-doc              → delta vs @{upstream}/origin/HEAD (або --full якщо upstream недоступний)
lint-doc --full       → повний скан репозиторію
lint-doc --since ref  → явна базова точка
lint-doc --git        → vs HEAD (Stop-gate, exit 2)
lint-doc --hook       → один файл (PostToolUse)
```

Кореневий lint-ланцюжок: `bun run lint-doc` = delta-режим (швидкий, релевантний).

Повний скан (`--full`) — лише локально, без CI-розкладу; використовується як базова аудит-перевірка.
