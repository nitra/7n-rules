# Введення `template/` директорії у правилах `npm/rules/<id>/`

**Status:** Accepted
**Date:** 2026-05-17

## Context and Problem Statement

Правила в `npm/rules/<id>/` поєднували у `.mdc` AI-директиви та scaffold-фрагменти як inline fenced-блоки. Зміна канонічного значення вимагала оновлень у трьох місцях: `.mdc`, `check.mjs`, `*.rego`.

## Considered Options

- Єдиний `check.json` з DSL (`required`/`forbidden`/`contains` ключами)
- `template/` на рівні rule (не concern)
- Concern-level `template/` з native-суфіксами (`<target>.<slot>.<ext>`)

## Decision Outcome

Chosen option: "Concern-level `template/` з native-суфіксами", because це єдиний варіант що знімає collision-кейси між концернами які цілять той самий filename, зберігає нативний синтаксис і дозволяє Rego читати дані через `--data` без DSL-прошарку.

Canonical layout: `npm/rules/<id>/policy/<concern>/template/<target>.<slot>.<ext>` і `npm/rules/<id>/fix/<concern>/template/<target>.<slot>.<ext>`. Слоти: `snippet` (subset-of leaf-values), `deny` (заборонені шляхи), `contains` (substring). Rule-level відхилено через collision: `k8s` — 4 концерни на `*.yaml` glob, `npm-module` — 2 концерни на `package.json`.

### Consequences

- Good, because smoke-тест (security-пілот) підтвердив: synthetic-break (`useDefault = false`, `gitleaks` у dependencies) детектується через template-driven повідомлення без inline-літералів.
- Good, because `runConftestBatch` розширено бекв-сумісно (`templateData` optional).
- Bad, because `loadTemplate` читає з ФС і потребує правильного `concernDir`; помилковий шлях дає тихе `null`.

## More Information

Нові файли: `npm/scripts/utils/template.mjs` (`loadTemplate`, `checkSnippet`, `checkDeny`, `checkContains`, `checkTextSubset`); `npm/scripts/utils/check-mdc-template-refs.mjs` (`findMissingMdcRefs`); розширено `run-conftest-batch.mjs` і `run-rule.mjs`.
Pilot: `npm/rules/security/fix/gitleaks/template/.gitleaks.toml.snippet.toml`, `npm/rules/security/policy/package_json/template/package.json.{snippet,deny,contains}.json`.
Spec: `docs/superpowers/specs/2026-05-17-rule-templates-design.md`. Concern inventory: `docs/adr/template-dir-concern-inventory.md`.
