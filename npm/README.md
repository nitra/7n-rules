# @nitra/cursor

Консольна утиліта для завантаження cursor-правил із префіксом `n-` у локальний git-репозиторій.

## Як це працює

Репозиторій `@nitra/cursor` містить cursor-правила у директорії `rules/<id>/`. CLI копіює `<id>.mdc` обраних правил з **каталогу `rules/` того пакету, з якого виконується `bin/n-cursor.js`**: після `npm i` / `bun add` це зазвичай `node_modules/@nitra/cursor/rules/<id>/<id>.mdc`; при **`npx @nitra/cursor`** пакет потрапляє в **кеш npx/npm**, і правила читаються з тієї розпакованої копії (у корені проєкту залежність не обов’язкова). Жодних окремих HTTP-запитів до CDN для файлів правил немає — лише те, що вже є в tarball пакету.

Наприклад, правило `rules/text/text.mdc` буде збережено як `.cursor/rules/n-text.mdc`.

## Підготовка

Перед першим запуском у вашому репозиторії створіть файл `.n-cursor.json` у корені проекту зі списком правил для завантаження:

```json
{
  "$schema": "https://unpkg.com/@nitra/cursor/schemas/n-cursor.json",
  "rules": ["npm-module", "text"],
  "skills": ["fix", "lint"]
}
```

Доступні правила:

| Назва        | Опис                                            |
| ------------ | ----------------------------------------------- |
| `npm-module` | Структура репозиторію для npm-модуля (bun mono) |
| `text`       | Текст, oxfmt, cspell, markdownlint, v8r, CI     |
| `k8s`        | Kubernetes YAML, Kustomize, kubeconform         |

Щоб використовувати конкретну версію правил, оновіть залежність `@nitra/cursor` у проєкті (`bun add -d @nitra/cursor@<версія>` тощо). Поле `version` у `.n-cursor.json`, якщо воно лишилось у старих конфігах, **ігнорується**.

### Виключення цілих дерев — поле `ignore`

Поле `ignore` у `.n-cursor.json` — список директорій (posix-шляхи відносно кореня репозиторію), які CLI повністю пропускає під час обходу: жоден `check-*.mjs` не сканує і не валідує файли всередині них, а агент не редагує/не створює/не видаляє там файли. Стандартні виключення (`node_modules`, `.git`, `dist`, `coverage`, `.turbo`, `.next`) працюють завжди — додавати їх у `ignore` не потрібно.

Типові кандидати: vendored Helm-чарти, генеровані маніфести, legacy-дерева, які не підтягуються під поточні правила:

```json
{
  "$schema": "https://unpkg.com/@nitra/cursor/schemas/n-cursor.json",
  "rules": ["k8s"],
  "ignore": ["dremio/dev/dremio_v2", "postgres-master"]
}
```

### Правило `k8s` і Kustomize

У цільовому репозиторії з маніфестами під **`**/k8s`** дотримуйтесь **`rules/k8s/k8s.mdc`** з пакету (після синку — `.cursor/rules/n-k8s.mdc` або копія з `node_modules/@nitra/cursor/rules/k8s/k8s.mdc`).

Коротко:

- **Структура Kustomize:** спільне виноситься в **`base`**; вміст **base** відповідає тому, як має виглядати середовище **dev**; окремої директорії **`dev/`** немає — за dev відповідає **`base`**. У інших середовищах — тонкі **overlays** (часто лише **`kustomization.yaml`** і patches / оверрайди).
- **Namespace** задається в **`kustomization.yaml`** (`namespace:`), а не через **`metadata.namespace`** у кожному ресурсі; окремі patches лише на зміну **namespace** не потрібні.
- У **Deployment** для кожного контейнера: **`resources`** (перевіряє **`npx @nitra/cursor check k8s`**);
- Рядки в **base**, які змінюються в overlays, позначайте коментарем на рядку (узгоджено в команді), наприклад: `# буде замінено через kustomize`.
- Після перенесення в **`base`** / overlays **видаляйте** застарілі маніфести та каталоги, які більше не потрібні.

Повний текст правил — у **`k8s.mdc`**; programmatic перевірки — у **`npm/rules/k8s/`**: JS-checks у `fix/<concern>/check.mjs`, rego-policies у `policy/<concern>/<name>.rego` (обидва запускаються через `npx @nitra/cursor check k8s`).

### v8r і власний каталог схем

