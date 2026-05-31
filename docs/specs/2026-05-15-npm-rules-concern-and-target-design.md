# Дизайн: concern-based JS + per-policy `target.json`

**Дата:** 2026-05-15
**Статус:** В реалізації (інфраструктура частково створена, пілот на `rego` ще не виконаний)
**Передумова:** `2026-05-14-npm-rules-restructure-design.md` (фази 1-4 завершені — `npm/rules/<id>/{<id>.mdc, js/check.mjs, policy/<name>/*.rego}` вже існує)

---

## 1. Контекст

Після фаз 1-4 кожне правило живе у `npm/rules/<id>/` з трьома гілками:

- `<id>.mdc` — людинозрозумілий текст для агента
- `js/check.mjs` — імперативна перевірка (один файл)
- `policy/<name>/<name>.rego` — декларативні полісі

Дві проблеми поточної форми:

1. **Один `check.mjs` на правило** змушує тримати все в одному файлі (`abie/js/check.mjs` — 1153 рядки, ~7 концернів). Розпил на функції є, але рівня модульності — нема. Тести співрозташовуються з джерелом, але теж в одному `check.test.mjs`.
2. **Targeting rego-полісі живе в двох місцях:** усередині `js/check.mjs` (виклики `runConftestBatch({ files })`) і централізовано в `npm/scripts/lint-conftest.mjs:TARGETS` (статичні `single`/`walk` записи). Дублювання + неможливо мати pure-rego правило без `js/check.mjs`-обгортки (CLI у `discoverCheckScripts` фільтрує по наявності `js/check.mjs`).

---

## 2. Ціль

- **Concern-based JS:** `rules/<id>/js/<concern>/check*.mjs` дзеркалить `rules/<id>/policy/<name>/`. Одне ім'я `<name>` = одна одиниця відповідальності, реалізована декларативно (rego), імперативно (JS) або обома способами (hybrid).
- **Декларативний targeting:** `rules/<id>/policy/<name>/target.json` поряд із `<name>.rego` описує, які файли фідити в conftest. CLI читає його сам і викликає `runConftestBatch` — JS більше не дублює виклик.
- **Pure-rego правила можливі:** правило з самим `policy/` і без `js/` працює; CLI знаходить його через наявність `target.json`-файлів.
- **Pure-JS правила можливі:** правило з самим `js/<concern>/check.mjs` і без `policy/` працює.
- **Hybrid концерн природний:** однакове ім'я `<name>` в `js/<name>/` і `policy/<name>/` — JS обчислює список файлів і викликає rego (через свій же `runConftestBatch` або через `applies()`-гейт перед CLI-прогоном).

---

## 3. Нова структура директорії правила

```
npm/rules/<id>/
├── <id>.mdc                              ← без змін
├── auto.md                               ← без змін (опційно)
├── js/                                   ← імперативна частина (опційно)
│   └── <concern>/
│       ├── check.mjs                     ← запускається CLI; export check(), опц. applies()
│       ├── check-<sub>.mjs               ← (опц.) додаткові check у тому ж концерні
│       └── *.test.mjs                    ← пропускається discovery
├── utils/                                ← shared у межах правила (опц.)
│   ├── <helper>.mjs
│   └── *.test.mjs
└── policy/                               ← декларативна частина (опційно)
    └── <name>/
        ├── <name>.rego
        ├── <name>_test.rego
        └── target.json                   ← маніфест таргета (новий)
```

Два рівні `utils/`:

- **`npm/scripts/utils/`** — глобально-shared, без змін (`check-reporter`, `walkDir`, `load-cursor-config`, `run-conftest-batch`, `resolve-cmd`, …).
- **`npm/rules/<id>/utils/`** — shared у межах одного правила. CLI не дивиться сюди; звичайний relative-імпорт зсередини `js/<concern>/check.mjs`.

Discovery бере:

- `js/<concern>/check.mjs` або `js/<concern>/check-<sub>.mjs` (regex `^check(?:-.+)?\.mjs$`)
- `policy/<name>/` з наявним `target.json`

Підкаталог `utils/` всередині `js/` пропускається явно (`s.name === 'utils'`).

`*.test.mjs` пропускається через regex (не починається з `check`).

---

## 4. Контракт `target.json`

JSON Schema: `npm/schemas/target.json` (вже створено).

### Форми

```json
{ "files": { "single": "package.json", "required": true } }
```

