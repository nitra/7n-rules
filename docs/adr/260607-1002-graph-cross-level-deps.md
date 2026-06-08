## ADR Крос-рівневі залежності через вкладену структуру deps/

**Status:** Accepted
**Date:** 2026-06-07

## Context and Problem Statement

`deps/` директорія використовує ім'я файлу як ідентифікатор dep-вузла без шляху. Тобто `deps/collect-data.md` посилається на прямого сусіда (sibling) у тій самій батьківській директорії. Вузли на різних гілках ієрархії (`tasks/research/analyze/` vs `tasks/reporting/generate-report/`) не можуть залежати один від одного без зміни логічної структури проєкту заради технічного обмеження.

## Considered Options

* Варіант A — `__` як роздільник рівнів у назві файлу (`deps/research__analyze.md`)
* Варіант B — шлях у вмісті файлу `deps/*.md` — порушує інваріант (потребує читання вмісту для deps satisfaction)
* Варіант C — вкладена структура `deps/` дзеркалює `tasks/` ієрархію

## Decision Outcome

Chosen option: "Варіант C — вкладена `deps/`", because зберігає інваріант (deps satisfaction через `ls -R deps/` без читання вмісту), сусідні deps залишаються простими (`deps/collect-data.md`), крос-рівневі — вкладені (`deps/research/analyze.md`).

### Consequences

* Good, because deps satisfaction: `ls -R deps/` → шлях відносно `tasks/` → перевірити `tasks/<path>/fact_*.md` — без читання вмісту файлів.
* Good, because структура `deps/` є self-documenting: вкладеність відображає реальне місце dep-вузла у графі.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Приклади:

```
# Sibling (поточний рівень):
deps/
  collect-data.md   → tasks/<parent>/collect-data/fact_*.md

# Крос-рівнева залежність:
deps/
  research/
    analyze.md      → tasks/research/analyze/fact_*.md
```

Deps satisfaction алгоритм:
```
ls -R deps/ → отримати список шляхів відносно deps/
для кожного <path>:
  strip .md → dep-id = <path>
  перевірити: exists(tasks/<dep-id>/fact_*.md)
all resolved → deps resolved
```

Файли у `deps/` — immutable після `graph init`. Вміст опціональний: `ref: <path>` для контексту агента.

Spec: `docs/думка.MD`, секція "deps/ директорія".
