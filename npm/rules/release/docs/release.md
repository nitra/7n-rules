---
type: JS Module
title: release.mjs
resource: npm/rules/release/release.mjs
docgen:
  crc: 8042a5fb
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл агрегує per-workspace change-файли у version-bump і `CHANGELOG`, комітить, ставить тег `<name>@<version>` та видаляє використані change-файли. Запускається у CI на `main` за дизайном `n-rules-release-design`, варіант A, і сам нічого не публікує. Публічні функції: `release`, `runReleaseCli`.

## Поведінка

`release` бере корінь репозиторію та дату, читає `package.json` як джерело workspace-метаданих і далі проходить по кожному workspace у порядку, заданому маніфестом. Для кожного workspace він збирає зміни, оновлює версію, дописує відповідний блок до CHANGELOG і прибирає використані change-файли; якщо для workspace немає релевантних змін, він не входить до списку релізу. Після цього `release` синхронізує точний runtime-пін `@7n/rules` із одночасно випущеним `@7n/llm-lib`, щоб transport не лишався на старій транзитивній версії, а потім формує коміт, анотовані теги `<name>@<version>` і, за увімкненого push, доводить release-коміт до апстріму з ретраями на випадок паралельних push у ту саму гілку. Поверненням є лише перелік фактично зрелізованих пакетів; самі артефакти публікації тут не виконуються.

`runReleaseCli` є тонкою CLI-обгорткою над `release`: запускає той самий потік з дефолтними параметрами, а в тестах дозволяє підмінити корінь, дату, git-раннер і режим push. Якщо release завершується без помилки, CLI повертає успішний exit-код; якщо ні — не приховує збій.

## Публічний API

- release — агрегує per-workspace change-файли у version-bump і CHANGELOG, створює commit, ставить тег `<name>@<version>` та видаляє use-up change-файли; спирається на налаштування з package.json.
- runReleaseCli — CLI-entry для запуску `release`, щоб виконати той самий release-сценарій з командного рядка без окремого ручного складання кроків.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
