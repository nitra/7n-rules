# CI4-модель `@nitra/cursor`

Опис проєкту за моделлю [C4](https://c4model.com) (локально перейменовано на `ci4`). Markdown-файли цього каталогу — **офіційне джерело істини про архітектуру** разом із кодом і ADR (`docs/adr/`). Конвенція задана правилом [`.cursor/rules/n-ci4.mdc`](../../.cursor/rules/n-ci4.mdc).

## Файли

| File                                   | Рівень              | Що описує                                         |
| -------------------------------------- | ------------------- | ------------------------------------------------- |
| [`01-context.md`](01-context.md)       | L1 — System Context | Зовнішні актори і межа `n-cursor`                 |
| [`02-containers.md`](02-containers.md) | L2 — Containers     | 6 виконуваних/data-контейнерів пакету             |
| [`03-components.md`](03-components.md) | L3 — Components     | Внутрішні модулі runtime-контейнерів і їхні тести |
| [`04-code.md`](04-code.md)             | L4 — Code           | Code-flow для всіх runtime-контейнерів            |
| [`decisions.md`](decisions.md)         | Cross-ref           | Таблиця "елемент CI4 ↔ relevant ADR"              |

## Як читати

1. Почніть з `01-context.md`, щоб зрозуміти, з чим взаємодіє `n-cursor` ззовні.
2. Перейдіть до `02-containers.md` — побачите внутрішні runtime-одиниці.
3. У `03-components.md` дивіться компоненти конкретного контейнера + посилання на тести.
4. `04-code.md` — для глибокого розуміння окремого runtime-flow.
5. `decisions.md` — для відстеження архітектурних рішень з ADR.

## Конвенція якорів

Кожен елемент CI4 має **explicit-якорь** (`<a id="..."></a>`), який не залежить від тексту заголовка й не дрейфує при переписуванні. Префікс-таксономія:

| Префікс  | Рівень                     | Приклад                                            |
| -------- | -------------------------- | -------------------------------------------------- |
| `ctx-*`  | L1 actor / external system | `ctx-developer`, `ctx-ai-agent`, `ctx-target-repo` |
| `cnt-*`  | L2 container               | `cnt-rule-sync`, `cnt-check-runner`                |
| `cmp-*`  | L3 component               | `cmp-build-agents`, `cmp-check-reporter`           |
| `code-*` | L4 code-flow               | `code-rule-sync`, `code-check-runner`              |

Посилатися на елемент CI4 з ADR / коду / іншого документа — лише через ці якорі:

```markdown
Див. [Check Runner](../ci4/02-containers.md#cnt-check-runner)
```

Тексту заголовків категорично **не** використовуйте для лінкування.

## Правила оновлення

(детальний контракт — у [`n-ci4.mdc`](../../.cursor/rules/n-ci4.mdc))

- Зміни архітектури (нова інтеграція, новий компонент, перейменування, видалення) — **в тому ж PR**, що й код.
- ADR, який має наслідки для CI4, **явно** перелічує, які файли цього каталогу оновити.
- Кожен L3-компонент має посилання на тести в `npm/tests/`. Якщо тесту немає — клітинка `Tests` має значення `—` і запис у `decisions.md` як технічний борг.

## Кросс-лінк CI4 ↔ ADR

Двосторонній зв'язок реалізований так:

1. **Centralized index** — `decisions.md`. Таблиця `Element ID | ADR file | Дата | Резюме`.
2. **Inline relevant ADRs** — кожен файл рівня (`01..04-*.md`) у кінці має секцію `## Related decisions` зі списком ADR, які торкаються елементів цього рівня.
3. **Reverse-link з ADR** — у тіло ADR вписується `Related CI4: [<element-name>](../../docs/ci4/0X-<level>.md#<anchor>)`. Робиться **вручну при кураторстві** з `_inbox/` у фінальний ADR.

Дублювання `decisions.md` ↔ inline-секцій навмисне: при читанні рівня видно ADR-контекст; `decisions.md` залишається індексом для глобального пошуку.

## Що CI4 НЕ описує

- Воркспейс [`demo/`](../../demo/) — поза scope.
- Сусідні `@nitra/*` пакети (cspell-dict, eslint-config, stylelint-config, minify-image тощо) — лише як external systems на L1.
- Внутрішня архітектура Cursor IDE / Claude Code / GitHub Actions runner — також лише external.
- Реліз-процес npm-пакета — у [`npm/CHANGELOG.md`](../../npm/CHANGELOG.md), [`npm/CLAUDE.md`](../../npm/CLAUDE.md) і правилах `n-changelog`, `n-npm-module`.

## Дизайн-спека

Спека, з якої побудована ця модель: [`docs/specs/2026-05-10-ci4-model-design.md`](../specs/2026-05-10-ci4-model-design.md).