```json
{ "files": { "walkGlob": "**/k8s/**/*.{yaml,yml}", "required": false } }
```

```json
{ "files": { "walkGlob": ["**/*.yaml", "**/*.yml"] } }
```

### Семантика

| Поле                        | Значення                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `files.single`              | конкретний відносний posix-шлях; `..` і абсолютні заборонені                        |
| `files.walkGlob`            | picomatch-glob або масив; matched проти rel posix                                   |
| `files.required` (single)   | `true` → fail з `missingMessage` при відсутності; `false`/`undefined` → silent skip |
| `files.required` (walkGlob) | **ігнорується** (для conditional «має бути файл» — використовуй JS `applies()`)     |
| `missingMessage`            | override дефолту `<path> не існує (<id>.<name>)`                                    |
| `conftest.combine`          | передається у `runConftestBatch.extraArgs` як `--combine`                           |

### Namespace

Обчислюється: `<id>.<concern>`, де `<id>` = ім'я каталогу правила, `<concern>` = ім'я підкаталогу в `policy/`. Імʼя rego-пакета має збігатись (regal: `directory-package-mismatch`).

---

## 5. Контракт `js/<concern>/check.mjs`

```js
export async function check() {
  // повертає 0 / 1; reporter.fail/pass через createCheckReporter
}

// (опційно) лише в одному концерні правила, конвенційно іменованому `applies/`
export async function applies() {
  // return true → правило застосовне; false → CLI пропускає ВСІ концерни цього правила
}
```

Якщо `rules/<id>/js/applies/check.mjs` експортує `applies()`, CLI викликає її ПЕРЕД будь-якими іншими діями для правила. Це rule-level gate — заміна inline-чеків типу `isAbieRuleEnabled` чи `projectHasRegoFiles`. Якщо `applies()` повертає false, CLI друкує pass-повідомлення «правило не застосовне» і не запускає ні JS, ні policy цього правила.

Порядок прогону в межах правила:

1. `applies()` (якщо є) → false → skip rule.
2. Усі `policy/<name>/` через `runConftestBatch` (за target.json), порядок: алфавіт по `<name>`.
3. Усі `js/<concern>/check*.mjs`, порядок: алфавіт по `<concern>`, всередині — алфавіт файлу.

Hybrid concern (`<name>` у `policy/` І в `js/`): CLI спочатку викликає полісі (через target.json), потім JS. JS може робити додаткові обчислювані батчі через `runConftestBatch` напряму.

---

## 6. Нові модулі CLI

| Файл                                             | Призначення                                                                | Статус      |
| ------------------------------------------------ | -------------------------------------------------------------------------- | ----------- |
| `npm/schemas/target.json`                        | JSON Schema                                                                | ✅ створено |
| `npm/scripts/utils/resolve-target-files.mjs`     | `single`/`walkGlob` → список абсолютних шляхів; walk-cache                 | ⏳          |
| `npm/scripts/utils/discover-checkable-rules.mjs` | discovery rules з нової структури + legacy `js/check.mjs` під час міграції | ⏳          |
| `npm/scripts/utils/run-rule.mjs`                 | orchestrator: applies → policies → js checks                               | ⏳          |

Залежність: `picomatch@^4.0.4` (✅ додано в `npm/package.json`).

Walk-cache: `Map<ignorePathsKey, Promise<string[]>>` створюється у `runChecks` (один прогон → один кеш), передається у `resolveTargetFiles` як аргумент.

---

## 7. Зміни в `bin/n-cursor.js`

`runChecks(requestedRules)` (рядок 1055):

1. `discoverCheckableRules()` замість `discoverCheckScripts()` → повертає `[{ id, jsConcerns, policyConcerns }]`.
2. `discoverCheckRulesFromAgentsMd(available.map(r => r.id))` — без змін у логіці, тільки тип `available`.
3. Цикл `for (const rule of rulesToCheck)` викликає `runRule(rule, reporter, walkCache)` з нового модуля.

Backward compat: discovery підтримує **обидві** структури:

- Legacy: `js/check.mjs` напряму → концерн з ім'ям `legacy` або просто `check`.
- Нова: `js/<concern>/check*.mjs`.

Legacy-гілка прибирається після того, як останнє правило мігроване.

---

## 8. Міграція

Інкрементально по одному правилу. Атомарність — per-rule.

Порядок:

