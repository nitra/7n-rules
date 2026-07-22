---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/test/stryker_config/main.mjs
docgen:
  crc: 13fa6ed0
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Read-only планувальник для `stryker.config.mjs`, Vue-специфічних baseline-ів і `.gitignore`-entries: він не вносить змін, а лише формує violation-и з `data` для T0, щоб окремий `fix-stryker_config.mjs` потім застосував потрібні правки без мутації дерева під час `lint --no-fix`.

У цьому плані використовуються спільні для detector і T0 константи та маршрути: `STRYKER_BASELINE_PATH`, `STRYKER_VUE_BASELINE_PATH`, `STRYKER_VUE_PLUGIN_PATH`, `VITEST_BASELINE_PATH`, `STRYKER_CONFIG_MISSING`, `STRYKER_VUE_AUGMENT`, `STRYKER_VUE_AUGMENT_FAIL`, `GITIGNORE_MISSING`, `GITIGNORE_SECTION_LABEL`, `planVueAugment`, `planStrykerActions`, `lint`.

Для Vue-root’ів він окремо розрізняє відсутність файлів і безпечний augment уже наявного `stryker.config.mjs`, а шляхи `.git` і `node_modules` свідомо пропускає.

Поводиться fail-safe: помилки не викидає назовні.

## Поведінка

Планування стартує з `planStrykerActions`: воно читає `mutation.json` і `package.json`, визначає набір js-root’ів і для кожного збирає read-only план baseline/augment-дій без змін у дереві. На цьому ж етапі формується перевірка `.gitignore`; відсутні entries групуються під `GITIGNORE_MISSING`, а маркер секції в `.gitignore` фіксується як `GITIGNORE_SECTION_LABEL` (`Test artifacts: Stryker + coverage (test.mdc)`).

Для кожного js-root `planStrykerActions` спершу планує базовий `STRYKER_BASELINE_PATH` для `stryker.config.mjs`, а для Vue-root’ів додатково `STRYKER_VUE_BASELINE_PATH` і `STRYKER_VUE_PLUGIN_PATH`, якщо потрібні файли ще відсутні. Якщо `vitest`-конфіг уже є у старому `.js`-вигляді, план зберігає backward-compat через `VITEST_BASELINE_PATH` і не плодить новий `.mjs`-файл без потреби. Шляхи `.git` і `node_modules` свідомо пропускаються.

Коли у Vue-root уже існує `stryker.config.mjs`, `planVueAugment` аналізує його стан і, якщо бракує Vue-специфічної підтримки, додає окрему дію `STRYKER_VUE_AUGMENT`. Якщо augment неможливий або небезпечний для файлу, це фіксується як `STRYKER_VUE_AUGMENT_FAIL`. Обчислений план залишається read-only; вихідні дані йдуть у violation-репорт, а не в запис.

`lint` лише запускає `planStrykerActions` і переводить знайдений план у pass/fail-звіт. Якщо є розбіжності, репорт містить повідомлення з маркером `` і дані для T0-fix; якщо змін не потрібно, перевірка проходить без мутацій.

## Публічний API

- STRYKER_BASELINE_PATH — Абсолютний шлях canonical stryker-baseline (non-Vue варіант).
- STRYKER_VUE_BASELINE_PATH — Абсолютний шлях canonical stryker-baseline для Vue-root (plugins/ignorers включено).
- STRYKER_VUE_PLUGIN_PATH — Абсолютний шлях canonical vue-macros ignorer-плагіна (копіюється у Vue-root).
- VITEST_BASELINE_PATH — Абсолютний шлях canonical vitest-baseline (пара до stryker-baseline).
- STRYKER_CONFIG_MISSING — Стабільний reason: відсутній stryker/vitest baseline-файл (baseline-copy дія).
- STRYKER_VUE_AUGMENT — Стабільний reason: у наявному Vue stryker-конфізі не зареєстровано vue-macros ignorer.
- STRYKER_VUE_AUGMENT_FAIL — Стабільний reason: augment неможливий (non-literal export / динамічні plugins) — правити вручну.
- GITIGNORE_MISSING — Стабільний reason: у кореневому `.gitignore` бракує тест-патернів.
- planVueAugment — Augment-крок для вже-існуючого `stryker.config.mjs` у Vue JS-root:
реєструє локальний `vue-macros` ignorer-плагін (`plugins`/`ignorers`), якщо
його ще немає. Закриває drift-hole для проєктів, які мали non-vue config ще
до 3.x Vue-підтримки — `ensureBaselineFile` такий файл idempotent-skip-ить,
тож baseline-секцій `plugins`/`ignorers` він мовчки не отримує, і Stryker
падає у dry-run з `defineProps()` error.

Стратегія: oxc-parser — лише для **аналізу** (де у source-тексті
default-export object, які properties/offsets уже є). Зміни — точкові
string-splice-и у вихідному тексті (insert items), щоб НЕ переписати
форматування й коментарі користувача (oxc serializer їх не зберігає). Після
splice — повторний parse: якщо результат не компілюється → відкат і fail.
- GITIGNORE_SECTION_LABEL — Header-коментар для секції тест-артефактів у `.gitignore`.
- planStrykerActions — Чистий планувальник (read-only): обчислює всі потрібні зміни для stryker_config
без жодного запису. Спільний для detector-а (→ violations) і T0-fix (→ writes).
- lint — Виконує планувальник і транслює план у pass/fail-звіт лінту.

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- Свідомо пропускає шляхи: `.git`, `node_modules`.
