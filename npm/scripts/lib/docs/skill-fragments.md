---
type: JS Module
title: skill-fragments.mjs
resource: npm/scripts/lib/skill-fragments.mjs
docgen:
  crc: f2285520
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
---

## Огляд

Фрагменти SKILL.md від плагінів (Фаза 2, spec
2026-07-27-universal-plugin-slots-lang-php-extraction — переведено на slot bus, §5.1.9).

Плагін декларує contribution слоту `skills.fragment@1` (`id` = skillId, `resource` →
власний `skills/<skillId>/SKILL.fragment.md` — власну секцію скіла, напр. Rust-гілку taze).
Під час синку скіла ядро доклеює фрагменти АКТИВНИХ contributions до скопійованого
`SKILL.md` між стабільними маркерами — ре-синк ідемпотентний: наявний блок замінюється
повністю, без активних фрагментів — видаляється. Так мовні знання їдуть разом із кодом
плагіна, а не сиротіють у ядрі.

## Публічний API

- FRAGMENTS_START — Маркер початку блоку плагінних фрагментів (стабільний).
- FRAGMENTS_END — Маркер кінця блоку плагінних фрагментів.
- collectSkillFragments — Збирає фрагменти скіла зі slot graph (у порядку графа — resolved plugin order → manifest
order). Contribution `id` слоту `skills.fragment@1` — це і є `skillId` (envelope вимагає
рівно одне з `resource`/`value`, тож окремого поля для skillId у payload нема, spec §5.2).
- injectSkillFragments — Вшиває блок фрагментів у текст SKILL.md (перед фінальним переносом рядка).
Наявний блок між маркерами замінюється; порожній список фрагментів — блок
прибирається зовсім.

## Сценарії використання

- `npm/scripts/lib/tests/skill-fragments.test.mjs` (collectSkillFragments; injectSkillFragments) — збирає фрагменти активних плагінів у порядку графа; порожній фрагмент — ігнорується; плагін без жодного skills.fragment contribution — не впливає на результат; доклеює блок у кінець з маркерами плагінів; ре-синк ідемпотентний: блок замінюється, не дублюється; ще 2

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
