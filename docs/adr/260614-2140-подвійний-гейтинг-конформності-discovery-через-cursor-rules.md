---
session: 31bcf47f-efb3-4015-bd75-1a07def77614
captured: 2026-06-14T21:40:18+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/31bcf47f-efb3-4015-bd75-1a07def77614.jsonl
---

Тепер маю повну картину. Ось чому так зроблено, де це раціонально, а де — варте зміни.

---

## Чому discovery з `.cursor/rules/*.mdc`, а не прямий список з конфігу

Є дві різні *ролі* у системі:

### 1. Конформність-фаза у `lint` (відповідь на твоє питання)

Конформність робить discovery через `.mdc` **тому що** `fix.mjs` кожного правила **вже є самостійним оркестратором** — він сам викликає `runRuleCli`, який сам читає `.n-cursor.json` і перевіряє `isRuleEnabled`. Тобто коли `run-fix-check.mjs` запускає `rules/<id>/fix.mjs`, той і так свій конфіг читає і зупиниться якщо вимкнений.

Тоді навіщо `.mdc`? — discovery вирішує, **кого взагалі запускати**: без `.mdc`-файлу `discovery` не знає про існування правила у *цьому* проєкті (vs усі правила пакета). Ідея: не кожен проєкт використовує всі правила, і `sync` є контрактом «ці правила ми підписуємось» → генерує `.mdc`.

**Архітектурна проблема**: це **подвійний гейтинг** — `sync` → `.mdc`-на-диску → discovery → `fix.mjs` → конфіг → `isRuleEnabled`. Два рівні, де перший (`.mdc`) непрозорий і може дрейфувати.

### 2. Прямий шлях через оркестратор уже є

`runRuleCli` у `fix.mjs` вже є тим «викликаємо оркестратор правила» — і для `npx @nitra/cursor fix abie` він спрацьовує правильно, з конфіг-гейтом. Проблема в тому, що конформність-фаза `lint` приходить до цих оркестраторів через `.mdc`-discovery, а не через конфіг напряму.

---

## Що варто змінити

**Мінімальний фікс (discovery через конфіг):**

```js
// у resolveCheckRuleIds:
const cfg = await readNCursorConfigLite(cwd)
const allAvailable = getAvailableRulesWithCheck(packageDir)  // правила пакета з fix.mjs

// замість discovery з .mdc:
return allAvailable.filter(id => isRuleEnabled(cfg, id))
```

Тоді `.cursor/rules/*.mdc` стають лише cursor/AI-контекстом (для чого вони й призначені), а `lint --full` читає авторитетне джерело — `.n-cursor.json`.

**Один виняток де `.mdc` варто лишити**: якщо `.n-cursor.json` відсутній (open-by-default режим) — тоді `.mdc`-discovery як fallback ще раціональний, щоб не запускати всі 15+ правил.

---

## Підсумок

| Питання | Відповідь |
|---|---|
| Чому `.mdc`? | Спадщина: `.mdc` = «підписані» правила проєкту; конфіг-гейт дублюється в самому `fix.mjs` |
| Чи є прямий оркестратор? | Так — `runRuleCli` у кожному `fix.mjs`; він і читає конфіг |
| Чи раціонально? | Частково: архітектурно `.mdc`-discovery — зайве проксі; конфіг є |
| Що міняти? | `resolveCheckRuleIds` повинен читати `.n-cursor.json`, не диск |

Хочеш — зроблю цей рефактор?

---

*Transcript ends here.*

Output the ADR(s) now.

## ADR Подвійний гейтинг конформності: discovery через `.cursor/rules/*.mdc` vs `.n-cursor.json`

## Context and Problem Statement
Конформність-фаза `npx @nitra/cursor lint --full` визначає, які правила запускати, через discovery файлів `.cursor/rules/*.mdc` на диску, а не через прямий перелік `rules` з `.n-cursor.json`. Це призводить до ситуації, коли `.n-cursor.json` і `.cursor/rules/` можуть дрейфувати, і `lint` мовчки запускає застарілі або зайві правила — або ж не запускає потрібні.

