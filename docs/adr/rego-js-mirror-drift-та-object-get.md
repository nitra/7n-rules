# Rego як дзеркало JS-авторитету: управління дрифтом і патерн object.get

**Status:** Accepted
**Date:** 2026-05-10

## Контекст

Після портування пер-документних K8s- і abie-перевірок у Rego-полісі виникло питання архітектурного статусу нових пакетів: чи є вони заміною JS-предикатів, чи їх дзеркалом? Під час роботи знайдено конкретний дрифт: `health_check_policy.rego` читав `spec.config.httpHealthCheck`, тоді як JS-авторитет читав `spec.default.config.httpHealthCheck`. Розбіжність жила непоміченою до порівняння тестових фікстур.

Окремо виявлено патерн-пастку в Rego v1: вираз `not is_object(input.spec)`, коли поле `spec` відсутнє в `input`, не виконується — є `undefined`, а не `false` — тому deny-правило не спрацьовує для документів без поля.

## Рішення/Процедура/Факт

### Архітектура: JS authoritative, Rego — швидкий gate

Прийнято **варіант A**: JS-функції у `check-*.mjs` лишаються авторитетом (source of truth для `npx @nitra/cursor check`); Rego-пакети є дзеркалом — швидкий IDE-gate та CI-перевірка одиничного маніфесту через `conftest`.

Розглянуті альтернативи:
- **Варіант B** (Rego authoritative, JS спавнить `conftest`): вимагає `conftest` як обов'язкову залежність, сповільнює `check` для великих kustomize-дерев (~50–100 ms/файл на спавн). Відкладено.
- **Варіант C** (тонкі JS-проксі через `opa eval`): аналогічно сповільнює і ускладнює unit-тестування. Відкладено.

Дрифт між JS і Rego мітигується **golden cross-check тестами** у `*.test.mjs`: одна фікстура прогоняється через JS-предикат і через `conftest test`, обидва вердикти мають збігатися. Виявлений дрифт у `health_check_policy.rego` виправлено (коректний шлях `spec.default.config.*`) і додано 10 тестів.

### Патерн object.get для відсутніх полів

У Rego v1 (rego.v1) з type-checking `is_object(undefined)` повертає `undefined`, а не `false`. Тому `not is_object(undefined)` — також `undefined`, а не `true`. Deny-правило, яке покладається на це, мовчки не спрацьовує.

**Обов'язковий патерн для перевірки відсутніх або некоректних полів:**

```rego
# Неправильно — silent fail, якщо поле відсутнє:
not is_object(input.spec)

# Правильно:
not is_object(object.get(input, "spec", null))
```

`object.get(obj, key, default)` перетворює відсутність ключа на явний `null`; `not is_object(null)` → `true`. Те саме стосується будь-якого вкладеного поля першого або глибших рівнів: `input.metadata`, `input.data`, `input.spec.rules`.

Виправлено у семи пакетах: `svc_yaml.rego`, `svc_hl_yaml.rego`, `base_manifest.rego`, `hasura_configmap.rego`, `hasura_httproute.rego`, `hpa_pdb.rego`, `kustomize_managed.rego`.

## Обґрунтування

Варіант A не вимагає `conftest` у PATH для основного `check`-шляху і зберігає продуктивність на великих деревах. Rego залишається корисним для IDE-фідбеку і ізольованого тестування одного маніфесту. Ризик дрифту прийнятний за наявності golden cross-check тестів.

`object.get` — стандартна OPA built-in, рекомендована `regal` для захисного доступу до полів. Не використовувати її означає silent fail без жодного lint-попередження — `opa check --strict` і `regal lint` не ловлять цей семантичний slip.

## Розглянуті альтернативи

- Варіанти B і C (Rego authoritative) — відкладено через залежності та продуктивність.
- Для `object.get`: `default x = null; x := input.spec` — синтаксично громіздко; `object.get` читається значно краще.
- Golden cross-check тести — прийнято як наступний крок для мітигації дрифту при варіанті A.

## Зачіпає

- `npm/policy/abie/health_check_policy/` — виправлений дрифт, 10 нових тестів.
- `npm/policy/k8s/svc_yaml/`, `svc_hl_yaml/`, `base_manifest/`, `hasura_configmap/`, `hasura_httproute/`, `hpa_pdb/`, `kustomize_managed/` — виправлений патерн `object.get`.
- Усі Rego-пакети у `npm/policy/` — будь-який пакет, що перевіряє відсутні поля через `not is_object(input.X)`, потребує аудиту.
- Архітектура `check-*.mjs` ↔ `npm/policy/` — рішення JS-authoritative + Rego-mirror зафіксовано як поточний стандарт.
