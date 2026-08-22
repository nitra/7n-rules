---
type: Rust Module
title: retrieval.rs
resource: crates/rules-adr/src/retrieval.rs
docgen:
  crc: b365f191
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 80
---

## Огляд

cspell:ignore яіїєґ Jaccard прийнят прийн зроблен слаг капчерний stopwords vibir servera капчера zovsim inshe vybir Stage 0 — лексичний retrieval (без LLM): токенізація, Jaccard, кандидати-ребра, заголовок драфта, no-decision гейт. Порт `normalize-pipeline.mjs` (розділ «Stage 0: retrieval»).

## Публічний API

- strip_adr_name — Назва clean-ADR → людський заголовок (без `.md` і timestamp-префікса) — порт `stripAdrName`.
- tokenize — Токенізує назву/слаг у множину значущих токенів — порт `tokenize`.
- jaccard — Jaccard-схожість двох множин токенів — порт `jaccard`.
- draft_title — Витягує заголовок драфта — порт `draftTitle`: рядок капчера `## ADR <title>` у пріоритеті, fallback — перший h1, що не є MADR-секцією, інакше ''.
- is_no_decision — Детермінований no-decision гейт — порт `isNoDecision`: чернетка, де в `Decision Outcome` рішення явно не прийняте, не варта окремого ADR.
- Edges — Ребра-кандидати retrieval-у.
- build_edges — Порт `buildEdges` з дефолтами `simThreshold: 0.12`, `topKClean: 3`.
- capture_field — `captured`-frontmatter-поле драфта — порт `captureField(body, 'captured')`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
