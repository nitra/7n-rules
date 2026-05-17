# Template Directory для правил `npm/rules/<id>/`

**Дата:** 2026-05-17  
**Статус:** ЗАТВЕРДЖЕНО

---

## Проблема

Правила в `npm/rules/<id>/` поєднують у `.mdc` файлі дві логічно різні речі:
1. **AI-директиви** — що і як генерувати/редагувати.
2. **Scaffold-шаблони / фрагменти** — inline code blocks із вмістом цільових файлів.

Ці inline-блоки дублюються у `check.mjs` / `.rego` як hardcoded рядки/регекспи, що означає: зміна шаблону потребує синхронного оновлення `.mdc` + `check.mjs` + `.rego`. Немає єдиного джерела правди.

---

## Рішення

Ввести каталог `template/` на рівні концерну (`fix/<concern>/template/` або `policy/<concern>/template/`) з двома типами файлів:

### Сценарій A — Scaffold (повний файл)

Повний файл-шаблон у нативному форматі. Використовується `check.mjs` коли цільовий файл відсутній — пропонується AI як початкова точка.

```
fix/gitleaks/template/.gitleaks.toml
fix/gitleaks/template/lint-security.yml   (workflow)
```

### Сценарій B — Merge-check (`check.json`)

Файл `check.json` на рівні концерну (поряд з `check.mjs`/`target.json`) описує структурні assertions проти реального файлу.

```json
{
  "required": { "scripts": { "lint-security": "gitleaks detect --no-banner" } },
  "forbidden": { "dependencies": { "gitleaks": true } },
  "contains":  { "scripts": { "lint": ["bun run lint-security"] } }
}
```

Семантика полів:
- `required` — кожна leaf-пара `key: value` має бути в реальному файлі з точним значенням; масиви — subset-of.
- `forbidden` — будь-який ключ цього дерева в реальному файлі = fail (значення = опис помилки).
- `contains` — рядкове поле реального файлу має містити кожен рядок масиву як substring.

---

## Layout

```
npm/rules/<id>/
├── <id>.mdc
├── fix/<concern>/
│   ├── check.mjs
│   ├── check.test.mjs
│   ├── check.json          ← merge-assertions (НОВИЙ)
│   └── template/           ← scaffold-шаблони (НОВИЙ)
│       └── .gitleaks.toml
└── policy/<concern>/
    ├── <concern>.rego
    ├── <concern>_test.rego
    ├── target.json
    ├── check.json          ← merge-assertions (НОВИЙ)
    └── template/           ← scaffold-шаблони (НОВИЙ)
        └── lint-security.yml
```

**Де живе canonical `check.json` при наявності обох `fix/` і `policy/`?**  
Canonical — у `policy/<concern>/`, бо Rego є primary validator. `check.mjs` читає relative: `../../policy/<concern>/check.json`.  
Якщо концерн тільки в `fix/` (без Rego) — `check.json` у `fix/<concern>/`.

**Glob цілі** (`walkGlob: "**/package.json"`): `check.json` описує assertions, що застосовуються до **кожного** матчу glob однаково. Template-файл у `template/` — теж один на концерн.

**Non-JSON цільові формати** (`.toml`, `.yaml`): цільовий файл парситься в JS-object (за extension). `check.json` містить assertions у JSON. Scalar-порівняння — рядки, числа, булеві.

---

## Іменування

| Файл | Призначення |
|---|---|
| `fix/<concern>/check.mjs` | JS-логіка перевірки (існуюче) |
| `fix/<concern>/check.json` | Merge-assertions (новий) |
| `policy/<concern>/target.json` | Glob/single targeting (існуюче) |
| `policy/<concern>/check.json` | Merge-assertions (новий) |
| `fix/<concern>/template/<file>` | Scaffold у нативному форматі (новий) |
| `policy/<concern>/template/<file>` | Scaffold у нативному форматі (новий) |

Суфікси на файлах всередині `template/` відсутні — файли мають точні назви цільових файлів репо.

---

## MDC-контракт

`.mdc` файл правила **зобов'язаний** містити markdown-посилання на кожен файл у всіх `template/` каталогах правила:

