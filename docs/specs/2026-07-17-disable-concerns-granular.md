# Гранулярне вимикання concern-ів усередині rule

**Дата:** 2026-07-17
**Статус:** погоджено — готово до реалізації
**Зв'язані документи:** —

## 1. Проблема / Мета

Зараз `.n-rules.json` дозволяє вимикати перевірки лише на рівні цілого `rule id` (`disable-rules: ["k8s"]`) — це all-or-nothing. Немає способу вимкнути лише один внутрішній concern (напр. `k8s/network_policy`), залишивши інші concern-и того ж rule (`manifests`, `kubeconform` тощо) активними. Мотивуючий кейс: команда хоче ігнорувати конкретну rego-policy `network_policy` у `k8s`, не втрачаючи решту k8s-перевірок.

Обмеження: рішення має покривати і rego-policy-concern-и, і JS check-concern-и однаковим механізмом; не має ламати зворотну сумісність існуючих `.n-rules.json` з `disable-rules`.

## 2. Ухвалені рішення

| # | Питання | Рішення |
|---|---|---|
| А | Синтаксис позначення concern-у в конфізі | Суфіксна нотація в **існуючому** масиві `disable-rules`: елемент виду `"k8s/network_policy"` поруч зі звичайними id (`"docker"`). Без нового top-level ключа схеми, без порушення `additionalProperties: false` — масив рядків лишається масивом рядків, лише розширюється `pattern` для елементів (`^[a-z0-9-]+(/[a-z0-9_-]+)?$`). Розглядався варіант вкладеного об'єкта `disable-concerns: {"k8s": [...]}` (простіший для читання, гірший для сумісності) — відхилено на користь дешевшого рішення без нової гілки схеми. |
| Б | Де в рушії підключити фільтрацію | Новий фільтр-крок `filterByDisabledConcerns()` у `npm/scripts/lib/lint-surface/run-detectors.mjs`, поруч із наявним `filterByCapabilities()`. `isRuleEnabled()`-подібна функція (`npm/scripts/lib/read-n-rules-config-lite.mjs`) отримує аналог `isConcernEnabled(config, ruleId, concernId)`, що розрізняє елементи `disable-rules` за наявністю `/`. |
| В | Взаємодія з auto-sync (`auto-rules.mjs`) | Для rule з `"auto": "завжди"` (напр. `security`, `test`) auto-sync і надалі не повинен повертати назад **весь** rule id, якщо в `disable-rules` є лише частковий запис (`"k8s/network_policy"`) — сам rule id (`"k8s"`) залишається в `rules`, лише конкретний concern гаситься фільтром з Б. Якщо в майбутній версії `@7n/rules` у частково-вимкненому rule з'явиться **новий** concern — він активний за замовчуванням (opt-out, не opt-in), щоб не приховувати нові перевірки мовчки. |
| Г | Валідація помилкових id | Якщо вказаний concern id не існує в директорії rule (немає відповідної піддиректорії/`concern.json`) — CLI видає **гучну помилку** при sync/lint (не тихий no-op), з підказкою на схожі id за принципом "did you mean" (типова typo-стійкість). |
| Д | DX-команди мінімального рівня | `n-rules explain <ruleId>` — показує, які concern-и активні/вимкнені й чому (reason). Явно відкладено до backlog: TUI-конфігуратор, `--dry-run`, `migrate-disable`-скрипт — не входять у V1. |
| Е | Governance: reason/expires | Кожен частковий запис вимикання (`"k8s/network_policy"`) супроводжується **обов'язковим** полем `reason` в окремій метадобавці конфіга (див. деталі реалізації) та **опційним** `expires` (дата). `expires` **не** блокує CI автоматично — лише позначається як прострочений у `n-rules explain`/виводі lint (м'яке нагадування, без hard-fail). CODEOWNERS-review, security-audit-лог, severity-downgrade (`"off"`/`"warn"`) — свідомо відкладені в backlog: у команди поки один мотивуючий кейс (`k8s/network_policy`), і over-engineering audit-шару без підтвердженого другого кейсу визнано передчасним. |
| Ж | Monorepo/workspace cascade | Поза обсягом V1 — не досліджується й не вирішується зараз. Позначено як відкрите питання нижче, бо поточна поведінка `readConfig` при вкладених `.n-rules.json` per-workspace не перевірена. |

## 3. Деталі реалізації

### Схема (`npm/schemas/n-rules.json`)

- `disable-rules` (рядковий масив) розширюється: `pattern` елемента `^[a-z0-9-~][a-z0-9-._~]*(?:/[a-z0-9_-]+)?$` — дозволяє і простий rule id (`"docker"`), і `rule/concern` (`"k8s/network_policy"`).
- Новий опційний top-level об'єкт **лише** для метаданих часткових вимикань (reason/expires), що не бере участі в enable/disable-логіці напряму, а лише читається CLI для `explain`:
  ```json
  "disable-rules-meta": {
    "k8s/network_policy": {
      "reason": "legacy-кластер без NetworkPolicy CRD",
      "expires": "2026-10-01"
    }
  }
  ```
  Валідація: якщо ключ у `disable-rules-meta` не має відповідного запису в `disable-rules` — schema/CLI помилка (неузгодженість). Якщо запис у `disable-rules` має формат `rule/concern`, а відповідного ключа в `disable-rules-meta.reason` немає — CLI відмовляє записати/синхронізувати конфіг (reason обов'язковий тільки для часткових, не для повних rule-level записів).

### Engine (`npm/scripts/lib/`)

1. `read-n-rules-config-lite.mjs`: додати `isConcernEnabled(config, ruleId, concernId)` — читає `disableRules`, шукає або точний `"rule/concern"`, або весь `"rule"` (обидва вимикають).
2. `lint-surface/run-detectors.mjs`: після `filterByCapabilities()` додати `filterByDisabledConcerns()` — використовує `isConcernEnabled` для кожного детектора, прив'язаного до конкретного concern-каталогу.
3. `auto-rules.mjs`: `detectAutoRules`/`addRule` — без змін логіки самого гейту (concern-рівень фільтрується вже після, у run-detectors), але потрібно перевірити тест на edge case В (новий concern у "always"-rule з частковим disable — має лишитись увімкненим).

### CLI (`npm/bin/n-rules.js`)

- `n-rules explain <ruleId>` — новий підкоманда, виводить список concern-ів rule зі статусом (active/disabled), і якщо disabled — `reason` + `expires` (з поміткою "прострочено", якщо дата минула) з `disable-rules-meta`.
- Помилка при sync, якщо `disable-rules` містить `rule/concern` без відповідного `reason` у `disable-rules-meta`, або якщо concern id не існує в дереві правил (typo-guard, edge case Г).

### Тести

- Smoke-тест: rule з усіма concern-ами вимкненими частково не падає з crash (no-op з попередженням, не помилка).
- Тест на edge case В: новий concern, доданий у майбутній версії пакета, лишається enabled, навіть якщо інші concern-и того ж rule вимкнені.
- Тест валідації Г: невідомий concern id → явна помилка з "did you mean".
- Тест валідації Е: `rule/concern` без `reason` у `disable-rules-meta` → явна помилка sync.

## Відкриті питання

- Monorepo cascade (кластер Ж): чи `readConfig` коректно читає/мержить `.n-rules.json` кореня і підпакета для часткових concern-записів — не досліджено, окрема задача перед тим, як фіча буде використана в multi-package workspace.
- Чи потрібен окремий CI-плагін `@7n/rules-ci-github` хук для `disable-rules-meta.expires` (нагадування в PR) — залишено як можливий backlog-пункт, не частина V1.