1. **Інфраструктура:** picomatch + schema + 3 нові утиліти + патч `runChecks`. Тести.
2. **Пілот: `rules/rego/`.** Найпростіше:
   - Додати `policy/{package_json, vscode_extensions, vscode_settings}/target.json` × 3 (single).
   - Створити `js/applies/check.mjs` з `applies()` (projectHasRegoFiles) і коротким `check()`.
   - Видалити `js/check.mjs`.
3. **Прості правила** (по одному концерну): `bun`, `text`, `style-lint`, `php`, `docker`, `npm-module`, `js-lint`, `image-compress`, `image-avif`, `capacitor`, `hasura`, `adr`.
4. **Walk-таргети:** `js-mssql`, `js-bun-db`, `js-bun-redis`, `js-run`, `vue`, далі `k8s.*`.
5. **`abie` останнім:** розпил на ~5-6 концернів + винесення `utils/k8s-tree.mjs` (cached `findK8sYamlFiles`, `collectDeploymentDirs`).
6. **Прибрати `TARGETS` з `lint-conftest.mjs`** — переписати на читання `rules/*/policy/*/target.json`.
7. **Прибрати legacy-гілку discovery** з `bin/n-cursor.js`.

Після кожного правила:

- `npx @nitra/cursor check <id>` локально.
- `bun test` у `npm/`.
- Bump `npm/package.json:version` (одноразово на PR) + запис у `npm/CHANGELOG.md`.

---

## 9. Прийняті рішення (з обговорення)

- **`target.json` per-policy**, не `rule.json` на правило (locality > centralization).
- **Picomatch** як glob-парсер (1 dep, найпопулярніший, RegExp-compiled).
- **`applies()` в JS-частині**, не окремий `rule.json:applies` (inline у JS прийнятно).
- **Імперативне `utils/`** як на рівні правила, так і на рівні пакета.
- **Симетрія `js/<name>/` ↔ `policy/<name>/`** — одне ім'я `<name>` як спільний concern-словник.
- **Алфавітний порядок прогону** — без штучних `01-`, `02-`. Зміна порядку проти поточного — OK.
- **Спільний стан між концернами** — module-level cache в `utils/` (першии виклик платить за обхід, решта отримують готове).

---

## 10. Що **не** змінюється

- Інваріант фази 1-4: одна директорія = одне правило.
- `<id>.mdc`, `auto.md` — без змін у форматі.
- Публічне API CLI (`npx @nitra/cursor check`, `lint-ga`, `lint-rego`) — без змін.
- `npm/scripts/utils/` як глобально-shared.
- Конвенція kebab-case для `<id>`, snake/kebab для `<concern>` (дозволяється і snake — узгоджується з rego-пакетами, які вже snake).
- `bun test` без аргументів — тести співрозташовані, без перенаправлень.

---

## 11. Стан реалізації (поточний)

| Крок                                                    | Статус |
| ------------------------------------------------------- | ------ |
| `bun add picomatch`                                     | ✅     |
| `npm/schemas/target.json`                               | ✅     |
| `npm/scripts/utils/resolve-target-files.mjs` + тест     | ⏳     |
| `npm/scripts/utils/discover-checkable-rules.mjs` + тест | ⏳     |
| `npm/scripts/utils/run-rule.mjs` + тест                 | ⏳     |
| Патч `bin/n-cursor.js` `runChecks`                      | ⏳     |
| Міграція `rules/rego/`                                  | ⏳     |
| Верифікація (`check rego` + `bun test`)                 | ⏳     |
| Version bump + CHANGELOG                                | ⏳     |

---

## 12. Прийняті рішення з обговорення дрібниць

- **Legacy-fallback для не мігрованих правил:** без іменування концерну. Discovery бачить `js/check.mjs` напряму (без `<concern>`-підкаталогу) і повертає поле `jsLegacyCheck: 'check.mjs'` окремо від `jsConcerns`. Runner викликає його окремою гілкою. Після міграції останнього правила гілка прибирається разом із полем.
- **`required: true` для walkGlob** — лишається забороненим у schema. Conditional-перевірки «має бути файл за патерном» — через JS `applies()`, не targeting.
- **`conftest.combine`** — прибрано зі schema (YAGNI). Додамо, коли з'явиться перший реальний кейс.
- **ADR** — створено: `docs/adr/20260515-123025-concern-target-design.md` із посиланням на цю спеку.
