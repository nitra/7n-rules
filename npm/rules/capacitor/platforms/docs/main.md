---
type: JS Module
title: main.mjs
resource: npm/rules/capacitor/platforms/main.mjs
docgen:
  crc: a25bb28b
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 95
---

## Огляд

Текстура поведінки описує процес аналізу та валідації конфігураційних даних, що стосуються Capacitor. Код зчитує дані з `package.json` та конфігураційного файлу `capacitor.config.json` (маркер `capacitor.mdc`), а також здійснює перевірки на відповідність версій (наприклад, `capacitorSegmentMinMajor`, `isCapacitorCoreVersionAtLeast8`). Система шукає відповідні конфігурації в корені проєкту (`hasCapacitorConfigInRoot`) та може аналізувати структури iOS (через `walkIosForPodfileSkipPods` та `findFirstPodfileUnderIosExcludingPods`, якщо `nitrAObjectAllowsIosCocoaPods` дозволено). Будь-який процес перевірки, включаючи роботу з пакетами, виконується без викиду винятків; на випадок помилки замість збою повертається порожнє значення (наприклад, `null`).

## Поведінка

Поведінка:
capacitorSegmentMinMajor вибирає мінімальну мажорну версію окремого сегмента діапазону версій npm.
capacitorVersionRangeMinMajor обчислює мінімальну мажорну версію для повного діапазону версій npm.
isCapacitorCoreVersionAtLeast8 визначає, чи відповідає мінімальна мажорна версія `@capacitor/core` встановленому порогу.
recordCapacitorFromOnePackageJson зчитує `package.json` та реєструє інформацію про залежності Capacitor.
collectCapacitorDataFromAllPackageJson рекурсивно збирає дані про залежності Capacitor з усіх `package.json` у проєкті, ігноруючи `.git`, `node_modules`.
hasCapacitorConfigInRoot перевіряє наявність файлів конфігурації Capacitor у корені репозиторію.
isCapacitorRelevantForCheck визначає, чи необхідно запускати перевірку Capacitor, на основі наявності конфігу чи залежностей.
walkIosForPodfileSkipPods рекурсивно шукає `Podfile` у каталозі `ios`, оминаючи папки `.Pods` та `build`.
findFirstPodfileUnderIosExcludingPods шукає відносний шлях до першого знайденого `Podfile` у каталозі `ios`.
nitrAObjectAllowsIosCocoaPods перевіряє, чи дозволяє об'єкт `nitra` використання CocoaPods на iOS.
main виконує основну логіку перевірки сумісності Capacitor з `capacitor.mdc`, аналізуючи залежності та конфігурації.

## Публічний API

Я готовий. Я буду працювати як технічний письменник, створюючи лаконічну поведінкову документацію до коду українською мовою у чистому Markdown, дотримуючись усіх ваших обмежень.

Будь ласка, надайте мені код або опис, який потрібно документувати.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
- Свідомо пропускає шляхи: `.git`, `node_modules`.
