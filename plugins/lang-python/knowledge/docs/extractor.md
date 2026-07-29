---
docgen:
  crc: pending
---

## Огляд

`knowledge/extractor.mjs` перетворює Python source-файл на fail-closed normalized fragment для package knowledge graph. Tree-sitter Python WASM розбирає весь файл; syntax error, unsupported wildcard import або збій runtime повертають blocking diagnostic без часткового graph чи fallback.

## Поведінка

Екстрактор виділяє public і private functions, classes та methods, будує стабільні UTF-8 byte spans, chunks і coverage ledger. Calls до однозначного local symbol стають `invokes`, а calls через import binding — `integrates` до opaque contract; кожен edge має source evidence.

## Де використовується

- `plugins/lang-python/package.json` — реєструє versioned `knowledge.extractor@1` provider `knowledge-python`.
- `plugins/lang-python/knowledge/tests/extractor.test.mjs` — перевіряє Tree-sitter contract, unicode spans, units, edges, coverage і fail-closed diagnostics.
