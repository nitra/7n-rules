# LLM-нормалізація чернеток ADR без авто-коміту

**Status:** Accepted
**Date:** 2026-05-15

## Контекст

Правило `adr` накопичувало чернетки без будь-якого механізму їх структурування — після кількох тижнів роботи накопичилося 156 файлів, які ніхто не переглядав. Виникла потреба у автоматизованій нормалізації без ручного втручання після кожної сесії.

## Рішення/Процедура/Факт

- Ознака «чернетка» — наявність `session:` у YAML-frontmatter; чернетки пишуться безпосередньо у `docs/adr/<timestamp>-<sid>.md`. Канонічні файли мають назву `<slug-українською>.md` без frontmatter.
- Новий Stop-hook `normalize-decisions.sh` запускається асинхронно (`timeout: 600`), коли кількість draft-файлів досягає `ADR_NORMALIZE_THRESHOLD` (default 30). LLM повертає JSON-масив операцій `{op: "rewrite"|"delete"|"merge-into", file, slug?, content?, target?, additions?}`, скрипт застосовує їх до working tree.
- Жодного `git add` або `git commit` — розробник бачить зміни через `git status` і `git diff` та сам вирішує, що прийняти.
- Нова skill `adr-normalize` для ручного тригера поза порогом.
- Версія `@nitra/cursor` 1.9.23 → 1.10.0; оновлено `sync-claude-config.mjs`, `check.mjs`, `settings_json.rego`, `settings_local_json.rego`, `auto-skills.mjs`, `.gitignore`.

## Обґрунтування

Підхід «маркер у frontmatter замість окремої теки» дозволяє LLM редагувати або видаляти той самий файл на місці без переміщення між директоріями — менше рухомих частин. Відсутність авто-коміту критично важлива: LLM може кластеризувати теми неточно, тому `git diff` перед комітом — єдине review-вікно. Дата у фінальному ADR береться з `captured` (час події), а не з часу нормалізації, щоб ADR датувався реальним рішенням.

## Розглянуті альтернативи

- Batch-команда `npx @nitra/cursor adr-promote` (ручний запуск) — відхилено як менш автоматизована.
- Continuous-промоція на кожен Stop — відхилено: рішення ще змінюються протягом сесії.
- Запис нормалізованих файлів у `docs/adr/_pending/` — відхилено: зайве тертя.
- Однофазний LLM-виклик на весь батч — залишено як основний.

## Зачіпає

`npm/.claude-template/hooks/capture-decisions.sh`, `npm/.claude-template/hooks/normalize-decisions.sh` (новий), `npm/scripts/sync-claude-config.mjs`, `npm/rules/adr/js/check.mjs`, `npm/rules/adr/adr.mdc`, `npm/rules/adr/policy/settings_json/settings_json.rego`, `npm/rules/adr/policy/settings_local_json/settings_local_json.rego`, `npm/scripts/auto-skills.mjs`, `npm/skills/adr-normalize/SKILL.md` (новий), `.gitignore`, `npm/package.json`, `npm/CHANGELOG.md`

## Update 2026-05-15

**Пропозиція автоматизації промоції чернеток через LLM.**

Найприродніша схема — новий hook або скрипт, що запускається за подією (`PostToolUse` на запис у `_inbox/`, або `schedule`-cron). Логіка:

1. Читає нові файли з `docs/adr/_inbox/` (трекінг через тег у frontmatter або окремий стейт-файл).
2. LLM-фільтр: передає вміст чернетки моделі з промптом «Чи є тут справжнє архітектурне рішення? YES/NO + slug».
3. Для YES: LLM генерує структурований ADR без службового frontmatter, CLI призначає наступний номер, записує у `docs/adr/NNNN-<slug>.md`, видаляє або архівує чернетку в `_inbox/archived/`.
4. Для NO: чернетку видаляє або лишає без змін.

Реалізація можлива як новий Stop-hook `promote-adrs.sh` за зразком `capture-decisions.sh`, або окремий скрипт із `/schedule`-cron.

## Update 2026-05-15

### Нормалізація «на місці» замість двоступеневого inbox/promote

