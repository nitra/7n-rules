---
docgen:
  source: npm/rules/rego/lint/lint.mjs
  crc: 1059537a
---

# lint.mjs — Лінт Rego-полісі (`opa` + `regal` + опційний `conftest`)

## Огляд

Модуль реалізує лінт-крок для Rego-полісі пакета `@nitra/cursor`, який живуть у каталозі
`npm/rules/<id>/policy/<concern>/`. Він послідовно запускає три інструменти й повертає код
виходу першого, що впав:

1. `opa check --strict` — компіляція Rego з типами та строгим режимом (ловить мертвий код,
   неоднозначні правила, незадекларовані змінні).
2. `regal lint` — статичний лінтер стилю/ідіоматичності Rego (v0-синтаксис, неявні set-rules,
   відхилення від `rego.v1`, плюс правила категорій bugs/idiomatic/performance — див.
   `https://docs.styra.com/regal`).
3. `conftest verify` — опційно: виконує `test_*` правила у `*_test.rego` (юніт-тести
   полісі). Якщо `conftest` відсутній у `PATH`, крок пропускається без помилки (з
   повідомленням, як його встановити).

Бінарники `opa` й `regal` резолвляться через `ensureTool` (`PATH` → локальний кеш → автоматичне
встановлення через `brew`/`scoop`/GitHub Release → hard-fail). `conftest` шукається лише в
`PATH` через `resolveCmd` без авто-install.

Канон патерну `lint-*` (серіалізація через `runStandardLint`, без прямого `withLock`) описаний
у `.cursor/rules/scripts.mdc`, секція «Серіалізація важких CLI-команд». Публічна CLI-форма
обгорнута в `withLock('lint-rego')` з дедуплікацією за станом git-дерева.

Файл одночасно є ESM-модулем (експортує функції) і CLI-точкою входу: якщо запущений напряму
(`isRunAsCli`), виконує `await runLintRego()` і виставляє `process.exitCode`.

## Експорти / API

Модуль експортує два символи:

