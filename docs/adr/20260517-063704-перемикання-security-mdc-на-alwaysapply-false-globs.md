---
session: 0850a6f9-4567-482d-8da2-2fe965458fbc
captured: 2026-05-17T06:37:04+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/0850a6f9-4567-482d-8da2-2fe965458fbc.jsonl
---

[Note from transcript analyzer: session ends here]
---

## ADR Перемикання `security.mdc` на `alwaysApply: false` + globs

**Контекст:** Нове правило `security` (`v1.12.0`) було створено з `alwaysApply: true`, аналогічно до `text` та `adr`. Користувач зауважив, що постійне завантаження правила в AI-контекст не має сенсу, якщо `n-fix` / `npx @nitra/cursor check` виконує програмну валідацію незалежно від того, чи бачить AI це правило.

**Рішення/Процедура/Факт:** У `npm/rules/security/security.mdc` змінено frontmatter: `alwaysApply: true` → `alwaysApply: false` + `globs: "**/.gitleaks.toml,**/package.json,.github/workflows/**/*.yml"`. Версія пакету `npm/package.json` підвищена до `1.12.1`, у `npm/CHANGELOG.md` додано запис `[1.12.1]`.

**Обґрунтування:** `alwaysApply: true` доцільний лише для cross-cutting правил без вузького скоупу (`text`, `bun`, `adr`). Для `security` glob чіткий (`.gitleaks.toml`, `package.json`, workflow-yml) — це точний аналог `changelog` (`globs: "**/{CHANGELOG.md,package.json}", alwaysApply: false`). Програмна перевірка (Rego + JS) запускається через `n-fix` / `lint`-ланцюжок незалежно, тому AI-контекст потрібен тільки коли агент редагує конфіги.

**Розглянуті альтернативи:** Залишити `alwaysApply: true` (як у `text` / `adr`); відхилено — правило має вузький glob і повністю покрите програмними перевірками.

**Зачіпає:** `npm/rules/security/security.mdc`, `npm/package.json` (version `1.12.1`), `npm/CHANGELOG.md`
