---
type: ADR
title: Google OKF як формат для документації в docs
description: Документація в docs переходить до OKF-сумісного Markdown з YAML frontmatter і єдиним бандлом docs.
---

**Status:** Accepted
**Date:** 2026-06-17

## Context and Problem Statement

Документація у `docs/` зберігалася у Markdown без стандартизованого YAML frontmatter і без маніфесту бандлу. Через це LLM-агенти не мали OKF-сумісного способу навігації документацією. Google Cloud опублікував Open Knowledge Format v0.1 як Markdown-специфікацію з YAML frontmatter і `_index.md` або індексною точкою входу для структурованого контексту.

Під час введення OKF також виникло питання: робити окремий бандл для `docs/adr/` чи включити ADR у єдиний бандл `docs/`.

## Considered Options

- Прийняти OKF для документації: додати YAML frontmatter до doc-files, ADR і ci4-документації та додати маніфест або індекс для `docs/`.
- Єдиний бандл `docs/` з одним входом для всієї документації.
- Окремий бандл `docs/adr/` з власним індексом.

## Decision Outcome

Chosen option: "Прийняти OKF і використовувати єдиний бандл `docs/`", because користувач поставив задачу зробити ci4-документацію та doc-files сумісними з OKF, а окремий бандл для ADR у transcript названий надлишковим.

### Consequences

- Good, because LLM-агенти зможуть навігувати `docs/` через OKF-сумісні метадані та індексну точку входу.
- Good, because один бандл `docs/` автоматично охоплює `docs/adr/*.md` без додаткової інфраструктури.
- Bad, because transcript не містить підтверджених негативних наслідків для єдиного OKF-бандлу.
- Neutral, because точний мінімальний набір OKF-полів для різних типів документів уточнюється в наступних рішеннях цього батчу.

## More Information

У transcript згадані OKF-поля: `title`, `description`, `type`, `topics`, `audience`, `updated`, `version`. Для ADR окремо зафіксовано, що clean-файли вже частково сумісні через YAML frontmatter, але потребують OKF `type`.

Файли або області для зміни, згадані в transcript: `.cursor/rules/n-ci4.mdc`, `docs/doc-files-skill.md`, шаблони `n-docgen`, `docs/_index.md` або індексна точка входу для `docs/`.

## Update 2026-06-17

Уточнено початковий драйвер рішення: користувач явно хотів оновити файли, які генерує `doc-files`, під сумісність з OKF після ознайомлення з публікацією Google Cloud про Open Knowledge Format.

Додатковий факт з transcript: поточні згенеровані файли `docs/app.md`, `docs/eslint.config.md`, `docs/fix-cursor-skill.md`, `docs/coverage-fix-skill.md`, `docs/doc-files-skill.md` не мали OKF YAML frontmatter.

Відкрите питання на той момент: чи стандартні `[text](path.md)` посилання OKF ламають Marksman wiki-link (`[[link]]`) навігацію; transcript цієї чернетки не містить відповіді.

## Update 2026-06-17

Зафіксовано мінімальну інтерпретацію OKF v0.1 conformance: кожен `.md` файл має parseable YAML frontmatter і непорожнє поле `type`.

Для ADR мінімальна OKF-зміна на цьому етапі сформульована як frontmatter з `type: ADR` і `title`; `description` можна брати з першої фрази context, а `resource` для ADR не потрібне.
