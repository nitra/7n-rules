---
description: Локальні AI-інструменти на машині розробника — rtk (Rust Token Killer) стискає вивід CLI-команд на 60–90% токенів; агенти застосовують rtk автоматично через hooks, установка лише `brew install rtk-ai/tap/rtk`
alwaysApply: true
version: '1.0'
---

Правило `local-ai` інтегрує локальні AI-інструменти розробника. Зараз покриває **rtk** —
компресор виводу CLI-команд (тести, git, build: 60–90% економії токенів). Розраховане на
розширення іншими локальними інструментами в майбутньому.

## Установка (єдиний крок користувача)

```bash
brew install rtk-ai/tap/rtk
```

Більше нічого: hook-записи і extension нижче вставляє sync пакета, і всі вони **fail-open** —
без установленого rtk мовчки пропускають команди без змін. `rtk init` запускати не треба.

## Як агенту користуватись rtk

- Клієнти з rewrite-hook — **Claude Code, Cursor, pi** — переписують shell-команди на
  rtk-еквіваленти автоматично (див. канонічні записи нижче); робити нічого не треба.
- Агенти без rewrite-hook (Codex тощо): якщо `command -v rtk` успішний — додавай префікс
  `rtk` до команд: `rtk git status`, `rtk vitest`, `rtk tsc`, у ланцюжках теж
  (`rtk git add … && rtk git commit …`). Невідомі rtk команди проходять без змін
  (passthrough), тож префікс безпечний. Не дублюй префікс для команд, що вже починаються з `rtk`.
- Разово вимкнути переписування: `RTK_DISABLED=1` в env; запуск без фільтра —
  `rtk proxy <cmd>`; статистика заощаджень — `rtk gain`.

## Канонічні записи (вставляє sync, коли правило увімкнене)

### `.claude/settings.json` — PreToolUse

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "command -v rtk >/dev/null 2>&1 && exec rtk hook claude; exit 0",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

Без rtk hook завершується `exit 0` без виводу — Claude Code виконує команду як є.

### `.cursor/hooks.json` — preToolUse

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "command": "bash -lc 'command -v rtk >/dev/null 2>&1 && exec rtk hook cursor; echo \"{}\"'",
        "matcher": "Shell",
        "timeout": 30
      }
    ]
  }
}
```

Cursor вимагає JSON-вивід на всіх шляхах — без rtk hook відповідає `{}` (passthrough).

### `.pi/extensions/rtk.ts`

Vendored extension зі складу rtk (`rtk init --agent pi` генерує ідентичний файл у той самий
шлях — повторна установка ідемпотентна). Тонкий делегат: на `tool_call` bash викликає
`rtk rewrite <cmd>`; сам вимикається, якщо rtk відсутній або старіший за 0.23.0.

## Вимкнення

`disable-rules: ["local-ai"]` у `.n-rules.json` — наступний sync прибере hook-записи з
`.claude/settings.json` і `.cursor/hooks.json` та видалить `.pi/extensions/rtk.ts`
(включно з установленим вручну через `rtk init --agent pi` — шлях спільний).
