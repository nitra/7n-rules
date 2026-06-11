---
docgen:
  source: npm/rules/capacitor/js/platforms.mjs
  crc: eb8d6293
  score: 100
---

# platforms.mjs

## Огляд

Модуль інспектує та збирає дані конфігурацій Capacitor для оцінки сумісності версій. Він використовується для перевірки наявності та відповідності версій Capacitor, необхідних для коректної роботи з iOS-проєктами. Функції, такі як `collectCapacitorDataFromAllPackageJson`, забезпечують збір необхідної інформації. Модуль спирається на конфігурації, визначені у файлі `.config.json`. Функція `check` та `isCapacitorRelevantForCheck` застосовуються для визначення релевантності конфігурації. (capacitor.mdc)

## Поведінка

capacitorSegmentMinMajor
Витягує мінімальний мажорний номер з частини діапазону npm версій

capacitorVersionRangeMinMajor
Обчислює мінімальний мажорний номер для повного діапазону npm версій з урахуванням `||`

isCapacitorCoreVersionAtLeast8
Перевіряє, чи нижня межа версії Capacitor є більшою або дорівнює заданому мінімуму

recordCapacitorFromOnePackageJson
Записує інформацію про залежності Capacitor у накопичувач

collectCapacitorDataFromAllPackageJson
Рекурсивно шукає та збирає інформацію про залежності Capacitor з усіх `package.json` у репозиторії

hasCapacitorConfigInRoot
Перевіряє наявність конфігураційних файлів Capacitor у корені репозиторію

isCapacitorRelevantForCheck
Визначає, чи потрібно застосовувати перевірку Capacitor на основі наявності конфігурації або залежностей

walkIosForPodfileSkipPods
Рекурсивно шукає файли `Podfile` у каталозі `ios`, ігноруючи папки `Pods`, `build` та `DerivedData`

findFirstPodfileUnderIosExcludingPods
Шукає перший знайдений `Podfile` у каталозі `ios`, ухиляючись від кешу CocoaPods

nitrAObjectAllowsIosCocoaPods
Перевіряє, чи дозволяє об'єкт `nitra` використання `Podfile` на iOS через спеціальні прапори

extractNitraObjectBodySource
Витягує текст тіла об'єкта `{...}` після маркера `nitra:` у конфігураційному файлі

nitraObjectBodyStringAllowsCocoaPodsExempt
Перевіряє, чи містить витягнутий текст виняток, який дозволяє пропуск аналізу SPM

pathJsonShowsNitraCocoapodsExempt
Перевіряє, чи містить об'єкт `nitra` у JSON-файлі виняток, який дозволяє пропуск аналізу SPM

capacitorConfigTsMjsNitraCocoapodsExempt
Перевіряє, чи містить конфігураційні файли `.ts` або `.mjs` виняток, який дозволяє пропуск аналізу SPM

isIosCocoaPodsExemptByNitraConfig
Перевіряє, чи дозволяє конфігурація `nitra` використання `Podfile` на iOS

check
Виконує повну перевірку конфігурації Capacitor, включаючи перевірку залежностей та налаштувань iOS

Повертає помилку, якщо не знайдено необхідної залежності `@capacitor/core` з версією, сумісною з `MIN_CAPACITOR_MAJOR`

Повертає помилку, якщо знайдено `Podfile` на iOS, який не дозволяє використання CocoaPods без винятку `nitra`

## Публічний API

capacitorSegmentMinMajor — визначає нижню межу для однієї частини діапазону npm.
capacitorVersionRangeMinMajor — визначає мінімальну можливу (нижню) major-версію для повного діапазону npm, включаючи `||`.
isCapacitorCoreVersionAtLeast8 — перевіряє, чи відповідає версія ядру Capacitor мінімальному рівню 8.
recordCapacitorFromOnePackageJson — записує дані Capacitor з одного файлу `package.json`.
collectCapacitorDataFromAllPackageJson — збирає дані Capacitor з усіх `package.json` у дереві, накопичуючи `byPath` та `anyCapacitor`.
hasCapacitorConfigInRoot — перевіряє наявність конфігурації Capacitor у кореневому файлі.
isCapacitorRelevantForCheck — визначає, чи слід застосовувати правила, залежно від наявності конфігу або `@capacitor/` у залежностях.
walkIosForPodfileSkipPods — рекурсивно шукає `Podfile` у директорії `ios/`, ігноруючи директорії `Pods` (кеш CocoaPods) та типові build-каталоги.
findFirstPodfileUnderIosExcludingPods — знаходить перший `Podfile` у директорії `ios/`, пропуская директорії `Pods`.
nitrAObjectAllowsIosCocoaPods — перевіряє, чи дозволяє об’єкт `nitra` використовувати `Podfile` (CocoaPods) на iOS (див. (capacitor.mdc); `@nitra/SPM` не аналізується).
check — виконує загальну перевірку.

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За невдалої перевірки повертає `false`/`null` замість винятку.
- Кешує результати в межах одного прогону.
- Свідомо пропускає шляхи: `.git`, `node_modules`.
- Не звертається до мережі.
