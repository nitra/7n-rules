---
type: ADR
title: "Per-project kubescape exceptions через `.kubescape-exceptions.json`"
---

# Per-project kubescape exceptions через `.kubescape-exceptions.json`

**Status:** Accepted
**Date:** 2026-05-18

## Context and Problem Statement

`lint-k8s` (`kubescape scan`) тригерував контроль C-0012 ("Applications credentials in configuration files") на env-змінній `HASURA_GRAPHQL_JWT_SECRET` у `configmap.yaml`. Значення містить публічний JWT-конфіг (`jwk_url` + `issuer`), а не credentials, але kubescape не розрізняє публічні та приватні значення за іменем ключа.

## Considered Options

- Per-project exceptions-файл (`.kubescape-exceptions.json` у корені проєкту, передається через `--exceptions`)
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Per-project exceptions-файл `.kubescape-exceptions.json`", because це стандартний механізм kubescape для обходу false-positive на рівні конкретного проєкту без глобальних змін у правилі; відсутність файлу не впливає на поведінку (backward-compatible).

### Consequences

- Good, because `lint-k8s` підхоплює `.kubescape-exceptions.json` автоматично через `existsSync` і додає `--exceptions <abs-path>` до команди kubescape.
- Good, because `k8s.mdc` (v1.30) документує формат `actionType: alertOnly` для C-0012 з прикладом `HASURA_GRAPHQL_JWT_SECRET`.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Змінені файли: `npm/rules/k8s/lint/lint.mjs` (функції `buildKubescapeExceptionsArgs`, оновлений `runKubescape(dirs, root)`), `npm/rules/k8s/lint/run-roots.test.mjs` (6 тестів pass), `npm/rules/k8s/k8s.mdc`.
Реліз: `npm/package.json` 1.13.31 → 1.13.32, запис у `npm/CHANGELOG.md`.