| Експорт            | Тип                          | Призначення                                                                                                                                             |
| ------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runLintRegoSteps` | named function               | Внутрішня форма без локу: запускає три кроки в заданому `cwd`. Призначена для тестів у тимчасових каталогах, де потрібен fresh-прогон без дедуплікації. |
| `runLintRego`      | named const (arrow function) | Публічна CLI-форма: серіалізує виконання через `withLock('lint-rego')` + дедуп за станом git-дерева (через `runStandardLint`).                          |

Також модуль має side-effect при прямому запуску: якщо `isRunAsCli(import.meta.url)` повертає
`true`, виконується `await runLintRego()` із записом результату в `process.exitCode`.

## Функції

### `runStep(bin, args, cwd)`

Внутрішня (не експортована) допоміжна функція. Запускає процес із успадкованим `stdio`, щоб
вивід виглядав як прямий виклик у shell, і пре-логує команду користувачу.

- **Сигнатура:** `runStep(bin: string, args: string[], cwd: string) => number`
- **Параметри:**
  - `bin` — абсолютний шлях до бінарника (`opa`, `regal`, `conftest`).
  - `args` — масив аргументів командного рядка.
  - `cwd` — робочий каталог для дочірнього процесу.
- **Повертає:** код виходу (`0` — OK). Якщо `spawnSync` не зміг запустити бінарник
  (`result.error`), повертає `1`.
- **Side effects:**
  - Друкує рядок `▶ <bin> <args...>` у `stdout` (логування команди).
  - У випадку помилки запуску пише `❌ Не вдалося запустити <bin>: <message>\n` у `stderr`.
  - Породжує дочірній процес через `spawnSync` з `stdio: 'inherit'` і `env: process.env`
    (наслідування поточного середовища).

### `runLintRegoSteps(cwd?)`

Експортована функція, що виконує послідовність кроків лінту без локу.

- **Сигнатура:** `runLintRegoSteps(cwd?: string) => number`
- **Параметри:**
  - `cwd` — робочий каталог (за замовчуванням `process.cwd()`).
- **Повертає:** число — код виходу.
  - `0` — усі кроки OK або жодної цілі не знайдено (skip).
  - Ненульове — код виходу першого кроку, що впав (раннє повернення).
- **Алгоритм:**
  1. Резолвить `root = resolve(cwd)`.
  2. `opa = ensureTool('opa')` — гарантує наявність `opa` (інакше `ensureTool` hard-fail).
  3. `regal = ensureTool('regal')` — те саме для `regal`.
  4. Фільтрує `LINT_TARGETS` за наявністю на диску (через `existsSync`). Якщо порожньо —
     повертає `0` (skip).
  5. `runStep(opa, ['check', '--strict', ...targets], root)` — якщо `!== 0`, повертає цей код.
  6. `runStep(regal, ['lint', ...targets], root)` — якщо `!== 0`, повертає цей код.
  7. `conftest = resolveCmd('conftest')` — якщо `null`, друкує інформативне повідомлення про
     пропуск кроку й рекомендацію зі встановлення, повертає `0`.
  8. Інакше `runStep(conftest, ['verify', ...targets.flatMap(t => ['-p', t])], root)` —
     повертає його код виходу.
- **Side effects:** виконує `ensureTool` (може встановити бінарник або hard-fail), породжує
  дочірні процеси з успадкованим `stdio`, пише в `stdout`/`stderr`.

### `runLintRego()`

Експортована публічна CLI-форма (arrow-const).

- **Сигнатура:** `runLintRego() => Promise<number>`
- **Параметри:** немає.
- **Повертає:** `Promise<number>` — код виходу.
- **Поведінка:** делегує в `runStandardLint(import.meta.dirname, () => runLintRegoSteps())`.
  `runStandardLint` забезпечує:
  - Серіалізацію через `withLock('lint-rego')` (іменем серіалізатора виступає назва каталогу
    `lint`, отримана з `import.meta.dirname` — конвенція `runStandardLint`).
  - Дедуплікацію проти попереднього прогону за станом git-дерева.
- **Side effects:** через делегування — ті самі, що в `runLintRegoSteps`, плюс файлові
  side-effects лок-файлу й кешу станів від `runStandardLint`.

### CLI-вхід (на верхньому рівні модуля)

```js
if (isRunAsCli(import.meta.url)) {
  process.exitCode = await runLintRego()
}
```

- Виконується лише при прямому запуску модуля як скрипта (а не при імпорті).
- Очікує проміс `runLintRego()` і записує отриманий код у `process.exitCode` (не викликає
  `process.exit` явно, щоб лог-флаш не обрізався).

## Залежності

### Стандартна бібліотека Node.js

- `node:child_process` → `spawnSync` — синхронний запуск дочірніх процесів із `stdio: 'inherit'`.
- `node:fs` → `existsSync` — перевірка наявності каталогів-цілей.
- `node:path` → `resolve` — нормалізація абсолютних шляхів.

### Внутрішні модулі (відносні шляхи від `npm/rules/rego/lint/lint.mjs`)

- `../../../scripts/cli-entry.mjs` → `isRunAsCli` — детектор «запущений напряму як CLI».
- `../../../scripts/lib/ensure-tool.mjs` → `ensureTool` — резолв бінарників (`PATH` → кеш →
  авто-install brew/scoop/GitHub Release → hard-fail).
- `../../../scripts/utils/resolve-cmd.mjs` → `resolveCmd` — м'який пошук команди в `PATH`
  (повертає шлях або `null`, без авто-install і без hard-fail).
- `../../../scripts/lib/run-standard-lint.mjs` → `runStandardLint` — обгортка з локом і
  дедуплікацією для лінт-кроків.

### Зовнішні бінарники (системні)

- `opa` — обов'язковий, авто-install через `ensureTool` (Open Policy Agent CLI).
- `regal` — обов'язковий, авто-install через `ensureTool` (Styra Regal lint CLI).
- `conftest` — опційний, лише з `PATH` (без авто-install). За відсутності — `verify`
  пропускається.

### Константи модуля

- `LINT_TARGETS = ['npm/rules']` — список відносних шляхів-цілей, що передаються в усі три
  інструменти. Перед запуском фільтрується за `existsSync`.

## Потік виконання / Використання

### Як модуль (програмний імпорт)

```js
import { runLintRego, runLintRegoSteps } from './npm/rules/rego/lint/lint.mjs'

