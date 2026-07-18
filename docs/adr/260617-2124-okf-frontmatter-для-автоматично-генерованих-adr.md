---
type: ADR
title: OKF v0.1 frontmatter для автоматично-генерованих ADR
description: ADR-нормалізація генерує OKF-сумісний frontmatter з type: ADR поверх MADR body.
---

**Status:** Accepted
**Date:** 2026-06-17

## Context and Problem Statement

Автоматично нормалізовані ADR у clean-стані не мали YAML frontmatter, тоді як OKF v0.1 §9 вимагає parseable YAML frontmatter з непорожнім полем `type` у кожному `.md` файлі. Через це `docs/adr/*.md` не відповідали OKF v0.1 conformance, хоча тіло ADR лишалося MADR-сумісним.

## Considered Options

- Додати OKF-сумісний YAML frontmatter у `rewrite`-операції normalize-pipeline.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати OKF-сумісний YAML frontmatter у rewrite-операції", because це відповідає вимозі OKF §9 без зміни структури MADR body.

### Consequences

- Good, because кожен `.md` файл у `docs/adr/` отримує непорожній `type: ADR` і стає сумісним з OKF v0.1 conformance.
- Good, because MADR-секції тіла файлу залишаються без змін.
- Good, because transcript фіксує 14/14 passing tests після зміни.
- Bad, because це відхід від попереднього clean-стану без frontmatter; transcript зазначає, що структурного конфлікту між OKF frontmatter і MADR body немає.
- Neutral, because після `bun n-cursor sync` project copy hook може розсинхронізуватися з template copy, якщо sync перезапише файл без version bump.

## More Information

Змінені файли, згадані в transcript:

- `npm/scripts/lib/adr/normalize-pipeline.mjs`: `GEN_SYS` вимагає OKF frontmatter, `validateMadr()` перевіряє `type: ADR`.
- `npm/.claude-template/hooks/normalize-decisions.sh`: оновлено prompt, додано shell-fallback для OKF frontmatter.
- `.claude/hooks/normalize-decisions.sh`: ті самі зміни у project copy.
- `npm/rules/adr/adr.mdc` і `.cursor/rules/n-adr.mdc`: clean-стан описаний як `OKF v0.1 + MADR body`.
- `npm/scripts/lib/adr/tests/normalize-pipeline.test.mjs`: оновлено тести `validateMadr`.
- `docs/adr/*.md`: 300 clean ADR мігровано, додано `type: ADR` і OKF frontmatter.

Формат, зафіксований у чернетці: `type: ADR`, `title`, `tags: [adr]`, `timestamp` з `captured` або з імені файлу.
