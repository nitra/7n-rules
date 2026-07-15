---
type: JS Module
title: fix-lint_k8s_yml.mjs
resource: npm/rules/k8s/lint_k8s_yml/fix-lint_k8s_yml.mjs
docgen:
  crc: 220f0740
  model: openai-codex/gpt-5.5
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Надає `patterns` як read-only опис очікуваних збігів для перевірки репозиторію без змін у файловій системі чи інших сховищах. Свідомо пропускає `.github` і `.git`, щоб не аналізувати службові шляхи та зосереджувати перевірку на релевантному вмісті.

## Поведінка

1. `patterns` оголошує набір правил автоматичного виправлення для workflow перевірки Kubernetes YAML.

2. `patterns` забезпечує наявність стандартного шаблону `.github/workflows/lint-k8s.yml`, щоб репозиторій мав узгоджену CI-перевірку Kubernetes-маніфестів.

3. `patterns` працює як read-only опис очікуваного виправлення: сам файл не виконує запис у файлову систему чи базу даних.

4. `patterns` свідомо не охоплює обходом службові шляхи `.github` і `.git`; цільовий workflow у `.github/workflows/lint-k8s.yml` задається як конкретний шаблонний артефакт.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Свідомо пропускає шляхи: `.github`, `.git`.
