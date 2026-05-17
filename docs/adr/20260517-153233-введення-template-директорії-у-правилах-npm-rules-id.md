---
session: c3e517a1-5154-44e2-9ce0-9ca5f8359ffb
captured: 2026-05-17T15:32:33+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/c3e517a1-5154-44e2-9ce0-9ca5f8359ffb.jsonl
---

<output_complete>

---

## ADR Введення `template/` директорії у правилах `npm/rules/<id>/`

## Context and Problem Statement

Правила в `npm/rules/<id>/` поєднують у `.mdc`-файлі AI-директиви та scaffold-фрагменти (JSON-snippets, TOML-блоки, YAML-канони) як inline fenced-блоки. Це ускладнює машинне тестування й призводить до дрейфу між описом у `.mdc` і фактичною перевірочною логікою у `check.mjs`/`.rego`. Потрібна єдина canonical home для merge-фрагментів і повних файлів-канонів, з якої читають і JS-скрипти, і Rego-полісі.

## Considered Options

* Єдиний `check.json` з DSL (`required`/`forbidden`/`contains` ключами) — відхилено
* `template/` на рівні rule (не concern) — відхилено через collision: `k8s` має 4 концерни на `*.yaml`, `npm-module` — 2 концерни на `package.json`
* Concern-level `template/` з native-суфіксами (`<target>.<slot>.<ext>`) — обрано

## Decision Outcome

Chosen option: "concern-level `template/` з native-суфіксами", because це єдиний варіант що знімає всі collision-кейси між концернами які цілять той самий filename, зберігає нативний синтаксис цільового файлу в template і дозволяє Rego читати дані через `--data` без DSL-прошарку.

Canonical layout:
```
npm/rules/<id>/policy/<concern>/template/<target>.<slot>.<ext>
npm/rules/<id>/fix/<concern>/template/<target>.<slot>.<ext>
```

Слоти: `snippet` (subset-of leaf-values, обов'язковий), `deny` (заборонені шляхи), `contains` (substring перевірка). Для повних файлів-канонів (`.gitleaks.toml`, workflow `.yml`, `.stylelintignore`) — той самий `.snippet.<ext>` у нативному форматі цільового файлу.

### Consequences

* Good, because transcript фіксує очікувану користь: smoke-тест підтвердив що synthetic-break (`useDefault = false`, `gitleaks` у dependencies) детектується через template-driven повідомлення без inline-літералів у check.mjs/rego.
* Good, because `runConftestBatch` розширено бекв-сумісно (`templateData` — optional), existing полісі без template не ламаються.
* Bad, because `loadTemplate` читає з файлової системи і потребує правильного `concernDir`; помилковий шлях дає тихе `null` (не виключення) — потребує дисципліни у викликах.

## More Information

Нові файли: `npm/scripts/utils/template.mjs` (`loadTemplate`, `checkSnippet`, `checkDeny`, `checkContains`, `checkTextSubset`), розширено `npm/scripts/utils/run-conftest-batch.mjs` (`buildConftestArgs` + `templateData`), новий `npm/scripts/utils/check-mdc-template-refs.mjs` (`findMissingMdcRefs`), підключено у `npm/scripts/utils/run-rule.mjs` (`resolveConcernTemplateData`). Pilot: `npm/rules/security/fix/gitleaks/template/.gitleaks.toml.snippet.toml`, `npm/rules/security/policy/package_json/template/package.json.{snippet,deny,contains}.json`. Spec: `docs/superpowers/specs/2026-05-17-template-dir-design.md`. Concern inventory: `docs/adr/template-dir-concern-inventory.md`.