Альтернативна модель: відмовитися від окремих папок `_inbox/` і `_promoted/`. Усі файли живуть в єдиному каталозі `docs/adr/`. `capture-decisions.sh` пише чернетку з маркером `status: raw` у frontmatter. При досягненні threshold (≥ 30 необроблених файлів) Stop-hook запускає двофазний LLM-пайплайн:

1. **Фаза 1 — кластеризація:** LLM повертає JSON `[{title, sources:[...]}]`.
2. **Фаза 2 — синтез:** LLM перезаписує файли нормалізованим змістом і прибирає `status: raw`; тривіальні або дублюючі чернетки видаляються.

`git status` після нормалізації показує `modified` (очищено) та `deleted` (відкинуто) — природній review-вікно без окремого `_pending/`. Необроблені файли легко фільтрувати: `grep -rl 'status: raw' docs/adr/`.

Recursion guard `ADR_PROMOTE_RUNNING=1` запобігає повторному запуску під час внутрішньої LLM-сесії.

**Відхилені альтернативи:** `_inbox/` → `_promoted/` (складніша схема переміщень, залишає сміттєві сирці); continuous-промоція на кожен Stop (рішення ще нестабільні в активній сесії); однофазний LLM-виклик на 30 файлів одразу (ризик склеїти різні рішення).

**Зачіпає:** `npm/.claude-template/hooks/capture-decisions.sh`, новий `npm/.claude-template/hooks/promote-decisions.sh`, `.cursor/rules/n-adr.mdc`, структура `docs/adr/`.

## Update 2026-05-15

### Двофазна кластеризація

Нормалізація реалізована двофазно: (a) перший виклик LLM повертає лише JSON-кластери `[{title, sources:[...]}]`; (b) окремий LLM-виклик на кожен кластер генерує фінальний ADR-текст. Однофазний варіант (усі 30 файлів → N ADR-ів за один виклик) збережено як fallback.

### JSON-операції нормалізатора

LLM повертає масив операцій трьох типів: `rewrite` — переписати драфт, зняти frontmatter, перейменувати у `<slug>.md`; `delete` — тривіальний або повністю покритий іншим ADR; `merge-into` — зміст покрито існуючим файлом, дописати нові деталі туди, драфт видалити.

### Маркер «сирий файл»

Маркером необробленості є наявність поля `session:` у YAML frontmatter. Сирі файли мають вигляд `20260515-090910-88a66cb5.md`; після нормалізації frontmatter знімається, файл перейменовується у `<slug>.md`.

### Без авто-коміту

Скрипт залишає змінені, видалені та нові файли в робочому дереві. Розробник переглядає `git diff` / `git status` і самостійно вирішує, що прийняти — git diff слугує review-інтерфейсом без додаткового інструментарію.

## Update 2026-05-20

### Збереження часового префікса чернетки в імені clean-ADR

Chosen option: "Зберігати `YYYYMMDD-HHMMSS-` префікс чернетки в імені clean-файлу", because користувач явно вказав: «залишай дату та час на початку файлу, щоб назва файлів рідше змінювалась».

- Good, because ім'я clean-файлу стабільне між нормалізаціями — slug змінюється, але дата/час лишаються незмінними, тому git-посилання не ламаються.
- Bad, because transcript не містить підтверджених негативних наслідків.

Логіка: якщо ім'я вхідного файлу-чернетки відповідає патерну `[0-9]{8}-[0-9]{6}-*`, prefix `YYYYMMDD-HHMMSS-` вирізається та додається до slug → `YYYYMMDD-HHMMSS-<slug>.md`; інакше файл отримує просто `<slug>.md`. Змінені файли: `npm/.claude-template/hooks/normalize-decisions.sh`, `.claude/hooks/normalize-decisions.sh`, `npm/rules/adr/adr.mdc` (версія `2.0` → `2.1`), `npm/skills/adr-normalize/SKILL.md`. Версія пакету: `1.13.58` → `1.13.59`.

## Update 2026-05-20