```markdown
Scaffold-шаблони:
- [.gitleaks.toml](./fix/gitleaks/template/.gitleaks.toml)
- [lint-security.yml](./policy/workflow/template/lint-security.yml)
```

`check.mjs` нового концерну `fix/mdc_sync/` (або додатковий крок у існуючому runner-і) перевіряє:
- Усі файли в `template/` каталогах правила перелічені у `.mdc`.
- Fail, якщо новий файл у `template/` не має відповідного посилання в `.mdc`.

**Cursor** побачить посилання та зможе прочитати файл (якщо має інструмент читання). **Claude Code** прочитає файл через Read tool при явному зверненні до шляху. Inline code block у `.mdc` — лише для невеликих фрагментів без відповідного template-файлу.

---

## Нові утиліти

### `npm/scripts/utils/template.mjs`

```js
/**
 * Reads template/ and check.json for a concern directory.
 * concernDir: absolute path to fix/<concern>/ or policy/<concern>/
 */
export async function loadTemplate(concernDir)
// returns: { scaffold: Map<filename, string>, check: { required, forbidden, contains } | null }

export function checkRequired(actual, required)   // deep subset-of, returns violations[]
export function checkForbidden(actual, forbidden)  // path-presence → violations[]
export function checkContains(actual, contains)    // substring check → violations[]
```

### `npm/scripts/utils/run-conftest-batch.mjs` (доповнення)

Реалізувати існуючий placeholder `opts.templateDir`:
- Читає `check.json` з `opts.templateDir`
- Серіалізує у tmp JSON: `{ "template": { "required": ..., "forbidden": ..., "contains": ... } }`
- Передає `conftest --data-file <tmp.json>` (cleanup після exit)
- Rego звертається: `data.template.required.scripts["lint-security"]`

---

## Rego data path (конвенція)

```rego
package security.package_json

required := data.template.required         # ← з check.json через --data-file
deny[msg] { not input.scripts["lint-security"] == required.scripts["lint-security"]; msg := "..." }
```

Namespace у `--data-file` — flat `{ "template": {...} }`, єдиний на conftest-виклик (один концерн = один виклик).

---

## Нова перевірка: `fix/mdc_sync/`

Новий концерн (або кроки у існуючому перевірнику) у кожному правилі:
- `target.json`: `{ "files": { "single": "<id>.mdc" } }`
- `check.mjs`: зчитує всі `template/*` файли правила, перевіряє наявність відповідних `](<path>)` посилань у `.mdc`.
- Fail: "template/<file> не вказаний у <id>.mdc".

---

## Scope змін

**26 правил** мають `fix/` або `policy/`. У кожному:
1. Створити `template/` у відповідному концерні з scaffold-файлами.
2. Написати `check.json` з assertions.
3. Замінити inline code blocks у `.mdc` на markdown-посилання.
4. Оновити `check.mjs` — читати з `check.json` замість hardcode.
5. Оновити `.rego` — використовувати `data.template.required` замість literals.

**Нові утиліти:**
- `npm/scripts/utils/template.mjs`
- `fix/mdc_sync/check.mjs` (per-rule, або централізований)

**Оновлені утиліти:**
- `npm/scripts/utils/run-conftest-batch.mjs` — реалізувати `opts.templateDir`

---

## Зворотна сумісність

- Існуючі `check.mjs` без `check.json` / `template/` продовжують працювати — runner перевіряє наявність перед використанням.
- Міграція — поступова per-концерн, незалежно від черги.
- `npm` пакет версіонується — оновлення runner-а перед міграцією правил.

---

## Альтернативи, що відхилені

| Альтернатива | Причина відхилення |
|---|---|
| Rule-level `template/` (один на правило) | Collision: k8s має 4+ концерни на `*.yaml`, npm-module — 2 на `package.json` |
| DSL-файл `expectations.yaml` | Новий синтаксис, не схожий на цільовий файл; складний для AI |
| Snippet-only (без deny/contains) | Contains-перевірки (`lint` містить `bun run lint-security`) не покриваються |
| `@path` references у `.mdc` | Claude Code не підтримує автоматичне розгортання `@path` всередині `.mdc` |
