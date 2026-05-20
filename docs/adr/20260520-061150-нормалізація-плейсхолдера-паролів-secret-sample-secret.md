---
session: 4e002ac8-4d4d-43da-a6cd-e02a410a7858
captured: 2026-05-20T06:11:50+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/4e002ac8-4d4d-43da-a6cd-e02a410a7858.jsonl
---

---

## ADR Нормалізація плейсхолдера паролів: `secret` → `sample-secret`

## Context and Problem Statement
У проєкті як плейсхолдер для паролів використовується рядок `secret`. Питання в тому, чи залишити `secret` і додати його у whitelist TruffleHog-конфіга, чи замінити на `sample-secret` через правило нормалізації — щоб TruffleHog гарантовано ігнорував фейковий пароль і не залежати від версієзалежних словників.

## Considered Options
* Додати `secret` у TruffleHog-конфіг як false-positive whitelist
* Ввести правило нормалізації `secret` → `sample-secret`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Ввести правило нормалізації `secret` → `sample-secret`", because `sample-secret` містить підрядок `sample`, що є частиною вшитого `DefaultFalsePositives` у `pkg/detectors/falsepositives.go` і гарантовано фільтрується TruffleHog незалежно від версії. Голий `secret` є trigger-keyword для детекторів і фільтрується лише через `fp_words.txt` — вшитий словник у бінарнику, що є крихкою версієзалежною поведінкою. TruffleHog не дозволяє розширити false-positive список через `--config`.

### Consequences
* Good, because `sample-secret` фільтрується за дизайном (підрядок `sample` у `DefaultFalsePositives`), а не випадково — стабільна поведінка між версіями TruffleHog.
* Bad, because правило нормалізації потребує разового масового заміна `secret` → `sample-secret` у наявних файлах проєкту.

## More Information
- `pkg/detectors/falsepositives.go` — вшиті `DefaultFalsePositives`: `example`, `xxxxxx`, `aaaaaa`, `abcde`, `00000`, `sample`, `*****`
- Вбудовані словники: `fp_words.txt`, `fp_badlist.txt`, `fp_programmingbooks.txt`, `fp_uuids.txt` (embed у бінарнику, не розширюються через `--config`)
- Планується оформлення як `.cursor/rules/*.mdc` правило (lint/fix-перевірка на голий `secret` у місцях паролів)
- TruffleHog `--exclude-paths` / inline-виключення — альтернативний варіант ізоляції без нормалізації, не обраний
