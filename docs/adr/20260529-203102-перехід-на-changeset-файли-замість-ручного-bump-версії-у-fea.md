---
session: 9b851872-974e-4842-96a2-14ae3cf1a806
captured: 2026-05-29T20:31:02+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/9b851872-974e-4842-96a2-14ae3cf1a806.jsonl
---

## ADR Перехід на changeset-файли замість ручного bump версії у feature-гілках

## Context and Problem Statement

При паралельній розробці 2–4 розробниками в монорепо з 3–5 workspace кожен PR вручну піднімає `version` у `package.json` та вставляє секцію у верхню частину `CHANGELOG.md`. Обидві правки потрапляють в одне й те саме місце файлу, що гарантує git-конфлікт при мерджі. Поточне правило `n-changelog.mdc` (v2.6) закріплює саме цю модель як обов'язкову.

## Considered Options

* **Рівень 1 — `merge=union` у `.gitattributes`:** додати `CHANGELOG.md merge=union`, щоб git автоматично склеював обидві нові секції замість виведення маркерів конфлікту. Не вирішує конфлікт `version` у `package.json`.
* **Рівень 2 — заборонити bump версії у feature-гілках:** версія обчислюється лише на релізному кроці; PR більше не чіпає `package.json`. Зменшує половину конфліктів, але `CHANGELOG.md` лишається спільним файлом.
* **Рівень 3 — changeset-файли у `.changes/` з агрегацією на релізі:** кожен PR кладе окремий файл `.changes/<slug>.md` (тип bump + опис). Два розробники = два різні файли → конфліктів немає by design. При релізі (`npx @nitra/cursor publish`) файли агрегуються: обчислюється semver, генерується секція CHANGELOG у поточному форматі, файли видаляються.

## Decision Outcome

Chosen option: "Рівень 3 — changeset-файли у `.changes/` з агрегацією на релізі", because усуває кореневу причину конфліктів (спільні рядки у спільному файлі), а не симптом; масштаб (3–5 workspace, 2–4 розробники) і ручний реліз через `npx @nitra/cursor publish` добре відповідають цій моделі. Формат `CHANGELOG.md` лишається незмінним — генерується автоматично в поточній структурі.

### Consequences

* Good, because два розробники більше ніколи не редагують одне й те саме місце у `package.json` або `CHANGELOG.md` — конфлікт виключений архітектурно.
* Good, because `check changelog` спрощується: перевірка «є чейнджсет для зміненого workspace» замість «піднято version + є секція CHANGELOG».
* Bad, because потребує змін у `n-changelog.mdc`, логіці `check changelog`, і додавання агрегаційного кроку в `npx @nitra/cursor publish` — це не безкоштовна міграція.

## More Information

* Поточне правило: `.cursor/rules/n-changelog.mdc` v2.6
* Реалізація перевірки: `npm/rules/changelog/js/consistency.mjs`, `npm/rules/changelog/fix.mjs`
* Команда релізу: `npx @nitra/cursor publish`
* Рівень 1 (`merge=union`) відхилено як недостатній — не вирішує конфлікт `version` у `package.json`.
* Рівень 2 відхилено як частковий — `CHANGELOG.md` лишається вузьким місцем.
* Дизайн-сесія завершена на стадії вибору напряму; деталі реалізації (формат `.changes/*.md`, логіка агрегації, оновлення правил) — наступний крок.
