---
type: Rust Module
title: gap_mappings.rs
resource: crates/rules-docs/src/gap_mappings.rs
docgen:
  crc: 81eb0a0a
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 80
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Comparator expected↔implemented claims — порт `gap-mappings.mjs`.  Точні канонічні збіги вирішуються локально й моделі не коштують; до неї йдуть лише non-exact кандидати ТОГО САМОГО субʼєкта. Невизначеність лишається явним `unresolved`, а не тихо стає «missing» — інакше gap-engine рапортував би прогалину там, де просто забракло доказів.

## Публічний API

- Diagnostic — Блокувальна діагностика comparator-а.
- Mapping — Evidence-backed звʼязка між expected і implemented claim-ами — вхід gap-engine.
- GapMappingOutcome — Результат comparator-а.
- GapMappingInput — Вхід comparator-а.
- Comparison — Прийнята comparator-ом звʼязка одного кандидата.
- ParsedComparison — Розібрана відповідь comparator-а.
- create_gap_mapping_cache_key — Cache-ключ порівняння — порт `createGapMappingCacheKey`.
- parse_gap_mapping_result — Парсить строгу відповідь comparator-а — порт `parseGapMappingResult`.  Чужий `implementedClaimId`, невідома звʼязка чи два різні relation в одній відповіді — не «часткова правда», а відмова: перші два блокують, останнє стає явним `unresolved`.  # Errors Машинний код причини — він же йде в діагностику.
- compare_claim_mappings — Порівнює expected claims із AS-IS claims — порт `compareClaimMappings`.  Точка інтеграції runner-а: після entailment і перед `evaluateGaps`; `mappings` та `unresolved_expected_claim_ids` йдуть у gate.  # Errors Помилка вводу-виводу кешу — fail-closed.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
- Кешує результати в межах одного прогону.
