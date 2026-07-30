---
type: JS Module
title: domain-resolver.mjs
resource: npm/rules/doc-files/package_knowledge/domain-resolver.mjs
docgen:
  crc: ff73640e
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 90
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Виявляє package-level documentation domains за маніфестами екосистем.

Resolver не аналізує source: він лише фіксує стабільну identity домену та
вкладені межі, які downstream language adapters використають для обходу.

## Поведінка

canonicalDomainName повертає канонічну identity лише тоді, коли вхід можна безпечно звести до імені домену; для непридатного значення дає null, а для Python дотримується PEP 503-формату. Для інших підтримуваних маніфестів опирається на вже задану canonical identity екосистеми, тож результат придатний для зіставлення доменів між різними джерелами метаданих.

resolveDocumentationDomains збирає стабільний список documentation domains і супровідні diagnostics для репозиторію. Маніфести, що не читаються або містять некоректні дані, не підміняються штучним fallback-ідентифікатором; duplicate canonical identities також залишаються diagnostics. Результат стабільно впорядкований, а області `.git` і `node_modules` свідомо пропускаються.

resolveDomainForPath повертає domain, який найточніше відповідає source path: якщо шлях поза репозиторієм або не належить жодному manifest root, результатом є null. Коли кілька доменів могли б підійти, перевага надається найглибшому вкладеному root, тож downstream-адаптери отримують однозначну межу для обходу.

## Публічний API

- canonicalDomainName — Canonicalizes package names according to ecosystem identity rules.
Python uses its PEP 503 canonical project-name form; the other manifests
already define canonical package identities and only need trimming.
- resolveDocumentationDomains — Resolves every manifest-backed documentation domain in a repository.

Returned domains and diagnostics are sorted by stable values. Invalid
manifests and duplicate canonical identities remain diagnostics instead of
silently receiving a path-derived fallback identity.
- resolveDomainForPath — Finds the owning domain for a source path. The deepest nested root wins;
paths outside the repository and manifest roots without a domain return null.

## Сценарії використання

- `npm/rules/doc-files/package_knowledge/tests/domain-resolver.test.mjs` (package knowledge domain resolver; knowledge graph v1 schema) — discovers every supported manifest with path-independent canonical identity; excludes nested roots from the parent and resolves the deepest domain; emits stable blocking diagnostics instead of path-based fallback identities; canonicalizes only ecosystem-defined name variants; skips workspace-only Cargo and config-only Python manifests; ще 1

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Свідомо пропускає шляхи: `.git`, `node_modules`.
