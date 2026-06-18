---
type: ADR
title: "Суфікс-семантика template/-файлів та ізоляція opa test по пакетах"
---

# Суфікс-семантика template/-файлів та ізоляція opa test по пакетах

**Status:** Accepted
**Date:** 2026-05-17

## Context and Problem Statement

Після рішення виносити canonical values у `template/`-файли постали два окремих питання: (1) яку конвенцію суфіксів застосовувати, коли один концерн може перевіряти і підрядок, і точне значення, і заборонений ключ; (2) чи можна запускати `opa test` для кількох policy-каталогів однією командою. Фінальний результат 15 фаз міграції: `opa test npm/rules` → PASS 427/427; `bun test` → 740 тестів, 0 fail.

## Considered Options

### Суфікс-семантика
* `.contains.json` — substring-walker; `.snippet.json` — generic walkDir equals; `.deny.json` — заборонені ключі
* Інші варіанти в transcript не обговорювалися.

### Запуск opa test
* Один виклик `opa test <dir1> <dir2>` для кількох policy-пакетів
* Окремий виклик `opa test` для кожного policy-каталогу

## Decision Outcome

Chosen option: "Суфікси `.contains.json` / `.snippet.json` / `.deny.json`", because вони кодують семантику перевірки безпосередньо в імені файлу; відповідна rego-логіка вибирає ключ `data.template.contains`, `data.template.snippet` або `data.template.deny`.

Chosen option: "Окремий виклик `opa test` для кожного policy-каталогу", because суміщення двох `target.json`-файлів з різних пакетів в одній команді спричиняє `merge error` у OPA.

### Consequences

* Good, because один концерн може мати кілька template-файлів різного типу без конфліктів (наприклад, `text/policy/cspell` має `.snippet.json` + `.contains.json` + `.deny.json`).
* Good, because transcript підтверджує: `opa test npm/rules/js-bun-db/policy/ 2>&1` → PASS 4/4 та окремо `opa test npm/rules/js-bun-redis/policy/` → PASS 4/4.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Приклади суфіксів:
- `npm/rules/text/policy/cspell/template/.cspell.json.snippet.json`, `.cspell.json.contains.json`, `.cspell.json.deny.json`
- `npm/rules/js-bun-db/policy/package_json/template/package.json.deny.json`
- `npm/rules/image-avif/policy/package_json/template/package.json.deny.json`
- `npm/rules/php/policy/package_json/template/package.json.contains.json`

Помилка при суміщенні: `npm/rules/js-bun-redis/policy/package_json/target.json: merge error`.

Команда для роздільного запуску: `opa test npm/rules/js-bun-db/policy/ 2>&1 | tail -3 && echo "---" && opa test npm/rules/js-bun-redis/policy/ 2>&1 | tail -3`.

Рішення про введення `template/` директорії зафіксовано в `введення-template-директорії-у-правилах-npm-rules.md`.
