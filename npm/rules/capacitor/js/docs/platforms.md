---
type: JS Module
title: platforms.mjs
resource: npm/rules/capacitor/js/platforms.mjs
docgen:
  crc: d102129c
  score: 85
---

Огляд

Цей файл містить інструменти для витягування та перевірки версій Capacitor з залежностей та конфігурацій. Використовується для визначення сумісності версій Capacitor з конфігураціями, а також для збору даних про версії з різних файлів.

## Поведінка

capacitorSegmentMinMajor
Витягує мінімальну мажорну версію з частини діапазону npm версії

capacitorVersionRangeMinMajor
Витягує мінімальну мажорну версію з повного діапазону npm версії

isCapacitorCoreVersionAtLeast8
Перевіряє, чи нижня межа версії Capacitor ≥ мінімальної версії

recordCapacitorFromOnePackageJson
Записує дані Capacitor з об'єкта з залежностей у накопичувач

collectCapacitorDataFromAllPackageJson
Зчитує дані Capacitor з усіх package.json у дереві

hasCapacitorConfigInRoot
Перевіряє наявність конфігурації Capacitor у корені

isCapacitorRelevantForCheck
Визначає, чи потрібно застосовувати перевірку Capacitor

walkIosForPodfileSkipPods
Рекурсивно шукає Podfile у каталозі ios, ігноруючи Pods та build

findFirstPodfileUnderIosExcludingPods
Знаходить перший Podfile у каталозі ios, усуваючи Pods

nitrAObjectAllowsIosCocoaPods
Перевіряє, чи дозволяє об'єкт nitra використання Podfile

check
Запускає перевірку відповідності версій Capacitor та конфігурації

reportOneCapacitorCoreRange
Друкує повідомлення про сумісність версії Capacitor з (capacitor.mdc)

recordCapacitorFromDependencyObject
Записує дані Capacitor з об'єкта з залежностей у накопичувач

## Публічний API

capacitorSegmentMinMajor — визначає найнижчу межу для однієї частини діапазону npm.
capacitorVersionRangeMinMajor — визначає найнижчу можливу версію major для повного діапазону npm, включаючи `||`.
isCapacitorCoreVersionAtLeast8 — перевіряє, чи версія Capacitor Core становить мінімум 8.
recordCapacitorFromOnePackageJson — записує дані Capacitor з одного файлу package.json.
collectCapacitorDataFromAllPackageJson — зчитує всі package.json з дерева, збирає byPath та anyCapacitor.
hasCapacitorConfigInRoot — перевіряє наявність конфігурації Capacitor у кореневому файлі.
isCapacitorRelevantForCheck — визначає, чи слід використовувати правила, залежно від конфігу або `@capacitor/` у залежностях.
walkIosForPodfileSkipPods — рекурсивно шукає Podfile у ios/, ігноруючи Pods та типові build-каталоги.
findFirstPodfileUnderIosExcludingPods — знаходить перший Podfile у ios/, виключаючи Pods.
nitrAObjectAllowsIosCocoaPods — перевіряє, чи дозволяє об'єкт nitra використовувати Podfile на iOS (див. capacitor.mdc та @nitra/).
check — виконує перевірку.

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За невдачі повертає значення помилки (`false`/`null`/`Err`) замість генерування винятку чи паніки.
- Свідомо пропускає шляхи: `.git`, `node_modules`.
- Не звертається до мережі.
