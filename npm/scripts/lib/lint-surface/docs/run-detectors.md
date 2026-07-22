---
type: JS Module
title: run-detectors.mjs
resource: npm/scripts/lib/lint-surface/run-detectors.mjs
docgen:
  crc: e9224e37
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл формує єдину поверхню для `n-rules lint --no-fix`: від discovery правил і вибору меж запуску до виконання `lint` для кожного concern та збору нормалізованих violations. Його результатом є список порушень, який використовує fix-pipeline для подальшої обробки, тоді як сам detect не змінює дерево файлів.

## Поведінка

DEFAULT_RULES_DIR задає базовий корінь правил, від якого стартує discovery, коли споживач не передав власні каталоги.

buildDetectPlan спочатку визначає набір rules-каталогів, потім відбирає лише доступні concern-и з урахуванням capability, далі будує план виконання за режимом прогону: scoped, delta, full або repo-wide. Сам план фіксує, які concern-и запускаються whole-repo, а які лише по перетину з файлами, щоб detect і fix-pipeline працювали з однаковою картиною.

loadEnabledLintRules використовує той самий discovery-ланцюжок, але повертає не план, а повну мапу concern-и за rule-id разом із множиною активних правил. Це потрібно зовнішнім споживачам, які мають знати, що реально доступно для прогону, не запускаючи сам detector-цикл.

computeActiveDomains дає скорочений зріз цієї ж моделі: для заданого набору файлів показує, які rule-id справді активуються хоча б одним per-file concern-ом. Full-scope перевірки тут навмисно не враховуються, бо їхня зона відповідає repo-wide прогону.

detectAll бере готовий план, виконує його, збирає normalized violations і повертає ще й derived exitCode. Увесь шлях read-only: нічого не записує в дерево, не змінює конфіг і не покладається на мутації поза межами збирання результатів. Фільтрація та видимість правил спираються на .n-rules.json, тож саме він визначає, які rules каталоги й concern-и вважаються активними.

## Публічний API

- DEFAULT_RULES_DIR — Цей файл: npm/scripts/lib/lint-surface/run-detectors.mjs → PACKAGE_ROOT = npm (4 dirname угору).
- buildDetectPlan — Будує план прогону для заданих опцій (discovery + scope-table).
Спільне джерело для detect-only і fix-pipeline.
- loadEnabledLintRules — Discovery-фасад для споживачів поза detect/fix-конвеєром (`ci plan`):
concerns за rule-id (ядро + плагіни, capability-фільтр) і set активних правил.
- computeActiveDomains — Активність доменів (rule-id) для заданого файлового набору — єдине джерело
правди для `ci plan`: домен «активний», якщо хоч один його **per-file**
concern тригериться на цих файлах (та сама таблиця planConcernForDelta, що
й `lint <domain> --path` → «plan сказав true» ⇔ «lint щось запустить»).
Правила без жодного per-file concern не потрапляють у результат (їхні
full-scope перевірки — справа `--repo-wide`).
- detectAll — Запускає detect-only прохід. Повертає всі violations і похідний exitCode.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
