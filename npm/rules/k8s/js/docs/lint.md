---
type: JS Module
title: lint.mjs
resource: npm/rules/k8s/js/lint.mjs
docgen:
  crc: b4e93c75
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

Модуль перевіряє Kubernetes-маніфести у директорії `.../k8s/*.yaml`. Він запускає лінтер Kubernetes та виконує перевірки за допомогою kubeconform, kubescape та k8s.mdc для забезпечення відповідності специфікації Kubernetes та відсутності синтаксичних помилок.

## Поведінка

1. Викликає оркестраторний адаптер для запуску лінтера Kubernetes.
2. Виконує перевірки kubeconform та kubescape для YAML-файлів у директорії `.../k8s/*.yaml`.
3. Виконує структурні перевірки k8s.mdc для маніфестів, kustomization та network_policy у фазі конформності.
4. Якщо у директорії `.../k8s` відсутні маніфести, операція не виконується.
5. Повертає код виходу.

## Публічний API

lint — Виконує перевірку Kubernetes-маніфестів у директорії `k8s/` за допомогою kubeconform та kubescape.
lint — Перевіряє відповідність структурних правил MDC (manifest/kustomization/network_policy) на етапі конформності.
lint — Не виконує жодних дій, якщо в директорії `k8s/` відсутні маніфести.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
