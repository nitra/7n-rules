---
created_at: 2026-06-07T12:10:00Z
budget_sec: 1800
---

## Task

Протестувати скіл `n-coverage-fix` після нещодавніх міграцій (drop `claude-agent-sdk` → `pi`, two-tier routing через `npm/lib/models.mjs`).

Перевірити повний цикл: `coverage index` → `coverage slice` → LLM-воркер → запис тестів → re-run mutants → convergence.

## Done when

- [ ] `n-cursor coverage index` та `coverage slice` виконуються без помилок
- [ ] LLM-воркер (`npm/scripts/coverage-fix.mjs`) викликає `pi` через tier-routing (Tier 1 → Tier 2) без `claude-agent-sdk`
- [ ] Принаймні один мутант у реальному модулі проєкту знищено автоматично (не 0 survivors після ітерації)
- [ ] `npm run test` після запуску скілу — зелений
- [ ] Якщо є регресії або помилки — задокументовано в `outputs_001.md` з деталями

## Inputs

### context

Скіл: `npm/skills/n-coverage-fix/`, CLI-команди: `npm/scripts/coverage-fix.mjs`, `npm/scripts/coverage-classify/index.mjs`.
Нещодавні зміни: `1279b3f7` (coverage-fix → pi), `a883b44d` (coverage-classify → pi two-tier).

### constraint

Тестувати на реальному модулі з мутантами — не на порожньому файлі.
Не більше 3 ітерацій (вбудований ліміт скілу).
