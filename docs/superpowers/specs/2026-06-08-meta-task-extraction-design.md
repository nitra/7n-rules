# Meta-task Extraction Design

## Мета

Винести систему керування рекурсивними задачами з `@nitra/cursor` в окремий
репозиторій `/Users/vitaliytv/www/nitra/mt` і npm-пакет `@7n/mt`.

Перенесення одночасно завершує термінологічну міграцію:

- назва системи: **Meta-task**;
- CLI binary і namespace: **`mt`**;
- runtime root: **`mt/`**;
- canonical specification: **`npm/docs/mt.md`**;
- legacy-назви системи `flow` і `graph` повністю видаляються.

## Вихідний стан

Реалізація Meta-task зараз розподілена між кількома шарами `@nitra/cursor`:

- `npm/scripts/graph/`;
- `npm/scripts/dispatcher/graph/`;
- `npm/scripts/dispatcher/`;
- CLI-гілки `flow`, `graph` і `watch` у `npm/bin/n-cursor.js`;
- повна специфікація `npm/docs/flow.MD`;
- короткий застарілий огляд `docs/flow.md`;
- task runtime у `tasks/`;
- ADR із термінами `flow`, `graph`, task artifacts і task orchestration.

`npm/docs/flow.MD` є побайтовим Git-rename колишнього `docs/думка.MD` і є
повною специфікацією. `docs/flow.md` є окремим старим оглядом і не є її копією.

Цільовий репозиторій уже створено:

- repository root: `/Users/vitaliytv/www/nitra/mt`;
- package root: `/Users/vitaliytv/www/nitra/mt/npm`;
- package name: `@7n/mt`.

## Публічний Контракт

Пакет публікує самостійний binary:

```json
{
  "name": "@7n/mt",
  "bin": {
    "mt": "bin/mt.js"
  }
}
```

Основний інтерфейс:

```bash
mt setup
mt init
mt plan
mt verify
mt run
mt status
mt scan
mt watch
mt audit
mt done
mt failed
mt spawn
mt invalidate
mt kill
```

Це повний public command surface першої версії `@7n/mt`. Команди не повинні
залежати від binary або runtime-коду `@nitra/cursor`.

`@nitra/cursor` не зберігає facade `n-cursor mt`. Після extraction у ньому немає
команд `flow`, `graph`, `watch` або `mt`, що делегують у новий пакет.

## Доменна Модель

- **Meta-task** — коренева керована робота разом з усією рекурсивною
  декомпозицією.
- **Task** — будь-який вузол усередині Meta-task, включно з коренем.
- **Atomic task** — task, що виконується без декомпозиції.
- **Composite task** — task із дочірніми tasks.
- **MT state** — стан task, виведений із файлових артефактів.
- **MT runner** — виконавець task.
- **MT watcher** — оркестратор планування, запуску, аудиту, merge і cleanup.

Структура даних може описуватися загальним технічним терміном DAG або
dependency graph, але `graph` не є назвою продукту, CLI namespace чи модуля.

## Файлова Модель

Єдиний runtime root — `mt/`:

```text
mt/
└── <meta-task-id>/
    ├── task.md
    ├── a.md | h.md
    ├── deps/
    ├── plan_NNN.md
    ├── run_NNN.md
    ├── fact_NNN.md
    ├── pending-audit_NNN.md
    ├── audit-result_NNN.md
    ├── history/
    └── <child-task>/
```

Команди приймають шлях відносно `mt/`:

```bash
mt status release
mt run release/deploy
mt audit release/deploy
```

Runtime root `tasks/` не підтримується.

## Clean Break

Міграція не має compatibility layer:

- немає aliases `flow`, `graph` або `n-cursor mt`;
- немає deprecation period;
- немає команди `mt migrate`;
- немає автоматичного перенесення `tasks/` у `mt/`;
- новий пакет не читає legacy runtime artifacts;
- старі локальні task-дані користувач видаляє або переносить вручну поза
  контрактом пакета.

Clean break є свідомим рішенням: менший API surface і відсутність подвійної
термінології важливіші за автоматичну сумісність із незавершеною системою.

## Межа Пакета

До `@7n/mt` переходять:

- MT engine і CLI;
- scanner і derivation станів;
- task artifacts і файловий контракт;
- worktree orchestration;
- runner, watcher і audit queue;
- профільні unit, integration та behavioral tests;
- canonical specification `npm/docs/mt.md`;
- 168 відібраних ADR.

У `@nitra/cursor` після extraction не залишаються:

- implementation directories `npm/scripts/graph/` і
  `npm/scripts/dispatcher/graph/`;
- flow/graph-specific dispatcher modules;
- CLI branches `flow`, `graph` і standalone `watch`;
- правила або інструкції, що описують старий lifecycle;
- `docs/flow.md`, `npm/docs/flow.MD` і `docs/flow-graph.html`;
- копії перенесених ADR.

