---
type: ADR
title: Зберігання reasoning-log у Claude projects
description: Витягнуті thinking-блоки з Claude Code транскриптів зберігаються поруч із project-specific даними Claude у ~/.claude/projects/<project-id>/reasoning-log/.
---

**Status:** Accepted
**Date:** 2026-06-09

## Context and Problem Statement

Потрібно вирішити, де зберігати витягнуті `thinking`-блоки з `.jsonl` транскриптів Claude Code сесій, щоб вони були відокремлені від raw-транскриптів, але залишалися повʼязаними з конкретним проєктом.

## Considered Options

- `~/.claude/reasoning-log/<project-slug>/` — окрема тека поряд зі стандартними Claude-директоріями.
- `~/.claude/projects/<project-id>/reasoning-log/` — підтека всередині вже існуючої project-директорії Claude Code.
- `.claude/reasoning-log/` всередині репозиторію з `.gitignore`.

## Decision Outcome

Chosen option: "`~/.claude/projects/<project-id>/reasoning-log/`", because transcript фіксує, що `~/.claude/projects/-Users-vitalii-www-nitra-cursor/` вже використовується Claude Code як канонічне місце для project-specific даних і містить повʼязані сесійні артефакти.

### Consequences

- Good, because reasoning-log колокується з рештою Claude-даних конкретного проєкту і знаходиться через той самий `projectId` slug.
- Good, because глобальний `Stop` hook може отримувати `transcript_path` і записувати витягнуті reasoning-блоки без стану в репозиторії.
- Bad, because transcript не містить підтвердження негативних наслідків для обраного місця зберігання.
- Neutral, because ретроспективна атрибуція старих `.jsonl` сесій виконується через пошук `projectDir` у user-повідомленнях; transcript не містить підтвердження, що це повністю виключає false positives.

## More Information

Формат шляху: `join(homedir(), '.claude', 'projects', projectId, 'reasoning-log', sessionId + '.json')`.

`projectId` формується як `projectDir.replace(/\//g, '-')`, наприклад `-Users-vitalii-www-nitra-cursor`.

Hook stdin-формат Claude Code 1.6.2: `{ session_id, transcript_path, stop_hook_active }`.

Env-поля з transcript: `CLAUDE_PROJECT_DIR`, `CLAUDE_SESSION_ID`.

Скрипт: `~/.claude/hooks/reasoning-capture.mjs`.

Реєстрація hook у `~/.claude/settings.json`:

```json
"hooks": { "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node /Users/vitalii/.claude/hooks/reasoning-capture.mjs" }] }] }
```

Ретроспективний `extract` фільтрує записи за наявністю `projectDir` у JSON-вмісті user-записів і підтримує опцію `--since <ISO date>`.
