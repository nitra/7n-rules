---
type: ADR
title: "Нормалізація Плейсхолдера Паролів: `secret` → `sample-secret`"
---

# Нормалізація Плейсхолдера Паролів: `secret` → `sample-secret`

**Status:** Accepted
**Date:** 2026-05-20

## Context and Problem Statement

Проєкт використовував голий рядок `secret` як placeholder у прикладних файлах (`.env.example` тощо). TruffleHog фільтрує `secret` лише через вшитий `fp_words.txt` — поведінка версієзалежна та крихка. TruffleHog не дозволяє розширити список false-positives через зовнішній конфіг (`fp_words.txt` вбудований через `//go:embed`).

## Considered Options

- Додати `secret` у whitelist TruffleHog-конфігу (`--config` / `exclude-paths`)
- Ввести правило нормалізації `secret` → `sample-secret` і закріпити перевіркою

## Decision Outcome

Chosen option: "Ввести правило нормалізації `secret` → `sample-secret`", because рядок `sample-secret` містить підрядок `sample`, який є у вбудованому `DefaultFalsePositives` у `pkg/detectors/falsepositives.go`, тому фільтрація гарантована незалежно від версії TruffleHog; голий `secret` є trigger-keyword для детекторів і фільтрується лише через `fp_words.txt` — крихка версієзалежна поведінка.

### Consequences

- Good, because `sample-secret` фільтрується TruffleHog за дизайном (підрядок `sample` у `DefaultFalsePositives`), а не випадково — стабільна поведінка між версіями.
- Bad, because перехід потребує масової заміни `secret` → `sample-secret` у наявних прикладних файлах репозиторіїв.

## More Information

- `pkg/detectors/falsepositives.go` (TruffleHog): містить `DefaultFalsePositives` з `"sample"`, `"example"` тощо.
- Вбудовані словники: `fp_words.txt`, `fp_badlist.txt`, `fp_programmingbooks.txt`, `fp_uuids.txt` (embed у бінарнику, не розширюються через `--config`).
- TruffleHog `--exclude-paths` / inline-виключення — альтернативний варіант ізоляції без нормалізації, не обраний.
- Планується оформлення як `.cursor/rules/*.mdc` правило (lint/fix-перевірка на голий `secret` у місцях паролів).

## Update 2026-05-20

### Обмеження перевірки `sample_secret` лише прикладними файлами та позицією значення

Chosen option: "Лише прикладні файли" + "лише у позиції значення", because прикладні файли — єдине місце, де placeholder у credential-значеннях є навмисним і підпадає під TruffleHog-сканування; перевірка лише value-позиції мінімізує хибні спрацювання у ключах (`SECRET_KEY`, `DB_SECRET_NAME` тощо) та документації.

- Good, because 41 прикладний файл репозиторію пройшов перевірку без хибних спрацювань.
- Bad, because transcript не містить підтверджених негативних наслідків.

Фільтр за іменем файлу в `check.mjs`: glob-маски `*.example`, `*.sample`, `*.template`, `*.dist`, `__fixtures__/`, `fixtures/`. Regex для value-позиції охоплює формати `.env` (`KEY=secret`), YAML (`key: secret`), JSON (`"key": "secret"`). Нове правило: `npm/rules/security/fix/sample_secret/check.mjs`, `check.test.mjs`. Документовано в `npm/rules/security/security.mdc`. CHANGELOG версія `1.13.58`.