## Considered Options
* Discovery конформності через `.cursor/rules/*.mdc` (поточна реалізація)
* Discovery конформності напряму через `.n-cursor.json` + `isRuleEnabled`
* Збереження `.mdc`-discovery лише як fallback при відсутньому `.n-cursor.json`

## Decision Outcome
Chosen option: "Discovery конформності напряму через `.n-cursor.json` + `isRuleEnabled`", because аналіз у transcript показав, що `.n-cursor.json` вже є авторитетним джерелом, `fix.mjs` кожного правила сам читає конфіг через `runRuleCli` / `isRuleEnabled`, а `.mdc`-проксі додає зайвий рівень indirection, що дозволяє дрейф між конфігом і диском.

### Consequences
* Good, because `lint --full` читатиме авторитетне джерело (`resolveCheckRuleIds` → `readNCursorConfigLite` → `isRuleEnabled`) і не залежатиме від того, чи `sync` був запущений і чи `.cursor/rules/` синхронний.
* Bad, because transcript не містить підтверджених негативних наслідків; можлива edge-case: якщо `.n-cursor.json` відсутній і open-by-default — може запустити усі доступні правила замість обмеженого `.mdc`-fallback.

## More Information
- `npm/scripts/lib/discover-check-rules-from-cursor.mjs` — поточна discovery логіка (`.mdc` на диску → перетин із `available`)
- `npm/scripts/lib/read-n-cursor-config-lite.mjs` — `readNCursorConfigLite`, `isRuleEnabled`
- `npm/scripts/lib/fix/run-fix-check.mjs` — `resolveCheckRuleIds`, де треба замінити `.mdc`-discovery на конфіг-фільтрацію
- `npm/scripts/lib/run-rule-cli.mjs` — `runRuleCli` (кожен `fix.mjs` вже читає конфіг самостійно)
- Пропозиція з transcript: `allAvailable.filter(id => isRuleEnabled(cfg, id))` у `resolveCheckRuleIds`, із `.mdc`-discovery як fallback при відсутньому `.n-cursor.json`

---

## ADR Класифікація `security` як `lint: per-file` при full-repo scan

## Context and Problem Statement
`npm/rules/security/meta.json` класифікує правило `security` як `lint: "per-file"`, що семантично означає «лінтує лише дельту змінених файлів». Але реалізація `npm/rules/security/js/lint.mjs` ігнорує параметр `_files` і завжди запускає `trufflehog filesystem .` по всьому репо. Через це при звичайному `npx @nitra/cursor lint` (без `--full`) запускається повний сканер секретів, що суперечить ментальній моделі delta-lint.

## Considered Options
* Рекласифікувати `security` у `lint: "full"` (лінтується лише при `--full`/`lint-ci`)
* Реалізувати справжній per-file scope: передавати змінені шляхи в trufflehog замість `.`

## Decision Outcome
Chosen option: "Рекласифікувати `security` у `lint: \"full\"`", because це мінімальна зміна, що прибирає невідповідність між метаданими та реалізацією; аналіз у transcript показав, що справжній per-file trufflehog потребує перевірки підтримки списку файлів як аргументів.

### Consequences
* Good, because `meta.json` відповідатиме реальній поведінці; дельта-`lint` не запускатиме slow full-repo scan несподівано.
* Bad, because секрети у дельті не перевірятимуться при звичайному `lint` — лише при `--full` або `lint-ci`.

## More Information
- `npm/rules/security/meta.json` — поле `"lint": "per-file"` потребує зміни на `"full"`
- `npm/rules/security/js/lint.mjs` — функція `lint(_files, cwd)` ігнорує `_files`, викликає `trufflehog filesystem .`
- `npm/rules/lint/js/orchestrate.mjs` — `selectLintRules` читає `meta.json` для визначення scope
- Альтернатива 2b з transcript: `spawnSync('trufflehog', ['filesystem', ...paths, ...])` для справжнього per-file scan
