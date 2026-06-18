---
type: ADR
title: "Rule-Centric Структура Директорій npm-Пакету @nitra/cursor"
---

# Rule-Centric Структура Директорій npm-Пакету @nitra/cursor

**Status:** Accepted
**Date:** 2026-05-14

## Контекст

Пакет `@nitra/cursor` (~29 правил) зберігав артефакти одного правила в чотирьох розрізнених місцях: `npm/mdc/` (текст правила у `.mdc`-форматі), `npm/policy/{rule}/` (Rego-поліси), `npm/scripts/check-*.mjs` / `run-*.mjs` / `lint-*.mjs` (JS-скрипти), `npm/bin/auto-rules.md` та `auto-skills.md` (умови автоактивації). Видалення або аудит правила вимагали ручної синхронізації чотирьох місць і спричиняли залишки «мертвих» артефактів.

## Рішення/Процедура/Факт

Уведено `npm/rules/{rule}/` як єдину директорію на правило. Директорія `npm/mdc/` перейменовується на `npm/rules/`; `npm/policy/` видаляється як самостійний каталог. Назви директорій — kebab-case.

Структура кожного правила:
- `{rule}/{rule}.mdc` — текст правила
- `{rule}/auto.md` — умова авто-активації (виокремлена з `bin/auto-rules.md`)
- `{rule}/policy/` — Rego-поліси (переміщено з `npm/policy/{rule}/`)
- `{rule}/js/check.mjs`, `run.mjs`, `lint.mjs` — JS-скрипти без rule-суфікса у назвах файлів (директорія є namespace)

Скіли отримують аналогічну структуру: `npm/skills/{skill}/auto.md` та `npm/skills/{skill}/js/`. `npm/bin/auto-skills.md` розбивається на per-skill `auto.md`.

Зміни в інфраструктурі:
- `auto-rules.mjs` читає умови з `rules/*/auto.md` замість `bin/auto-rules.md`
- `auto-skills.mjs` читає `skills/*/auto.md` замість `bin/auto-skills.md`
- `lint-conftest.mjs` оновлює `policyDir` на обхід `rules/*/policy/` зі збереженням виключення `ga`
- `bin/n-cursor.js` оновлює константу `BUNDLED_RULES_DIR`, функції `getAvailableCheckRules()` (`readdir` + перевірка наявності `js/check.mjs`) та `getCheckScript()`, а також статичні імпорти `run-*`/`lint-*`
- `package.json#files` замінює `"mdc/"` та `"policy/"` на `"rules/"`

Внутрішній snake_case у Rego-namespace збережено (`image_avif/`, `js_bun_db/` тощо). У `npm/scripts/` залишається виключно крос-правильна інфраструктура: `auto-rules.mjs`, `auto-skills.mjs`, `lint-conftest.mjs`, `utils/`.

## Обґрунтування

Мета — self-contained правило: видалив `rules/{rule}/` → правило зникло повністю (mdc, policy, js-скрипти, auto-умова) без жодної ручної синхронізації. Це усуває клас помилок, де часткове видалення лишає «мертві» артефакти. Відповідає принципу high cohesion / low coupling для одиниці «правило» та спрощує онбординг: всі частини правила видимі одним `ls`.

## Розглянуті альтернативи

1. Реорганізація лише `npm/scripts/` без переносу `mdc/` і `policy/` — відхилено: правило залишалося «розірваним» у трьох місцях, атомарного видалення не досягалося.
2. Збереження назви `npm/mdc/` замість `npm/rules/` — відхилено: назва прив'язана до розширення файлу, а не до концепції «правило».
3. Збереження rule-суфікса у файлах всередині директорії (`check-docker.mjs` замість `check.mjs`) — відхилено: директорія вже є namespace, дублювання зайве.
4. snake_case для директорій правил (як у поточному `policy/`) — відхилено на користь kebab-case, що відповідає наявним іменам `.mdc`-файлів.
5. Скіли без `auto.md` (залишити агрегований `bin/auto-skills.md`) — відхилено: пов'язані скіли мають видалятися разом із правилом одним `rm -rf`.

## Зачіпає

`npm/mdc/` (перейменовано на `npm/rules/`), `npm/policy/` (видалено), `npm/scripts/check-*.mjs`, `npm/scripts/run-*.mjs`, `npm/scripts/lint-ga.mjs`, `npm/scripts/lint-rego.mjs`, `npm/scripts/lint-conftest.mjs`, `npm/scripts/auto-rules.mjs`, `npm/scripts/auto-skills.mjs`, `npm/bin/n-cursor.js`, `npm/bin/auto-rules.md` (видалено), `npm/bin/auto-skills.md` (видалено), `npm/skills/*/`, `npm/package.json` (`files` та `scripts`).

## Update 2026-05-14

Фінальна реалізація rule-centric структури завершена. Версія пакету `@nitra/cursor` підвищена з 1.9.21 до 1.9.23. Переміщено 26 правил у `npm/rules/`, 7 скілів отримали паралельну структуру `auto.md + js/`. `bin/n-cursor.js` переключено на `BUNDLED_RULES_DIR = rules/` з новими резолверами `.mdc` і `check.mjs`; `lint-conftest.mjs` і `run-conftest-batch.mjs` — на `rules/{rule}/policy/`. `npm/package.json#files` оновлено: прибрано `mdc`/`policy`, додано `rules` з негативними glob-патернами для тестів і fixtures. `npm/tests/` збережено лише для 3 крос-правильних файлів і fixtures. Правило зафіксовано в `.cursor/rules/scripts.mdc` v1.5.