Загальні модулі `@nitra/cursor` переносяться лише тоді, коли вони є частиною MT
runtime. Спільні lint, changelog, release та repository tooling лишаються у
`@nitra/cursor` як зовнішня dev dependency нового репозиторію.

## ADR Migration

Переносяться рівно 168 ADR-кандидатів, знайдених погодженим content-пошуком за
ознаками Meta-task:

```text
n-cursor flow
n-cursor graph
.flow.json
pending-audit_
fact_NNN
task.md
tasks/
думка.MD
Пасивний Турнікет
Активний Раннер
```

Правила перенесення:

- звичайний файловий move без імпорту Git-історії;
- timestamp-префікси та поточні імена зберігаються на етапі move;
- файли видаляються з `cursor/docs/adr/`;
- файли додаються до `mt/docs/adr/`;
- решта 471 ADR залишаються в `@nitra/cursor`;
- копії між репозиторіями заборонені.

Після move зміст 168 ADR нормалізується як нейтральна еволюція Meta-task:

- старі product identifiers замінюються на `mt`;
- `tasks/` замінюється на `mt/`;
- старі specification paths замінюються на `npm/docs/mt.md`;
- рішення виду «перейти з flow на graph» переписуються як зміна внутрішньої
  архітектури або CLI Meta-task;
- не допускаються беззмістовні формулювання на кшталт «видалити mt на користь
  mt»;
- загальні терміни control flow, dependency graph, GraphQL і GitHub workflow не
  перейменовуються, якщо вони не позначають колишню назву системи.

У `mt/docs/adr/` додається окремий ADR про extraction із `@nitra/cursor` у
`@7n/mt`.

## Документація

`npm/docs/flow.MD` переноситься до `mt/npm/docs/mt.md` і стає єдиною canonical
specification.

Під час нормалізації:

- назва системи стає Meta-task;
- приклади CLI використовують `mt`;
- runtime paths використовують `mt/`;
- implementation paths відповідають новому package layout;
- посилання на перенесені ADR залишаються локальними для репозиторію MT.

`docs/flow.md` не синхронізується і не переноситься, оскільки це застарілий
короткий огляд. Файл видаляється без злиття в canonical specification.

## Послідовність Міграції

1. Зафіксувати behavioral contract поточної реалізації тестами.
2. Виправити scaffold metadata `@7n/mt` і створити binary `mt`.
3. Перенести MT engine, CLI та worktree orchestration у новий пакет.
4. Перейменувати implementation identifiers і runtime root на `mt`.
5. Перенести й адаптувати профільні тести.
6. Перенести `npm/docs/flow.MD` у `mt/npm/docs/mt.md`.
7. Move 168 ADR у `mt/docs/adr/` і нормалізувати їх як еволюцію MT.
8. Підтвердити behavioral parity у новому репозиторії.
9. Видалити весь перенесений код, CLI та документацію з `@nitra/cursor`.
10. Запустити повні test, lint і changelog gates в обох репозиторіях.

Порядок навмисно створює працездатний `@7n/mt` до видалення реалізації з
`@nitra/cursor`.

## Перевірка

### `@7n/mt`

- package metadata вказує на правильний repository і binary;
- `mt --help` і `mt --version` працюють;
- усі команди використовують лише `mt/`;
- unit та integration tests проходять;
- behavioral tests підтверджують parity із перенесеною реалізацією;
- package не імпортує runtime-модулі `@nitra/cursor`;
- `npm/docs/mt.md` є єдиною canonical specification;
- 168 ADR присутні та не містять legacy product naming;
- lint, security, text і changelog gates проходять.

### `@nitra/cursor`

- CLI не розпізнає `flow`, `graph`, standalone `watch` або `mt`;
- перенесені implementation paths відсутні;
- 168 ADR відсутні;
- legacy product docs відсутні;
- загальний пошук `flow` і `graph` містить лише сторонні або загальновживані
  технічні значення;
- решта CLI і repository tooling працюють без regression;
- tests, lint і changelog gates проходять.

## Атомарність Доставки

Міграція завершується двома узгодженими commits:

1. `@7n/mt`: повна реалізація, тести, specification та ADR.
2. `@nitra/cursor`: видалення перенесеної реалізації, команд, документації та
   ADR.

Коміт у `@nitra/cursor` не створюється, доки `@7n/mt` не проходить acceptance
gates. Публікація npm-пакета може відбутися після merge першого commit і не є
умовою для видалення коду, бо `@nitra/cursor` не делегує виконання в новий пакет.

## Прийняті Trade-offs

- Існуючі `tasks/` не мігруються і стають нерозпізнаними.
- Немає compatibility aliases, тому споживачі мають одразу перейти на `mt`.
- Git-історія 168 ADR не імпортується в новий репозиторій; хронологія
  зберігається timestamp-іменами та вмістом.
- Частина історичних ADR переписується для термінологічної цілісності, тому
  старі назви продукту не зберігаються як історичний narrative.
- Два репозиторії потребують координованого завершення, але не runtime coupling.
