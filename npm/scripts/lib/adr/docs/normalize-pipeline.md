---
type: JS Module
title: normalize-pipeline.mjs
resource: npm/scripts/lib/adr/normalize-pipeline.mjs
docgen:
  crc: 3da51ad0
  model: litellm/gemma-4-26b-awq
  tier: local-min
  score: 80
---

## Огляд

ADR normalize — локально-орієнтований конвеєр (інверсія керування: JS оркеструє,
LLM відповідає лише на вузькі verifiable-питання). Альтернатива single-shot-у
normalize-decisions.sh, заточена під малу локальну модель (omlx/gemma-4b).

Принцип: модель НІКОЛИ не приймає глобальних рішень, не повертає великих
структур і НЕ форматує. Глобальний стан (кластери, слаги, покриття) та весь
MADR-каркас (заголовок, Status/Date, назви секцій, fallback-фрази, шаблон
"Chosen option…") тримає JS. Модель повертає лише вузький, verifiable зміст:
  - судить пару записів бінарно «те саме рішення? так/ні» (Stage 1),
  - для ізольованого драфта каже standalone/trivial (Stage 1b),
  - витягує зміст секцій одного драфта як JSON (Stage 2) — каркас будує JS,
  - пише short merge-additions без заголовка (Stage 3) — «## Update <date>» додає JS.

Стадії:
  0. retrieval (JS)   — лексична схожість → кандидати-ребра draft↔draft / draft↔clean
  1. edge-judge (LLM) — бінарне same/different по кожному ребру (self-consistency)
  1b. kind-judge(LLM) — standalone vs trivial для драфтів без ребер
  ── cluster (JS)     — union-find по підтверджених ребрах, вибір anchor, призначення op
  2. gen-MADR         — LLM витягує секції-JSON → assembleMadr() (JS) збирає канон → validation gate
  3. gen-merge        — LLM пише additions-прозу → JS додає «## Update <date>»-заголовок
  ── assemble (JS)    — operations[] у форматі, сумісному з apply-ops

Повертає той самий operations[]-контракт, що й single-shot — apply-логіка спільна.

Batch-хвилі (уніфікація на `@7n/llm-lib/batch`, спека
`docs/specs/2026-07-27-batch-local-avg-real-batches.md`, кластер E): кожна
LLM-стадія — ОДИН `submitBatch`-виклик на ВСІ незалежні items стадії
(усі ребра Stage 1, усі self-consistency голоси, усі драфти Stage 1b/2/3)
замість послідовного `for`-циклу з await на кожен виклик. Стадії лишаються
послідовними МІЖ собою (Stage 1b/2/3 читають рішення, обчислені з
результатів Stage 1) — паралелиться лише ВСЕРЕДИНІ стадії.

Спрощення проти попереднього послідовного шляху (задокументовано, не
випадковість): `callWithCascade` робив до 2-3 локальних СПРОБ ОДНОГО tier1
перед хмарною ескалацією; тут — рівно один tier1-прохід на стадію, і лише
ті items, чия tier1-відповідь не розпарсилась, ідуть у хмарну хвилю (якщо
`allowCloud`). Це той самий tier1→tier2→conservative-fallback каскад, без
повтору tier1 перед ескалацією — на великому batch-і агрегована якість
tier1 вже статистично стабільна, а item, що впав, швидше відновлюється
хмарним tier2, ніж повторним локальним проходом.

## Публічний API

- tokenize — Токенізує назву/слаг у множину значущих токенів (kebab + пробіли, без стоп-слів).
- jaccard — Jaccard-схожість двох множин токенів.
- draftTitle — Витягує заголовок драфта. Капчер пише `## ADR <title>` — він у пріоритеті
(чернетка може мати контент-заголовки раніше або взагалі не мати ADR-рядка).
Fallback-и: перший h1, що не є MADR-секцією, інакше '' (caller бере імʼя файлу).
- isNoDecision — Детермінований no-decision гейт (харднінг #1). Чернетка, де у `Decision Outcome`
рішення явно НЕ прийняте (transcript обірвався) — не варта окремого ADR: gold
(sonnet) такі видаляє. Ловимо без LLM, щоб не покладатися на kind-judge малої моделі.
- buildEdges — Будує кандидати-ребра за лексичною схожістю.
- validateMadr — Детермінований гейт якості згенерованого MADR.
- madrDate — Детермінована ISO-дата для поля **Date:**. Пріоритет — `captured` frontmatter
(перші 10 символів ISO-стемпа); fallback — timestamp-префікс імені файлу
(`YYMMDD-…` → `20YY-MM-DD`). Каркас MADR не повинен залежати від LLM навіть тут.
- normalizeSections — Нормалізує сирий JSON-вивід gen-моделі у строгу форму секцій. Толерантна до
дрібних відхилень малої моделі: рядок замість масиву → масив із одного елемента,
число/null → рядок/порожньо, обрізає пробіли й порожні елементи.
- assembleMadr — Детермінована збірка канонічного MADR 4.0.0 з заголовка, дати й секцій-контенту.
Увесь каркас (Status, назви секцій, шаблон "Chosen option…", fallback-фрази,
bullets) — тут, не в моделі. Заголовок і дата — JS-власність (draftTitle/captured),
модель їх не торкається.
- normalizePipeline — Головний конвеєр. Повертає operations[] (контракт single-shot) + stats.

## Сценарії використання

- `npm/scripts/lib/adr/tests/normalize-pipeline.test.mjs` (tokenize / jaccard; draftTitle) — відкидає стоп-слова, timestamp-префікс і короткі токени; jaccard: однакові=1, диз’юнктні=0; пріоритет рядку; повертає; ловить; ще 15

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
