# Vue: машинна заборона `vitest` і `jsdom` через Rego-policy

**Status:** Accepted
**Date:** 2026-05-21

## Context and Problem Statement

Правило `vue.mdc` забороняло `vitest` і `jsdom` лише на рівні тексту — `npx @nitra/cursor check` не ловив ці порушення, тому `n-fix` їх не бачив. Rego-policy `package_json.rego` для Vue-пакетів не мала жодного `deny`-блоку для цих пакетів.

## Considered Options

- Додати `deny`-блоки до `npm/rules/vue/policy/package_json/package_json.rego`
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати `deny`-блоки до `package_json.rego`", because саме цей файл є точкою, де перевіряються залежності Vue-пакетів; `check.mjs` явно делегує перевірку залежностей у rego.

Нові блоки:
- `deny` для `vitest` в `all_dependency_names` (dependencies + devDependencies) з повідомленням «замінити на `bun test`»
- `deny` для `jsdom` в `all_dependency_names` з повідомленням «замінити на `happy-dom`»
- Обидва блоки під guard `uses_vue`

`happy-dom` навмисно **не** зроблено обов'язковою залежністю — policy по `package.json` не може визначити, чи є в пакеті component/DOM-тести.

### Consequences

- Good, because `npx @nitra/cursor check` на Vue-пакеті з `vitest` або `jsdom` у deps тепер дає deny, що робить порушення видимим для `n-fix`.
- Good, because guard `uses_vue` гарантує, що не-Vue пакети не зачіпаються.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Змінені файли: `npm/rules/vue/policy/package_json/package_json.rego`, `npm/rules/vue/policy/package_json/package_json_test.rego`.

Перевірки з transcript:
- `opa test npm/rules/vue/policy/package_json -v` — всі тести пройшли, включно з `test_non_vue_package_ignores_vitest_and_jsdom`.
- `regal lint npm/rules/vue/policy/package_json` — без зауважень.
- Ручна перевірка: `conftest test pkg-bad.json` → 2 deny (`vitest`, `jsdom`); `pkg-ok.json` → 0 deny.

Конвенція: `import rego.v1`, multi-value `deny contains msg if { … }`, package-шлях відповідає каталогу.

## Update 2026-05-21

Підтвердження машинної перевірки після додавання `deny`-блоків до `npm/rules/vue/policy/package_json/package_json.rego`: `opa test npm/rules/vue/policy/package_json -v` — 6/6 PASS; `regal lint npm/rules/vue/policy/package_json` — 0 violations; `conftest test path/to/package.json -p npm/rules/vue/policy -n vue.package_json` підтвердив deny для `vitest` і `jsdom` та 0 deny без них. Змінені файли: `npm/rules/vue/policy/package_json/package_json.rego`, `npm/rules/vue/policy/package_json/package_json_test.rego`.

На запит «дозволити jsdom для DOM-тестів» ухвалено рішення «лишити повну заборону»: Rego по `package.json` не може визначити наявність DOM-тестів, тому `jsdom` deny залишається беззастережним. `happy-dom` обов'язковим не зроблено з тієї ж причини.
