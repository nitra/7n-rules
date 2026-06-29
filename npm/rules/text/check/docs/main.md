---
type: JS Module
title: main.mjs
resource: npm/rules/text/check/main.mjs
docgen:
  crc: ad783eec
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: best-of-2:retry-won,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл надає можливість перевіряти текстові ресурси проєкту на відповідність заданим стандартам якості та стилю. За допомогою функцій `runLintTextCli` та `lint` він автоматично запускає інструменти, такі як `csspell` (для перевірки орфографії), `shellcheck` (для синтаксису shell-скриптів), `dotenv-linter` (для формату конфігурацій), `markdownlint-cli2` та `v8r`, щоб гарантувати узгодженість текстового контенту.

## Поведінка

Поведінка:
runLintTextCli виконує повний набір перевірок стилю та якості текстових файлів, включаючи cspell, shellcheck, dotenv-linter, markdownlint-cli2 та v8r.
lint виконує повний набір перевірок стилю та якості текстових файлів, включаючи cspell, shellcheck, dotenv-linter, markdownlint-cli2 та v8r.

## Публічний API

- runLintTextCli — запускає лінтер для тексту через командний інтерфейс
- lint — перевіряє відповідність тексту стандартам лінтування

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
