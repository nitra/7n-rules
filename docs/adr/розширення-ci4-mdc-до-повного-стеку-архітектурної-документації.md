---
type: ADR
title: "Розширення ci4.mdc до повного стеку архітектурної документації"
---

# Розширення ci4.mdc до повного стеку архітектурної документації

**Status:** Accepted
**Date:** 2026-05-17

## Context and Problem Statement

Правило `ci4.mdc` покривало лише C4 model з базовими принципами Markdown-as-truth (версія 1.0, ~9 KB). Потрібно охопити повний lifecycle: arc42 + Diátaxis + ADR (MADR v4) + C4 як набір нотацій + AUTOGEN-зони + MkDocs Material — так само, як це описано в `npm/rules/adr/adr.mdc` для ADR-потоку.

## Considered Options

* Розширити `ci4.mdc` до повного стеку (arc42 + Diátaxis + AUTOGEN + MkDocs Material)
* Залишити вузьке правило лише про C4
* Розбити на кілька правил

## Decision Outcome

Chosen option: "Розширити `ci4.mdc` до повного стеку", because одне правило `alwaysApply: true` завантажується в кожну сесію і охоплює весь lifecycle від capture ADR до LLM-регенерації проекцій; розбиття на кілька правил збільшило б сумарний контекст і ускладнило навігацію.

### Consequences

* Good, because правило покриває весь lifecycle: capture → normalize → autogen-зони → manifest → MkDocs Material.
* Bad, because розмір `.mdc` зріс з ~9 KB до ~17 KB — більший контекст у кожній сесії з `alwaysApply: true`.

## More Information

- Файл: `npm/rules/ci4/ci4.mdc` (version: 2.0)
- Узгоджено з `npm/rules/adr/adr.mdc`: MADR v4.0.0 minimal, без frontmatter, slug-посилання замість `ADR-NNNN`
- Маршрутизація ADR → зони: через `sources="<slug>"` атрибут у AUTOGEN-маркері + семантичний discovery по розділах `## Context and Problem Statement` + `## Decision Outcome`
- Формат ADR не дублюється — `ci4.mdc` відсилає до правила `adr` як джерела істини
- Backfill legacy docs описаний як: manual → новий accepted ADR через capture-flow → manual замінюється AUTOGEN-зоною
