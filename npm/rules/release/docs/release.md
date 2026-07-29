---
type: JS Module
title: release.mjs
resource: npm/rules/release/release.mjs
docgen:
  crc: 9fe77ef9
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`n-rules release` агрегує per-workspace change-файли у version-bump і `CHANGELOG`, комітить результат, ставить тег `<name>@<version>` та видаляє use-up change-файли. Саме ця поведінка визначає релізний потік для `release` і `runReleaseCli` у CI на `main`, згідно з `n-rules-release-design` (варіант A). Сам `release` нічого не публікує.

## Поведінка

`release` зчитує workspace-маніфести з `package.json`, збирає для кожного набір change-файлів, визначає підсумковий bump і, якщо є що випускати, оновлює version у маніфесті, додає запис у CHANGELOG, прибирає використані change-файли та накопичує список реально релізнутих workspace-ів.

Після проходу по workspace-ах `release` окремо синхронізує exact pin для `@7n/rules` із одночасно випущеним `@7n/llm-lib`; якщо `llm-lib` з’явився без rules, вона примусово створює patch-реліз rules, щоб не лишати дрейф версій між ними в наступних релізах.

Коли зміни зібрано, `release` формує commit-back і annotated tags для всіх релізнутих пакетів, а за ввімкненого push намагається доставити їх в upstream із ретраями на паралельні пуші. Якщо push не відбувся або rebase не вдався, реліз не вважається успішно приземленим.

`runReleaseCli` запускає той самий потік як CLI-обгортку без власних опцій, а після успішного завершення віддає GitHub Actions лише фактично релізнуті workspace-и, щоб publish-кроки не торкалися пакетів без нової версії.

## Публічний API

- release — агрегує per-workspace change-файли у version-bump і CHANGELOG, створює коміт, ставить тег `<name>@<version>` та видаляє use-up change-файли.
- runReleaseCli — CLI entrypoint для запуску релізного процесу в CI на `main`; сам нічого не публікує.

Конфіги, на які спирається код: package.json

## Сценарії використання

- `npm/rules/release/tests/release.test.mjs` (release; runReleaseCli) — бампить version, дописує CHANGELOG, видаляє change-файли, планує тег; push: false — комітить і тегує локально, але не пушить (CI пушить сам після publish); нуль change-файлів і нуль fallback-комітів → нічого не релізить; python workspace: бампить [project].version у pyproject.toml; кілька workspace: обидва бампляться, два теги, один commit; ще 15

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
