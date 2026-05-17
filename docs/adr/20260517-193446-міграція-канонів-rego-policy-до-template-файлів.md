---
session: 4a6350d4-09fc-48ad-b274-e81cf19e7e26
captured: 2026-05-17T19:34:46+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/4a6350d4-09fc-48ad-b274-e81cf19e7e26.jsonl
---

## ADR Міграція канонів Rego-policy до template/-файлів

## Context and Problem Statement
У Rego-policy-файлах правил `@nitra/cursor` канонічні значення (scripts, extensions, CI-paths тощо) були захардкоджені безпосередньо в тілі `.rego`-правила. Це означало, що зміна канону вимагала редагування як `.mdc`-опису, так і Rego-файлу та тестів.

## Considered Options
* Зберігати канонічні значення в `template/` JSON/YAML-файлах і передавати через `--data` (обраний варіант)
* Залишити значення захардкодованими в `.rego`-файлах

## Decision Outcome
Chosen option: "Зберігати канонічні значення в `template/` JSON/YAML-файлах і передавати через `--data`", because це відокремлює «що є канонічним» (machine-readable template) від «як перевіряти» (Rego-логіка), дозволяє одному джерелу правди обслуговувати і `.mdc`-опис, і conftest.

### Consequences
* Good, because transcript фіксує очікувану користь: `opa test` дав 427/427 після всіх 15 фаз міграції, а `.mdc`-файли позбавились дублюючих code-блоків.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файли шаблонів використовують суфікси `.contains.json` (substring-walker), `.snippet.json` (generic walkDir equals), `.deny.json` (заборонені ключі).
- Приклади: `npm/rules/php/policy/package_json/template/package.json.contains.json`, `npm/rules/docker/policy/lint_docker_yml/template/lint-docker.yml.snippet.yml`.
- Rego-правила читають канон через `data.template.snippet` / `data.template.contains` / `data.template.deny`.
- Фінальний smoke: `opa test npm/rules` → PASS 427/427; `bun test` → 740 тестів, 0 fail.

---

## ADR Суфікс-семантика template/-файлів: contains / snippet / deny

## Context and Problem Statement
При виносі канонічних значень у `template/`-файли постала потреба в конвенції: один і той самий rule-концерн може перевіряти і «значення містить підрядок», і «поле точно дорівнює», і «ключ заборонений».

## Considered Options
* Суфікси: `.contains.json` — substring-walker; `.snippet.json` — generic walkDir equals; `.deny.json` — заборонені ключі
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Суфікси `.contains.json` / `.snippet.json` / `.deny.json`", because вони кодують семантику перевірки безпосередньо в імені файлу, а відповідна Rego-логіка вибирає потрібний ключ (`data.template.contains`, `data.template.snippet`, `data.template.deny`).

### Consequences
* Good, because transcript фіксує очікувану користь: один концерн може мати кілька template-файлів різного типу (наприклад, `text/policy/cspell` має `.snippet.json` + `.contains.json` + `.deny.json`) без конфліктів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/text/policy/cspell/template/.cspell.json.snippet.json`, `.cspell.json.contains.json`, `.cspell.json.deny.json`.
- `npm/rules/js-bun-db/policy/package_json/template/package.json.deny.json`.
- `npm/rules/image-avif/policy/package_json/template/package.json.deny.json`.

---

## ADR Роздільний запуск `opa test` для суміжних policy-пакетів

## Context and Problem Statement
Запуск `opa test npm/rules/js-bun-db/policy/ npm/rules/js-bun-redis/policy/` в одній команді завершився помилкою `merge error` через конфлікт `target.json` між двома пакетами.

## Considered Options
* Запускати кожен policy-каталог окремою командою `opa test`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Запускати кожен policy-каталог окремою командою `opa test`", because суміщення двох `target.json`-файлів з різних пакетів спричиняє `merge error` у OPA.

### Consequences
* Good, because transcript фіксує очікувану користь: `opa test npm/rules/js-bun-db/policy/ 2>&1` → PASS 4/4 та окремо `opa test npm/rules/js-bun-redis/policy/` → PASS 4/4.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Помилка: `npm/rules/js-bun-redis/policy/package_json/target.json: merge error` при одночасному запуску.
- Команда: `opa test npm/rules/js-bun-db/policy/ 2>&1 | tail -3 && echo "---" && opa test npm/rules/js-bun-redis/policy/ 2>&1 | tail -3`.
