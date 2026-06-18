---
type: ADR
title: "n-start-check: smoke-перевірка воркспейсів bun-монорепо"
---

# n-start-check: smoke-перевірка воркспейсів bun-монорепо

**Status:** Accepted
**Date:** 2026-05-22

## Context and Problem Statement
У bun-монорепо не було автоматизованого способу перевірити, чи кожен воркспейс взагалі запускається. Потрібен скіл, який обходить усі воркспейси зі `start`-скриптом і фіксує результат без зупинки на помилці. Додаткова складність: macOS не має `timeout` у стандартній поставці, а деякі `start`-скрипти є мутаційними CLI (а не dev-серверами), сліпий запуск яких псує стан репозиторію.

## Considered Options
* Новий скіл `start-check` у `npm/skills/start-check/` за наявним паттерном (`SKILL.md` + `auto.md`)
* Фоновий процес (`&`) + `sleep` + ручний `kill` (watchdog) як таймаут
* `perl -e 'alarm shift; exec @ARGV' 12 bun run start` як таймаут
* Pre-flight SKIP для `start`-скриптів, що класифіковані як мутаційні CLI
* git-знімок до прогону + rollback після нього замість SKIP

## Decision Outcome
Chosen option: "Новий скіл `start-check` із `perl alarm` та git-знімком для rollback", because структура `npm/skills/<id>/SKILL.md` + `auto.md` відповідає наявним скілам; `exec` у `perl alarm` зберігає PID процесу і повертає однозначний код виходу `142` без ручного юглінгу; git-знімок захищає репо від побічних ефектів мутаційних `start`-скриптів, а не пропускає їх (користувач явно відхилив підхід SKIP для мутаційних скриптів).

### Consequences
* Good, because скіл видно в `n-cursor skill list` одразу після додавання директорії без будь-яких змін до реєстру; тести `auto-skills.test.mjs` та `skills-cli.test.mjs` (19 pass, 0 fail) проходять без оновлення.
* Good, because `perl alarm` — однорядкове рішення; `CODE=142` (`128+14`, SIGALRM) однозначно маркує «dev-сервер дожив до grace-period» без ручного юглінгу PID / `kill -0` / `wait`; orphan-процесів після прогону нема.
* Good, because git-знімок (`git status --porcelain` до прогону) дозволяє після зупинки процесу точно відкотити лише нові зміни, не чіпаючи вже брудні файли (незавершену роботу користувача).
* Good, because `SKIP` вживається тільки для воркспейсів без `scripts.start` взагалі — жоден `start`-скрипт не пропускається сліпо.
* Bad, because git-знімок + rollback потребує коректного git-стану до прогону; якщо репо не ініціалізовано або HEAD відсутній, механізм відкату не спрацює.

## More Information
- Нові файли: `npm/skills/start-check/SKILL.md`, `npm/skills/start-check/auto.md` (умова `[bun]`, аналогічно до `taze`)
- Таймаут: `perl -e 'alarm shift; exec @ARGV' 12 bun run start > /tmp/n-start-check.log 2>&1`
- Інтерпретація коду виходу: `142` → dev-сервер OK; `0` → CLI завершився чисто → OK; інше → FAIL
- Прогін у `demo/` (воркспейс із `scripts.start: vite`): `CODE=142`, лог містить `VITE v8.0.10 ready in 398 ms`, порт 5173 вільний після завершення
- `SIGALRM` додано до `.cspell.json` (words)
- Мутаційний `start` у `npm/` (`bun ./bin/n-cursor.js`): blind-запуск виконав повний sync — з'явились `npm/.cursor/`, `npm/.claude/`, `npm/AGENTS.md`, `npm/CLAUDE.md` і devDependency `@nitra/cursor`; відкат: `rm -rf npm/.claude npm/.cursor npm/.github npm/.gitignore npm/.n-cursor.json npm/AGENTS.md npm/CLAUDE.md && git checkout -- npm/package.json bun.lock`
- Крок 5 скіла: знімок `git status --porcelain > /tmp/n-start-check.before` до прогону; після — diff зі знімком; нові untracked-файли видаляються, новозмінені tracked-файли відкочуються через `git checkout`, файли брудні до прогону — не чіпаються
- Команда верифікації: `node npm/bin/n-cursor.js skill list`; `bun test npm/scripts/auto-skills.test.mjs npm/scripts/skills-cli.test.mjs`
- Після `npx @nitra/cursor sync` скіл з'являється в `.cursor/skills/n-start-check/` цільових проєктів
