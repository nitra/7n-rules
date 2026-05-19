---
session: d4386bd3-d6bf-472c-9968-d65c554d8a70
captured: 2026-05-19T13:47:12+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d4386bd3-d6bf-472c-9968-d65c554d8a70.jsonl
---

## ADR Читання `on:`-блоку GitHub Actions через `input["true"]` у Rego-полісі

## Context and Problem Statement
conftest використовує YAML 1.1 (go-yaml), де ключ `on:` без лапок стає булевим `true`. Через це `input.on` та `object.get(input, "on", {})` повертали `undefined`, і полісі `docker.lint_docker_yml` та `text.lint_text` або хибно відхиляли валідні файли (у docker), або мовчки пропускали перевірку тригерів (у text).

## Considered Options
* Змінити ключ `on:` → `'on':` у всіх workflow-файлах користувацьких репо (обхідний варіант, описаний у transcript як тимчасовий).
* Читати `on:`-блок через `input["true"]` у самих полісі — як вже робить `ga.lint_ga`.

## Decision Outcome
Chosen option: "Читати `on:`-блок через `input["true"]` у Rego-полісі", because це canonical pattern, вже закріплений у `ga.lint_ga`, і переносить відповідальність за особливість YAML 1.1 на полісі, а не на кожен workflow-файл у споживчих репо.

### Consequences
* Good, because users можуть лишати канонічний `on:` без лапок у своїх `.github/workflows/` — обхідний `'on':` більше не потрібен.
* Good, because transcript фіксує очікувану користь: `conftest verify` на обох полісі після фіксу — 6/6 і 5/5 passed.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли:
- `npm/rules/docker/policy/lint_docker_yml/lint_docker_yml.rego` — `object.get(input, "on", {})` → `object.get(input, "true", {})`
- `npm/rules/docker/policy/lint_docker_yml/lint_docker_yml_test.rego` — `"on"` → `"true"` у фікстурах і json.patch-патчах
- `npm/rules/text/policy/lint_text/lint_text.rego` — введено локальний аліас `gha_on := input["true"]`, три посилання `input.on.*` замінено на `gha_on.*`
- `npm/rules/text/policy/lint_text/lint_text_test.rego` — `"on"` → `"true"` у `canonical_input`

Еталон: `npm/rules/ga/policy/lint_ga/lint_ga.rego` (використовує `input["true"]` від початку).
Верифікація: `conftest verify -p npm/rules/docker/policy/lint_docker_yml` і `conftest verify -p npm/rules/text/policy/lint_text`.
