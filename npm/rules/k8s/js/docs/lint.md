---
type: JS Module
title: lint.mjs
resource: npm/rules/k8s/js/lint.mjs
docgen:
  crc: a71c10b0
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 90
---

## Огляд

Модуль знаходить унікальні корені каталогів, що містять YAML-маніфести (тільки файли з розширенням `*.yaml`), і запускає `kubeconform` та `kubescape` для їх аналізу. Якщо таких файлів немає, вихід буде 0 без виклику зовнішніх CLI. `kubeconform` перевіряє маніфести проти OpenAPI-схем Kubernetes (https://github.com/yannh/kubeconform#readme), при цьому версія `-kubernetes-version` узгоджена з конфігурацією. `kubescape` сканує маніфести на відповідність стандартам (NSA, MITRE, CIS тощо), враховуючи винятки, визначені у файлі .kubescape-exceptions.json, і може використовувати інформацію про CRD з https://datreeio.github.io/CRDs-catalog/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json. Усі виклики зовнішніх інструментів обробляються у режимі fail-safe, запобігаючи викиданню винятків.

## Поведінка

pathHasK8sSegment визначає, чи містить шлях сегмент директорії `k8s` відносно кореня репозиторію.
k8sRootFromFile знаходить абсолютний шлях до каталогу `…/k8s` відносно наданого абсолютного шляху до YAML-файлу.
findK8sRoots знаходить унікальні абсолютні шляхи до каталогів `k8s` за наявності файлів `*.yaml`, ігноруючи шляхи, що починаються з `.github/`.
buildKubescapeExceptionsArgs створює аргументи для `kubescape` для використання файлу `.kubescape-exceptions.json` у корені репозиторію.
findKustomizationDirs знаходить каталоги, що містять білдабельний `kustomization.yaml` у межах каталогу `…/k8s`, виключаючи компоненти (`kind: Component`).
runLintK8s виконує повний процес лінтингу Kubernetes: перевірку маніфестів за допомогою `kubeconform` та сканування на відповідність за допомогою `kubescape` для всіх знайдених каталогів `k8s`.
lint делегує виконання процесу лінтингу Kubernetes функції `runLintK8s`.

## Публічний API

pathHasK8sSegment — Визначає, чи містить шлях сегмент директорії `k8s`.

k8sRootFromFile — Знаходить каталог `…/k8s`, що містить маніфест, рухаючись від заданого файлу вгору.

findK8sRoots — Збирає список унікальних коренів `k8s`, якщо в поточному робочому каталозі є файли `*.yaml`.

buildKubescapeExceptionsArgs — Формує аргументи для інструменту kubescape, вказуючи файл `.kubescape-exceptions.json`, якщо він присутній у корені проєкту.

findKustomizationDirs — Виявляє каталоги, які слугують точками входу для Kustomize (містять `kustomization.yaml` з відповідним типом), ігноруючи компоненти.

runLintK8s — Виконує перевірку Kubernetes-маніфестів, використовуючи механізм блокування та дедуплікації на основі стану Git-дерева.

lint — Делегує виконання перевірки Kubernetes-маніфестів функції `runLintK8s` через інтерфейс `n-cursor lint k8s`.

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- Свідомо пропускає шляхи: `.github`, `.git`.
