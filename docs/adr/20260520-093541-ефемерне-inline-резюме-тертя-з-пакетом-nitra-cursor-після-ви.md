---
session: 369795cd-0bb8-41a6-9052-dcecac0a4777
captured: 2026-05-20T09:35:41+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/369795cd-0bb8-41a6-9052-dcecac0a4777.jsonl
---

`changelog check ✅`

Виправлено 2 суперечності у `npm/skills/publish-telegram/SKILL.md`:

| Що було | Що тепер |
|---|---|
| "хештеги **в кінці** поста" | "один хештег **першим рядком** поста" |
| "2–4 хештеги" | "рівно **1** хештег" |

Дзеркало [.cursor/skills/n-publish-telegram/SKILL.md](.cursor/skills/n-publish-telegram/SKILL.md) синкнуто. Пакет — `1.13.61`.
---
END TRANSCRIPT

## ADR Ефемерне inline-резюме «тертя» з пакетом @nitra/cursor після виконання скілів

## Context and Problem Statement

Під час виконання скілів (`n-lint`, `n-fix` тощо) агент помічає слабкі місця самого пакета `@nitra/cursor` — неоднозначні інструкції, відсутні перевірки, false positives. Ця інформація зникала разом із завершенням сесії і не потрапляла до мейнтейнерів пакета.

## Considered Options

* Ефемерне inline-резюме через `alwaysApply`-правило — резюме лише у відповіді чату, без запису у файли
* Персистентний інбокс-дизайн — чернетки у `docs/cursor-feedback/`, batch-LLM фаза 2, маршрут через `n-llm-patch`
* Канал B: Stop-hook `capture-feedback.sh` для майнінгу транскрипту — як підстраховка до ефемерного каналу

## Decision Outcome

Chosen option: "Ефемерне inline-резюме через `alwaysApply`-правило", because користувач явно обрав ефемерний варіант; персистентна інфраструктура (інбокс, хуки, фаза 2) відкладена як опційне розширення.

### Consequences

* Good, because transcript фіксує очікувану користь: нульова нова інфраструктура, миттєвий зворотний звʼязок у чаті, inline-версія є строгою підмножиною повного дизайну і не блокує подальшого розширення.
* Bad, because Neutral, because transcript не містить підтвердження наслідку щодо втрати сигналу частоти/пріоритету між запусками (відсутність накопичення).

## More Information

- Нове правило: `npm/rules/feedback/feedback.mdc` (`version: '1.0'`, `alwaysApply: true`)
- Дзеркало: `.cursor/rules/n-feedback.mdc`
- Реєстрація: `"feedback"` додано до `.n-cursor.json` → `rules`
- Bump пакета: `1.13.58 → 1.13.59`, секція `### Added` у `npm/CHANGELOG.md`
- Схема тертя у правилі: `target · id · kind · evidence · suggestion`; допустимі `kind`: `ambiguous-doc`, `missing-check`, `false-positive`, `no-autofix`, `recurring-pattern`
- Правило явно забороняє запис файлів, issue/PR, редагування пакета агентом

---

## ADR Виправлення суперечності про хештеги в скілі n-publish-telegram

## Context and Problem Statement

У `npm/skills/publish-telegram/SKILL.md` існувала суперечність: шаблон і приклад ставили один хештег першим рядком, тоді як секція «Правила» вимагала 2–4 хештеги в кінці поста. Виявлено під час першого ж реального запуску нового правила `feedback` (канал inline-резюме спрацював за призначенням).

## Considered Options

* Хештег зверху (першим рядком), рівно 1 тег
* Хештеги в кінці поста, 2–4 теги
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Хештег зверху (першим рядком), рівно 1 тег", because користувач обрав цей варіант інтерактивно через `AskUserQuestion`; шаблон і приклад у файлі вже відповідали цьому варіанту.

### Consequences

* Good, because transcript фіксує очікувану користь: усунуто суперечність між прозовим текстом і шаблоном, агент більше не матиме неоднозначності при генерації поста.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Виправлений файл: `npm/skills/publish-telegram/SKILL.md`
- Дзеркало синкнуто: `.cursor/skills/n-publish-telegram/SKILL.md`
- Bump пакета: `1.13.60 → 1.13.61`, секція `### Fixed` у `npm/CHANGELOG.md`
- Виправлені рядки: "хештеги в кінці поста" → "один хештег першим рядком поста"; "2–4 хештеги" → "рівно 1 хештег"
