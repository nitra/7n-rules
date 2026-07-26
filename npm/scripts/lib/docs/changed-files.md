---
type: JS Module
title: changed-files.mjs
resource: npm/scripts/lib/changed-files.mjs
docgen:
  crc: 2bf61f5b
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл збирає перелік файлів для quick-режиму lint-оркестратора: змінені та staged через `git diff HEAD`, а також нові untracked через `git ls-files --others --exclude-standard`. Видалені файли не потрапляють у результат.

`collectChangedFiles`, `resolveChangedBase` і `collectChangedFilesSince` потрібні, щоб визначати базу порівняння та повертати лише актуально змінені робочі файли для перевірки. Поза git-репо або при помилці git повертається порожній список.

## Поведінка

`collectChangedFiles` формує scope quick-перевірки з поточного робочого дерева: бере змінені tracked/staged файли відносно `HEAD`, додає нові untracked файли та повертає унікальні relative-posix шляхи без видалених файлів.

`resolveChangedBase` потрібна перед scoped-перевірками, коли scope має рахуватися не лише від `HEAD`, а від інтеграційної бази. Вона визначає досяжний merge-base для поточної гілки: або за явно заданим base ref, або за політикою git-гілок репозиторію. Якщо придатної бази немає, результатом є відсутність бази, і подальший збір змін має перейти до quick-поведінки.

`collectChangedFilesSince` споживає базу з `resolveChangedBase` або її відсутність. За наявної бази вона збирає всі файли, змінені від цієї бази до поточного робочого дерева, включно із закоміченими після бази, staged і незакоміченими змінами, та додає untracked файли. За відсутньої бази делегує збір до `collectChangedFiles`.

Усі результати є списками унікальних шляхів для наступних lint-етапів. Для обох режимів діє спільне правило: видалені файли не потрапляють у scope, а файли всередині службових worktree-чекаутів відкидаються, щоб сесійні копії репозиторію не перевірялися як робочий код. Поза git-репозиторієм або при помилці git звичайний quick-збір повертає порожній список, але scoped-збір із недосяжною базою завершується явною помилкою, щоб перевірка не пройшла з порожнім scope помилково.

## Публічний API

- collectChangedFiles — Relative-posix список змінених + untracked файлів робочого дерева.
- resolveChangedBase — Визначає git base для scoped-перевірок без зовнішнього runtime-стану.
Кандидати — effective Git policy: `baseBranch` + `releaseBranches`, кожна у
`origin/` та локальній формах. Беремо **найновіший** сумісний merge-base; це
захищає від stale-ref і вже інтегрованих змін між довгоживучими середовищами.
Якщо жодного ref немає — null, і caller порівнює лише
робоче дерево з HEAD. Повернений sha завжди досяжний (це merge-base існуючого
ref), тож fail-closed перевірка в `collectChangedFilesSince` не спрацює хибно.
Явний `baseRef` (CI: `--base origin/dev` після fetch) вимикає вибір —
merge-base рахується лише проти нього.
- collectChangedFilesSince — Список змінених + untracked файлів **відносно базового комміту**.

`git diff <base>` (без `..`/`...`, без `HEAD`) порівнює base-комміт із поточним
**робочим деревом** — тобто однаково ловить і закомічене від base, і staged, і
незакомічені модифікації. Це гарантує однакову поведінку незалежно від того, чи
зміни вже закомічені у worktree. Без `base` — fallback на `collectChangedFiles`
(робоче дерево vs HEAD).

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