// CLI-форма (з локом і дедуплікацією) — рекомендована для оркестрації
const code = await runLintRego()

// Внутрішня форма (без локу) — для тестів у тимчасових каталогах
const codeFresh = runLintRegoSteps('/tmp/fixture-cwd')
```

### Як CLI (прямий запуск)

```sh
node npm/rules/rego/lint/lint.mjs
```

При прямому запуску модуль викликає `runLintRego()` і виставляє `process.exitCode` відповідно
до результату. Це дозволяє оркестратору лінту (наприклад, кореневому `bun run lint`)
підхопити цей файл як один із кроків і отримати правильний код виходу процесу.

### Логічний потік (один прогон `runLintRegoSteps`)

1. Резолв `cwd → root`.
2. `ensureTool('opa')` — повертає шлях до бінарника або hard-fail (з повідомленням
   `ensureTool`).
3. `ensureTool('regal')` — те саме.
4. Перевірка цілей: `LINT_TARGETS.filter(existsSync)`. Порожньо → `return 0` (skip).
5. `opa check --strict <targets...>` → `runStep`. `!== 0` → early-return з цим кодом.
6. `regal lint <targets...>` → `runStep`. `!== 0` → early-return з цим кодом.
7. `resolveCmd('conftest')`:
   - `null` → інформативний `console.log` із рекомендацією встановлення, `return 0`.
   - інакше → `conftest verify -p <t1> -p <t2> ...` через `runStep`; повертається його код.
8. Повернутий код піднімається до `runLintRego` → у `runStandardLint` → у `process.exitCode`
   (для CLI-режиму).

### Семантика помилок і пропусків

- **Усі цілі відсутні** → skip із кодом `0` (немає чого лінтити на ранніх стадіях/у мінімальних
  фікстурах).
- **`opa`/`regal` відсутні** → hard-fail усередині `ensureTool` (без авто-install або з
  невдалим авто-install).
- **`opa check` або `regal lint` повернули `!== 0`** → раннє повернення з цим кодом; наступні
  кроки не виконуються.
- **`conftest` відсутній у `PATH`** → лог-нотатка про пропуск, фінальний код `0` (вважається
  не помилкою — юніт-тести полісі опційні в локальному середовищі; у CI рекомендовано
  встановлювати `conftest`).
- **`spawnSync` не зміг запустити бінарник** (`result.error`) → лог `❌ Не вдалося запустити
...` у `stderr`, `runStep` повертає `1`.

### Контекст у проєкті

- Цілі лінту — каталог `npm/rules` пакета `@nitra/cursor`, де живуть Rego-полісі у
  `npm/rules/<id>/policy/<concern>/`. Усі три інструменти приймають один шлях і рекурсивно
  знаходять `.rego`, ігноруючи інші розширення (наприклад, `target.json` чи template-фіх).
- `opa` додатково потрібен VS Code-розширенню `tsandall.opa` (LSP, format-on-save через
  `opa fmt`) — деталі в `mdc/rego.mdc`.
- Канон патерну `lint-*` із серіалізацією через `runStandardLint` (а не прямий `withLock`) —
  див. `.cursor/rules/scripts.mdc`, секція «Серіалізація важких CLI-команд».
