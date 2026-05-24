---
session: e7d2e8a4-bcf7-43b3-b4d8-32f05bacf4f7
captured: 2026-05-24T07:27:28+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/e7d2e8a4-bcf7-43b3-b4d8-32f05bacf4f7.jsonl
---

---

## ADR Конвенція неймінгу kebab-case для зовнішнього / snake_case для внутрішнього

## Context and Problem Statement

У проєкті `npm/rules/` файли використовують і дефіси, і підкреслення в іменах, що виглядає як хаотичний різнобій. Потрібно було зрозуміти, чи це навмисна конвенція, чи справжня непослідовність, і чим вона обґрунтована.

## Considered Options

* kebab-case скрізь (у каталогах, концернах, Rego)
* snake_case скрізь
* Розподіл: kebab-case для «зовнішнього», snake_case для «внутрішнього/концернового»
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Розподіл: kebab-case для «зовнішнього», snake_case для «внутрішнього/концернового»", because Rego-ідентифікатори (`package`, змінні, правила `deny`/`allow`) не можуть містити дефіс — він парситься як оператор віднімання — а discovery-логіка (`listJsConcerns`, `runConftestBatch`) вимагає, щоб ім'я файлу `js/<concern>.mjs` збігалося 1:1 з `package <rule>.<concern>` у Rego.

### Consequences

* Good, because ім'я `js/<concern>.mjs` і `policy/<concern>/<concern>.rego` збігаються 1:1, що спрощує автоматичний discovery і крос-посилання між JS-концерном і Rego-правилом.
* Good, because transcript фіксує очікувану користь: `find ./npm/rules/*/utils -maxdepth 1 -type f -name "*_*.mjs"` повернув пусто — порушень конвенції немає.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Конвенцію прописано в `.cursor/rules/scripts.mdc` (рядок ~34):

> Іменування директорії правила — **kebab-case**. Імена концернів — **snake_case**, помічники — **kebab-case** з префіксом rule/concern.

Таблиця ролей (з transcript):

| Що | Стиль | Приклади |
|---|---|---|
| Каталог правила | kebab-case | `js-bun-db/`, `nginx-default-tpl/` |
| `.mdc` файл правила | kebab-case | `js-bun-db.mdc` |
| Концерн `js/<concern>.mjs` / `policy/<concern>/` | snake_case | `internal_urls.mjs`, `vscode_settings/` |
| Rego-пакети та тести | snake_case | `hasura_httproute.rego`, `hpa_pdb_test.rego` |
| Helpers у `utils/` | kebab-case з префіксом | `docker-mirror.mjs`, `vue-forbidden-imports.mjs` |

Граматичне обмеження Rego: identifier — `[a-zA-Z_][a-zA-Z0-9_]*`; дефіс не входить у множину допустимих символів (OPA Policy Language — Lexical conventions).
