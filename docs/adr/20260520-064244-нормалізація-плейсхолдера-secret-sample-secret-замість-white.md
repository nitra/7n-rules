---
session: 4e002ac8-4d4d-43da-a6cd-e02a410a7858
captured: 2026-05-20T06:42:44+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/4e002ac8-4d4d-43da-a6cd-e02a410a7858.jsonl
---

## ADR Нормалізація плейсхолдера `secret` → `sample-secret` замість whitelist у конфізі

## Context and Problem Statement
Проєкт використовував голий рядок `secret` як placeholder у прикладних файлах (`.env.example` тощо). TruffleHog фільтрує `secret` лише тому, що він потрапляє у вшитий `fp_words.txt` — поведінка версієзалежна та крихка. Водночас TruffleHog не дозволяє розширити список false-positives через зовнішній конфіг (`fp_words.txt` вбудований через `//go:embed`).

## Considered Options
* Додати `secret` у whitelist TruffleHog-конфігу (`--config` / `exclude-paths`)
* Нормалізувати placeholder: замінити `secret` → `sample-secret` і закріпити правилом

## Decision Outcome
Chosen option: "Нормалізувати placeholder: `secret` → `sample-secret`", because рядок `sample-secret` містить підрядок `sample`, який є у вбудованому `DefaultFalsePositives` у `pkg/detectors/falsepositives.go`, тому фільтрація гарантована незалежно від версії TruffleHog; голий `secret` — це trigger-keyword для детекторів, а не placeholder за дизайном.

### Consequences
* Good, because `sample-secret` фільтрується TruffleHog за дизайном (через `DefaultFalsePositives`), а не випадково через `fp_words.txt`.
* Bad, because перехід потребує масової заміни `secret` → `sample-secret` у наявних прикладних файлах репозиторіїв, що використовують це правило.

## More Information
- `pkg/detectors/falsepositives.go` (TruffleHog): містить `DefaultFalsePositives` з `"sample"`, `"example"` тощо.
- Нове правило: `npm/rules/security/fix/sample_secret/check.mjs`, `check.test.mjs`.
- Документовано в `npm/rules/security/security.mdc` (розширено секцію `sample_secret`).
- CHANGELOG: `npm/CHANGELOG.md`, версія `1.13.58`.

---

## ADR Обмеження перевірки `sample_secret` лише прикладними файлами та позицією значення

## Context and Problem Statement
При створенні concern `security.sample_secret` треба було вибрати: сканувати всі файли або лише прикладні, і чи вважати порушенням будь-яке вживання `secret` або лише у позиції значення (правій частині `KEY=value`). Широкий обсяг дає хибні спрацювання в коді та документації.

## Considered Options
* Перевіряти всі файли репозиторію
* Перевіряти лише прикладні файли (`.env.example`, `*.sample`, `*.template`, fixtures)

Для позиції:
* Будь-яке вживання `secret` у рядку
* Лише у позиції значення (права частина `=` або YAML/JSON-значення)

## Decision Outcome
Chosen option: "Лише прикладні файли" + "лише у позиції значення", because прикладні файли — єдине місце, де placeholder у credential-значеннях є навмисним і підпадає під TruffleHog-сканування; перевірка лише value-позиції мінімізує хибні спрацювання у ключах (`SECRET_KEY`, `DB_SECRET_NAME` тощо) та документації.

### Consequences
* Good, because transcript фіксує очікувану користь: 41 прикладний файл репозиторію пройшов перевірку без хибних спрацювань (`✅ прикладні файли (41) не містять bare \`secret\``).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Фільтр за іменем файлу в `check.mjs`: glob-маски `*.example`, `*.sample`, `*.template`, `*.dist`, `__fixtures__/`, `fixtures/`.
- Regex для value-позиції охоплює формати `.env` (`KEY=secret`), YAML (`key: secret`), JSON (`"key": "secret"`).
- Вибір підтверджено через `AskUserQuestion` у сесії.
