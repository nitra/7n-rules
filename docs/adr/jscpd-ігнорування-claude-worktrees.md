# jscpd: Ігнорування `.claude/worktrees/` у всіх проєктах

**Status:** Accepted
**Date:** 2026-05-12

## Контекст

При запуску `bunx jscpd .` інструмент детектував хибнопозитивні дублікати, скануючи `.claude/worktrees/` — директорію, де Claude Code зберігає тимчасові git worktree-копії поточного репозиторію. Оскільки worktree є дзеркалом робочого дерева, будь-який файл у ньому неминуче збігається з оригіналом, що давало гарантовані false-positive клони.

## Рішення/Процедура/Факт

1. `.gitignore` — додано рядок `.claude/worktrees/`, щоб git (і через нього опція `gitignore: true` у jscpd) ігнорував цю папку.
2. `.jscpd.json` — додано `.claude/worktrees/**` у масив `ignore` як незалежна страховка для сценаріїв запуску jscpd поза git-контекстом.
3. `npm/mdc/js-lint.mdc` та `.cursor/rules/n-js-lint.mdc` (v1.17 → v1.18) — у секції `.jscpd.json` додано параграф про `.claude/worktrees/`: обидва підходи (`.gitignore` і `ignore`-масив) задокументовані як норма для всіх nitra-проєктів.
4. `eslint.config.js` — додано `.claude/worktrees/**` до `ignores`.
5. `npm/package.json` — версія 1.9.5 → 1.9.6.
6. `npm/CHANGELOG.md` — запис `## [1.9.6]` з описом змін.
7. `.cspell.json` — розширено словник: `worktree`, `worktrees`.

## Обґрунтування

Worktree-копії є операційним артефактом Claude Code, а не частиною кодової бази. Подвійне ігнорування (`.gitignore` + `ignore` у `.jscpd.json`) робить поведінку надійною незалежно від середовища запуску. Оскільки `js-lint.mdc` є канонічним стандартом для всіх nitra-проєктів, зміна автоматично поширюється на весь стек через `@nitra/cursor`.

## Розглянуті альтернативи

Явний `ignore`-запис у `.jscpd.json` без зміни `.gitignore` — відхилено: worktrees не повинні відстежуватися git у жодному разі; додавання в `.gitignore` є концептуально правильнішим рішенням.

## Зачіпає

`.gitignore`, `.jscpd.json`, `npm/mdc/js-lint.mdc`, `.cursor/rules/n-js-lint.mdc`, `eslint.config.js`, `npm/package.json`, `npm/CHANGELOG.md`, `.cspell.json`
