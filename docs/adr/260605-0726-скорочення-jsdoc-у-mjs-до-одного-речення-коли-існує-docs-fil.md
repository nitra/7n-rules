---
session: 166067f9-58c4-48c2-afaa-547b28eb33db
captured: 2026-06-05T07:26:28+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/166067f9-58c4-48c2-afaa-547b28eb33db.jsonl
---

## ADR Скорочення JSDoc у `.mjs` до одного речення, коли існує `docs/<filename>.md`

## Context and Problem Statement

У скриптах `npm/rules/*/js/*.mjs` були розгорнуті JSDoc-блоки (2–4 речення), що дублювали поведінковий опис, який вже міститься у `docs/*.md`-файлах, згенерованих n-docgen. Постало питання: де має жити авторитетна документація для LLM, і чи можна скоротити JSDoc у скриптах, не втрачаючи читабельності для людини в IDE.

## Considered Options

* Залишити дублювання — вважати його прийнятним (попередня позиція `scripts.mdc` v1.13)
* Зробити `docs/<filename>.md` авторитетним джерелом для LLM, JSDoc у `.mjs` скорочувати до одного речення-summary

## Decision Outcome

Chosen option: "Зробити `docs/<filename>.md` авторитетним джерелом для LLM, JSDoc у `.mjs` скорочувати до одного речення-summary", because користувач визначив, що LLM має читати `docs/`, а не реконструювати поведінку з JSDoc, і попросив закріпити цей контракт у `scripts.mdc`.

### Consequences

* Good, because `docs/<filename>.md` (n-docgen) стає єдиним місцем повного поведінкового опису для LLM-агентів, усуваючи ризик розбіжностей між JSDoc і `docs/`.
* Good, because JSDoc у `.mjs` залишається (у формі одного речення-summary) для читача коду в IDE та у git diff — людина не втрачає швидкого контексту.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Зміна внесена у `.cursor/rules/scripts.mdc`, версія підвищена з `1.13` до `1.14`. Додано абзац у секцію "Верхній JSDoc-коментар у кожному скрипті":

> **Якщо існує `docs/<filename>.md`** (згенерований n-docgen), JSDoc-блок у `.mjs` може бути **скорочений до одного речення-summary**: повна поведінкова документація живе в `docs/`. LLM повинен читати `docs/`, а не реконструювати поведінку з JSDoc. Видаляти JSDoc повністю — **заборонено**: рядок-summary залишається для IDE/diff.

Приклад після скорочення (`npm/rules/abie/js/applies.mjs`):
```js
/** Applies-гейт правила abie: пропускає всі концерни, якщо abie вимкнено у конфізі. */
```
Авторитетна поведінкова документація: `npm/rules/abie/js/docs/applies.md`.
