---
type: JS Module
title: main.mjs
resource: npm/rules/k8s/main.mjs
docgen:
  crc: 1caca447
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 85
---

Модуль знаходить унікальні корені каталогів із іменем `k8s` за шляхами файлів `*.yaml` у репозиторії. Якщо таких файлів немає, виконання завершується з кодом 0 без виклику зовнішніх CLI. Для знайдених коренів виконується перевірка YAML-маніфестів. `kubeconform` перевіряє маніфести проти OpenAPI-схем Kubernetes (https://github.com/yannh/kubeconform#readme), використовуючи версію, узгоджену з лінією релізу. `kubescape` сканує маніфести на misconfiguration та відповідність стандартам (NSA, MITRE, CIS), використовуючи конфігураційний файл `.kubescape-exceptions.json`. Орієнтир цільового кластера для `kubescape` визначається за тією ж лінією релізу, що й для `kubeconform`. Обидві утиліти (`kubeconform` та `kubescape`) повинні бути доступні в системному PATH.

## Поведінка

run виконує стандартну перевірку правила.
pathHasK8sSegment визначає, чи містить шлях сегмент директорії `k8s` відносно кореня репозиторію.
k8sRootFromFile знаходить абсолютний шлях до каталогу `…/k8s`, що містить маніфест, виходячи з абсолютного шляху до YAML-файлу.
findK8sRoots знаходить унікальні абсолютні шляхи до каталогів `k8s` за наявності файлів `*.yaml`, ігноруючи шляхи, що починаються з `.github/`.
buildKubescapeExceptionsArgs будує аргументи для `kubescape`, якщо існує файл `.kubescape-exceptions.json` у корені репозиторію.
findKustomizationDirs знаходить абсолютні шляхи до каталогів, що містять білдабельний `kustomization.yaml` у межах каталогу `…/k8s`, виключаючи компоненти (`kind: Component`).
runLintK8s виконує повний цикл перевірки Kubernetes-маніфестів за допомогою `kubeconform` та `kubescape`.
lint делегує виконання повного циклу перевірки Kubernetes-маніфестів функції `runLintK8s`.

## Публічний API

run — виконує перевірку конфігурацій (applies → JS-concerns → policy → mdc-refs) та лінтинг (kubeconform/kubescape).
pathHasK8sSegment — визначає, чи містить шлях сегмент директорії `k8s`.
k8sRootFromFile — знаходить каталог `…/k8s`, що містить маніфест, рухаючись від файлу вгору.
findK8sRoots — збирає список унікальних коренів `k8s`, якщо в поточному каталозі є файли `*.yaml`.
buildKubescapeExceptionsArgs — створює аргументи `--exceptions <file>` для kubescape, якщо існує `.kubescape-exceptions.json` у корені проєкту.
findKustomizationDirs — знаходить каталоги, які є точками входу Kustomize (містять `kustomization.yaml` з `kind: Kustomization`).
runLintK8s — виконує публічну CLI-операцію лінтингу конфігурацій, використовуючи механізм блокування та дедуплікації за станом git-дерева.
lint — слугує оркестратором, який делегує виконання лінтингу конфігурацій (`n-cursor lint k8s`) функції `runLintK8s`.

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- Свідомо пропускає шляхи: `.github`, `.git`.
