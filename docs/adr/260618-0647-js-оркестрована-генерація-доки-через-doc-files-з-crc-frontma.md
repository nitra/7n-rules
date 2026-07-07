---
session: 4a973ee4-4770-4098-9a7b-d85ff04df9ef
captured: 2026-06-18T06:47:26+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/4a973ee4-4770-4098-9a7b-d85ff04df9ef.jsonl
---

Let me read the full SKILL.md.
[user]
я про це
[assistant]
[thinking]
The user is saying "я про це" which means "I'm talking about this" - they're confirming they were asking about the `doc-files` orchestrator with CRC-frontmatter. The user wants me to analyze and document the ADR for this design.

Wait, actually I need to re-read the context. The user is the one providing the transcript to analyze and create ADR documentation. So this IS the transcript I'm analyzing, and I need to identify the ADR from this session.

Let me reconsider: Looking at the whole conversation, the user asked about npx documentation generation, we found the `doc-files` skill, and I explained the architecture. The user confirmed "я про це" meaning they were asking about exactly this.

The key design decisions in this session:
1. `doc-files` uses JS orchestration instead of agent dispatch (like the old `n-docgen`)
2. CRC checksums in frontmatter to detect stale docs
3. Local model (omlx) instead of cloud Claude
4. Two CLI commands: `fix-doc-files` (generation) and `lint-doc-files --git` (check)

Now I need to write an ADR in Ukrainian for this design decision.

Actually wait - I'm confused about my role. The system prompt says "You analyze an AI coding session transcript and produce durable decision documentation." And the transcript ends with the user saying "я про це" confirming they understand the doc-files architecture.

So I should produce an ADR based on the design decisions revealed in this session - specifically the design of `doc-files` as a JS-orchestrated documentation generator with CRC frontmatter.
[/thinking]

## ADR JS-оркестрована генерація доки через `doc-files` з CRC-frontmatter

## Context and Problem Statement
Старий skill `n-docgen` диспатчить Claude-субагентів для кожного файлу, тримаючи сотні контекстів одночасно, і не має механізму визначення застарілості — кожен запуск регенерує всі файли. Потрібен підхід, де важкий парсинг і батчинг відбуваються поза агентом, а застарілі доки визначаються автоматично.

## Considered Options
* JS-оркестрований CLI з CRC-гейтом (`doc-files`)
* Agent-оркестрований диспатч субагентів (`n-docgen`)

## Decision Outcome
Chosen option: "JS-оркестрований CLI з CRC-гейтом (`doc-files`)", because JS-команда (`fix-doc-files`) сама обходить файли, батчить, кличе локальну модель і штампує CRC у frontmatter — агент лише запускає команду і читає підсумок, не тримаючи сотні файлів у контексті.

### Consequences
* Good, because агент отримує лише підсумковий рядок, а не сотні шляхів — контекст не розпухає.
* Good, because CRC у frontmatter дозволяє пропускати незмінені файли — повторний запуск ідемпотентний.
* Good, because локальна модель (omlx) замість cloud Claude знижує вартість масових генерацій.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/skills/doc-files/SKILL.md` — опис skill з двома CLI-входами
- `npm/skills/doc-files/meta.json` — метадані skill
- `npm/rules/doc-files/js/docgen-files-batch.mjs` — JS-оркестратор (зазначений у session)
- `docs/specs/2026-06-10-docgen-split-doc-files-doc-aggregate-design.md` — spec-документ дизайну розбивки
- `docs/doc-files-skill.md` — документація skill
- CLI: `npx @nitra/cursor fix-doc-files` (генерація), `npx @nitra/cursor lint-doc-files --git` (гейт перевірки)
