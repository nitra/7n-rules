---
session: 0850a6f9-4567-482d-8da2-2fe965458fbc
captured: 2026-05-17T06:31:25+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/0850a6f9-4567-482d-8da2-2fe965458fbc.jsonl
---

## ADR Правило `security` на базі gitleaks як завжди-увімкнене правило `@nitra/cursor`
**Контекст:** Проєкт не мав автоматизованого захисту від витоку секретів (API-ключів, токенів) у кодовій базі. Потрібний лінт-скрипт `lint-security` та CI-guard у агрегованому `lint`.
**Рішення/Процедура/Факт:** Створено правило `npm/rules/security/` зі структурою: `security.mdc` (`alwaysApply: true`, `version: 1.0`), `auto.md` з `завжди`, `fix/gitleaks/check.mjs` (FS-перевірки: наявність `.gitleaks.toml` + `useDefault = true`), `fix/gitleaks/check.test.mjs` (5 тестів), `policy/package_json/package_json.rego` (5 deny-правил: наявність `scripts.lint-security`, виклик `gitleaks detect|git`, присутність `bun run lint-security` в агрегованому `lint`, відсутність `gitleaks` у залежностях) + 9 rego-юніт-тестів. Правило додане в `AUTO_RULE_ORDER` і `addRule('security')` без умови в `auto-rules.mjs`. Dogfood: `package.json` кореня отримав `lint-security: gitleaks detect --no-banner` та вбудований у `lint`; створено `.gitleaks.toml` з `[extend] useDefault = true`. Версія пакета: `1.12.0`.
**Обґрунтування:** Секрети можуть потрапити у будь-який файл, тому `alwaysApply: true` (як `text`, `adr`) правильніший за `globs` — агент має постійно знати про обов'язок `gitleaks` у ланцюжку `lint`. `gitleaks detect` без `git log` режиму сканує лише робочий каталог і є швидким. Відсутність `gitleaks` у `dependencies` примусово: CLI — зовнішній, встановлюється через `brew`, а не `npm`.
**Розглянуті альтернативи:** `alwaysApply: false` з `globs: "package.json,.gitleaks.toml,**/.env*"` — відхилено, бо нові env-файли, що створюються вперше, не потрапляють під glob; `gitleaks protect` (git-hook режим) — не розглядався; `secretlint` — не обговорювався.
**Зачіпає:** `npm/rules/security/` (новий), `npm/scripts/auto-rules.mjs`, `npm/scripts/auto-rules.test.mjs`, `npm/package.json` (v1.12.0), `npm/CHANGELOG.md`, `package.json` (root, v1.0.2), `CHANGELOG.md` (root), `.gitleaks.toml` (root, новий), `.cursor/rules/n-security.mdc` (синхронізований).

---

## ADR Правило `adr` переведено з opt-in на завжди-увімкнений автодетект
**Контекст:** Правило `adr` (Stop-хук для збору ADR-чернеток) вмикалося вручну — через явний запис `"adr"` у `.n-cursor.json`. Більшість проєктів хочуть фіксувати архітектурні рішення автоматично.
**Рішення/Процедура/Факт:** Додано `'adr'` до `AUTO_RULE_ORDER` у `auto-rules.mjs`; виклик `addRule('adr')` без умов (поряд з `addRule('text')`); створено `npm/rules/adr/auto.md` з `завжди`; оновлено текст `adr.mdc` — замість «вмикається вручну» тепер «увімкнене за замовчуванням; вимикається через `disable-rules: ["adr"]`»; оновлено `AUTO_RULE_ORDER` і expected-масив у `auto-rules.test.mjs`. Версія: `1.11.16`.
**Обґрунтування:** Правило корисне для будь-якого активного проєкту; opt-in-бар'єр призводив до того, що нові репозиторії забували його увімкнути. Механізм `disable-rules` достатній для тих, хто не хоче ADR.
**Розглянуті альтернативи:** Залишити opt-in — відхилено на прохання користувача.
**Зачіпає:** `npm/scripts/auto-rules.mjs`, `npm/scripts/auto-rules.test.mjs`, `npm/rules/adr/auto.md` (новий), `npm/rules/adr/adr.mdc`, `npm/package.json` (v1.11.16), `npm/CHANGELOG.md`.

---

## Knowledge `ensureNitraCursorInRootDevDependencies` додає self-reference, якщо `cwd = npm/`
**Контекст:** Під час роботи в сесії bash-інструменти залишилися в `npm/` після серії команд, і запуск `npx @nitra/cursor check` звідти записав `@nitra/cursor: ^1.11.17` у `npm/package.json#devDependencies`. Це спричиняє провал `check npm-module`, яке забороняє self-reference.
**Рішення/Процедура/Факт:** `scripts/ensure-nitra-cursor-dev-dependencies.mjs` завжди пише у `package.json` відносно **поточного** `process.cwd()`. Якщо запускати `npx @nitra/cursor` зсередини `npm/`, скрипт вважає `npm/package.json` кореневим і дописує себе у `devDependencies`. Запуск з кореня репо (де `package.json` не є `@nitra/cursor`) не порушує нічого. Фікс: завжди запускати `npx @nitra/cursor check` з кореня монорепо.
**Обґрунтування:** Інваріант: `npx @nitra/cursor` запускається тільки з кореня проєкту-споживача, ніколи з-під `npm/` самого пакета.
**Розглянуті альтернативи:** Guard у `ensure-nitra-cursor-dev-dependencies.mjs`, який перевіряє `name !== '@nitra/cursor'` перед записом — не реалізований у цій сесії.
**Зачіпає:** `npm/scripts/ensure-nitra-cursor-dev-dependencies.mjs`, `npm/package.json` (регулярно повертається self-reference після некоректного cwd), `check npm-module` (падає на self-reference).