Скрипт `scripts/run-v8r.mjs` передає в v8r каталог **`schemas/v8r-catalog.json`** пакета автоматично (у репозиторії той самий файл, що й `npm/schemas/v8r-catalog.json` від кореня монорепо). Якщо викликаєш `bunx v8r` напряму, передай `-c`: локально `node_modules/@nitra/cursor/schemas/v8r-catalog.json` або [unpkg](https://unpkg.com/@nitra/cursor/schemas/v8r-catalog.json). JSON Schema конфігурації: [n-cursor.json](https://unpkg.com/@nitra/cursor/schemas/n-cursor.json).

## Запуск

```bash
npx @nitra/cursor
npx @nitra/cursor check
npx @nitra/cursor check bun ga
```

Команда `check` запускає programmatic перевірки з каталогу `scripts/` пакету. Якщо в корені репозиторію вже є `.n-cursor.json`, перед перевірками виконується зчитування конфігу — зокрема додається або виправляється поле `$schema`, якщо воно відсутнє або не збігається з очікуваним URL.

CLI автоматично (команда завантаження правил без підкоманди `check`):

1. Знайде або створить `.n-cursor.json` у поточній директорії (із полем `$schema` на JSON Schema пакету; якщо файл уже є без коректного `$schema`, поле буде додано або оновлено при зчитуванні конфігу)
2. Створить директорію `.cursor/rules/`, якщо її ще немає
3. Скопіює кожне з перелічених у конфігу правило з `rules/<id>/<id>.mdc` установленого пакету і збереже файли з префіксом `n-`
4. Після оновлення файлів на диску згенерує в корені проєкту **`AGENTS.md`**: повний вміст береться з шаблону пакету `AGENTS.template.md`, а список правил у шаблоні формується з **усіх наявних файлів `*.mdc`** у `.cursor/rules/` (відсортовано за ім’ям); секція команд — з **`package.json`** кореня (див. `{{#commands}}` у шаблоні).

## Приклад виводу

```
🔧 @nitra/cursor — завантаження cursor-правил

📋 Правил до завантаження: 2
  ⬇  npm-module → .cursor/rules/n-npm-module.mdc ... ✅
  ⬇  text → .cursor/rules/n-text.mdc ... ✅
📝 Оновлено AGENTS.md з AGENTS.template.md

✨ Готово: 2 завантажено, 0 з помилками
```

## Структура пакету

```
npm/
├── AGENTS.template.md    # шаблон AGENTS.md для цільових репозиторіїв (потрапляє в npm-архів)
├── rules/                # cursor-правила (підкаталог на правило, див. «Структура одного правила»)
│   ├── npm-module/
│   ├── text/
│   └── ...
├── skills/               # скіли (каталоги <id>/; після синку — .cursor/skills/n-<id>/)
├── scripts/              # CLI-утиліти, спільні runner-и, discovery
└── bin/
    └── n-cursor.js       # CLI-скрипт (точка входу)
```

### Структура одного правила

Кожне правило `npm/rules/<id>/` ділиться за **технологією реалізації** на три сиблінги — `fix/`, `lint/`, `policy/`:

```
npm/rules/<id>/
├── <id>.mdc              # текст правила (після синку — .cursor/rules/n-<id>.mdc)
├── auto.md               # умова автоактивації скілу (опційно)
├── fix/                  # JS для `npx @nitra/cursor check`
│   └── <concern>/
│       ├── check.mjs     # діагностика — повертає список violations
│       ├── check.test.mjs
│       └── autofix.mjs   # опційно — програмний автофікс
├── lint/                 # JS, що живить `bun run lint-<id>` (для правил з канонічним lint-скриптом)
│   ├── lint.mjs          # CLI entry для `n-cursor lint-<id>`
│   └── run-*.mjs         # допоміжні runner-и (shellcheck, v8r тощо)
└── policy/               # rego для `npx @nitra/cursor check`
    └── <concern>/
        ├── <concern>.rego       # правила (`deny contains msg if …`)
        ├── <concern>_test.rego  # юніт-тести (запускає `bun run lint-rego` → conftest verify)
        └── target.json          # які файли подавати в conftest (single / walkGlob)
```

**Принцип:** технологія реалізації визначає директорію.

| Що реалізує | Канал виклику | Куди |
| --- | --- | --- |
| JS-діагностика + автофікс | `npx @nitra/cursor check` (fix-канал) | `fix/<concern>/` |
| JS-orchestrator лінту | `bun run lint-<id>` через `n-cursor lint-<id>` | `lint/` |
| Rego-діагностика | `npx @nitra/cursor check` (fix-канал) | `policy/<concern>/` |

`fix/` і `policy/` обидва живлять fix-канал (`npx @nitra/cursor check` запускає і JS-checks, і rego-policies), але **розділені за технологією**: JS у `fix/`, rego у `policy/`. `lint/` тримає лише JS, що оркеструє `bun run lint-<id>`.

## AGENTS.md у проєкті користувача

Після кожного успішного проходу завантаження правил CLI **повністю перезаписує** файл **`AGENTS.md`** у корені поточної директорії (та сама директорія, де лежить `.n-cursor.json`).

- **Джерело тексту** — файл **`AGENTS.template.md`** з установленого пакету `@nitra/cursor` (його не редагують у чужому репозиторії; зміни вносять у цьому репозиторії пакету).
- **Динамічний список правил** - Скрипт зчитує каталог **`.cursor/rules/`** і для **кожного файлу з розширенням `.mdc`** додає в шаблон рядок виду `- .cursor/rules/<ім’я>.mdc`. Туди потрапляють і керовані правила з префіксом `n-`, і будь-які інші `.mdc`, які вже лежать у цій папці.
- Редагувати згенерований **`AGENTS.md` у проєкті користувача немає сенсу** — наступний запуск CLI знову замінить файл. Власні інструкції для агентів треба закладати в **`AGENTS.template.md`** у репозиторії `@nitra/cursor` або тримати окремо від автогенерації.

## Інструкція для розробників пакету

### Зміна шаблону AGENTS

1. Редагуйте **`npm/AGENTS.template.md`**. Файл має бути перелічений у полі **`files`** у `npm/package.json`, щоб потрапляти в публікацію npm (разом з `rules/`, `skills/`, `bin/`).
2. Для вставки списку файлів правил використовуйте блок у стилі Mustache з ім’ям секції **`services`** і плейсхолдером **`{{name}}`**:

```markdown
{{#services}}
{{name}}
{{/services}}
```

Під час запуску CLI тіло між `{{#services}}` і `{{/services}}` повторюється для кожного `*.mdc` у `.cursor/rules/`; у `{{name}}` підставляється вже готовий markdown-рядок (наприклад `- .cursor/rules/n-text.mdc`).

3. Для секції **Skills** використовуйте блок **`{{#skills}}` … `{{/skills}}`** з тим самим `{{name}}`: рядки формуються з каталогів у `.cursor/skills/` (див. також `buildSkillBulletItems` у `bin/n-cursor.js`).

4. Для секції **Commands** використовуйте **`{{#commands}}` … `{{/commands}}`**: список генерується з кореневого **`package.json`** (поле `scripts` — відомі ключі у фіксованому порядку, плюс додаткові `lint-*`) та завжди доповнюється рядками про **`npx @nitra/cursor`** і **`npx @nitra/cursor check`**. Логіка винесена в **`npm/scripts/build-agents-commands.mjs`**.

5. Після змін у шаблоні перевірте локально: у тестовому репозиторії з `.n-cursor.json` виконайте `npx`/`bunx` на зібраному пакеті або `node npm/bin/n-cursor.js` з кореня того репозиторію і переконайтеся, що **`AGENTS.md`** виглядає як очікується.

### Логіка в коді CLI

- Шлях до шаблону: поруч із `rules/`, тобто `…/node_modules/@nitra/cursor/AGENTS.template.md` після встановлення пакету.
- Оновлення **`AGENTS.md`** виконується **після** циклу завантаження правил, щоб список відображав актуальний вміст `.cursor/rules/` на диску.
- Якщо каталогу `.cursor/rules/` немає або в ньому немає `*.mdc`, блок `{{#services}}` стає порожнім; решта шаблону все одно записується в **`AGENTS.md`**.
- Секція **`commands`** залежить лише від **`package.json` у корені cwd**; якщо файлу немає або `scripts` відсутній, у блоці лишаються мінімальні рядки (`bun i`, виклики CLI).

## Мета проекту

Консольна утиліта яка дозволить оновлювати в локальних GIT репозиторіях правила для cursor з можливістю наслідування правил від файлів в цьому репозиторії та забезпечення версійності правил для cursor.
