---
type: JS Module
title: hook.mjs
resource: npm/scripts/hook.mjs
docgen:
  crc: 3ecffbb6
  model: omlx/gemma-4-e2b-it-4bit
  tier: local-min
  score: 70
---

## Огляд

Thin hook entrypoint для Claude Code / Cursor / Codex CLI hooks: зчитує контекст
(stdin / git), делегує в `detectAll` (read-only), перекодовує exit-код у hook-протокол (1 → 2).

Режими:
  --post-tool-use  PostToolUse: шлях(и) зміненого файлу зі stdin JSON — Claude Code
                    (`tool_input.file_path`, один файл) або Codex CLI (`tool_name: "apply_patch"`,
                    `tool_input.command` — V4A-патч `*** Begin Patch ... *** End Patch`, можливо
                    кілька файлів; джерело формату: openai/codex apply_patch_tool_instructions.md).
                    NB: покриття PostToolUse для `apply_patch` у Codex CLI станом на час написання
                    задокументовано суперечливо (відкритий issue openai/codex#16732 — "ApplyPatchHandler
                    doesn't emit PreToolUse/PostToolUse hook event") — на частині версій подія може
                    не спрацювати взагалі; Stop-hook нижче лишається надійним fallback.
  --stop           Stop: робоче дерево vs HEAD (`git diff HEAD` + untracked) — payload-незалежний,
                    працює однаково для Claude Code, Cursor і Codex CLI.

## Публічний API

- extractCodexPatchPaths — Дістає шляхи файлів з V4A-патча Codex CLI apply_patch (`*** Begin Patch ... *** End Patch`).
`Update File` з наступним рядком `Move to` рахує лише фінальний (перейменований) шлях;
`Delete File` пропускається — файла більше нема, лінтити нічого.
- extractFilePaths — Дістає шлях(и) зміненого файлу зі stdin JSON PostToolUse hook — Claude Code
(`tool_input.file_path`, один файл) або Codex CLI (`tool_name: "apply_patch"`,
`tool_input.command` — V4A-патч, можливо кілька файлів). Інші інструменти (Bash/Shell тощо)
не мають жодного з цих полів — повертає порожній масив (нема що лінтити).
- runHookCli — CLI для `n-rules hook`.

## Сценарії використання

- `npm/scripts/tests/hook.test.mjs` (extractCodexPatchPaths; extractFilePaths) — Add File — повертає шлях нового файлу; Update File — повертає шлях без Move to; Update File + Move to — рахує лише фінальний (перейменований) шлях; Delete File — пропускається (нема що лінтити); декілька файлових секцій в одному патчі; ще 7

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