Змінено формат імені clean-файлу: операція `rewrite` у `normalize-decisions.sh` тепер зберігає `YYYYMMDD-HHMMSS-`-префікс чернетки — результат `YYYYMMDD-HHMMSS-<slug>.md` замість bare `<slug>.md`. Це стабілізує ім'я (slug змінює лише суфікс) і підтримує хронологічне сортування `docs/adr/` за `ls`. Fallback для чернеток без timestamp-префікса — bare `<slug>.md`; колізії — детермінований суфікс `-2`/`-3` на повному новому імені. Файли: `npm/.claude-template/hooks/normalize-decisions.sh`, `.claude/hooks/normalize-decisions.sh`, `npm/rules/adr/adr.mdc` (bump `v2.0`→`v2.1`), `npm/skills/adr-normalize/SKILL.md`. Версія: `1.13.58`→`1.13.59`→`1.13.66` (після rebase на `main`).

## Update 2026-05-21

### Ручний запуск з обходом throttle-guards

Автоматичний hook `.claude/hooks/normalize-decisions.sh` має два throttle-guard: `ADR_NORMALIZE_THRESHOLD` (мінімальна кількість чернеток) і `ADR_NORMALIZE_MIN_INTERVAL_HOURS` (cooldown між прогонами). При ручному запуску скіла `/n-adr-normalize` обидва виставляються у `0`: `ADR_NORMALIZE_THRESHOLD=0 ADR_NORMALIZE_MIN_INTERVAL_HOURS=0 bash .claude/hooks/normalize-decisions.sh`. Без цього обходу скрипт видавав `skip: only N s since last attempt`.

Додатково: dry-run перед реальним прогоном — `ADR_NORMALIZE_DRY=1` (лог: `DRY RUN — would apply 10 operations`). Batch size: 10; модель: `claude CLI (model: sonnet)`; лог: `.claude/hooks/normalize-decisions.log`.

### Пост-батч workflow: залишати результат для рев'ю без авто-коміту

Після завершення батчу нормалізації нові чернетки, захоплені hook-ом під час сесії, опиняються в `docs/adr/` поряд із нормалізованими файлами. `git add docs/adr/` включив би нові чернетки разом із нормалізованими ADR — змішання двох логічних кроків в одному коміті.

Рішення: залишати unstaged зміни для ручного рев'ю. Оператор перевіряє якість MADR-файлів через `git diff` і вручну стейджить лише нормалізовані ADR, виключаючи нові чернетки з timestamp `20260521-…`.

## Update 2026-05-21

### Надання переваги `merge-into` над `rewrite`: виправлення LLM-промпта та apply-логіки

**Проблема:** 3 з 10 `merge-into`-операцій пропускалися (`skip merge-into: target missing`) через три кореневі причини: (1) промпт дозволяв цілити `merge-into` у slug сусідньої `rewrite`-операції того ж батча, але apply-логіка не вміла його резолвити; (2) відсутній fallback для clean-файлів із timestamp-префіксом; (3) у сумнівних ситуаціях LLM обирав безпечніший `rewrite` замість `merge-into`.

**Рішення — уточнений промпт та двопрохідна apply-логіка:**
- **Промпт** — доданий абзац "Принцип вибору операції": перш ніж обрати `rewrite`, порівняти тему драфта зі clean-списком і рештою батча; `rewrite` — лише для справді нового рішення. `target` може бути: (а) файлом зі списку clean-файлів, (б) `<slug>.md` `rewrite`-операції того ж батча (timestamp-префікс додасть скрипт), (в) унікальним clean-файлом, що закінчується на `-<slug>.md`.
- **Apply-логіка** — прохід 1: `delete` + `rewrite`, будує мапу `slug → реальний шлях`; прохід 2: `merge-into` з резолвингом по черзі через (а) точну назву в `docs/adr/`, (б) slug-мапу батча, (в) суфіксний пошук серед наявних clean-файлів.

**Перевірка:** end-to-end тест зі синтетичними чернетками підтвердив коректне застосування всіх 4 типів операцій без пропусків; `check changelog` і `check adr` — ✅.

Змінені файли: `npm/.claude-template/hooks/normalize-decisions.sh` (60 рядків diff), `.claude/hooks/normalize-decisions.sh` (IDENTICAL копія; `diff` підтвердив). Bump `@nitra/cursor` `1.13.67 → 1.13.68`.
