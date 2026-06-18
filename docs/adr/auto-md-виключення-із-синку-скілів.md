---
type: ADR
title: "Виключення `auto.md` із синку скілів у `.cursor/skills/`"
---

# Виключення `auto.md` із синку скілів у `.cursor/skills/`

**Status:** Accepted
**Date:** 2026-05-15

## Контекст

Функція `syncSkills` у `npm/bin/n-cursor.js` копіювала всі файли з `npm/skills/<id>/` у `.cursor/skills/n-<id>/`, включно з `auto.md`. Файл `auto.md` є джерелом правди для автодетекції скілів (`auto-skills.mjs`), але не є частиною вмісту скілу, яку бачить Claude Code.

## Рішення/Процедура/Факт

У `syncSkills` додано перевірку `if (file === 'auto.md') continue` — файл `auto.md` пропускається під час копіювання до `.cursor/skills/`. Наявні `auto.md` у `.cursor/skills/n-*/` видалено вручну. Версію пакету `@nitra/cursor` підвищено з `1.11.7` до `1.11.8`, `npm/CHANGELOG.md` та `npm/package.json` оновлено відповідно.

## Обґрунтування

`auto.md` — операційний артефакт системи автодетекції, а не контент скілу для Claude Code. Його присутність у `.cursor/skills/` засмічує директорію непотрібним файлом і може спутати інструменти, що читають вміст скілів. Тільки `SKILL.md` має синкуватися до `.cursor/skills/`.

## Розглянуті альтернативи

Не обговорювалися; рішення сформульовано однозначно у технічному завданні.

## Зачіпає

`npm/bin/n-cursor.js` (функція `syncSkills`), `.cursor/skills/n-*/auto.md` (видалено з усіх піддиректорій), `npm/package.json`, `npm/CHANGELOG.md`.
