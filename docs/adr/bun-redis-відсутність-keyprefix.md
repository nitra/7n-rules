---
type: ADR
title: "Bun native Redis: відсутність `keyPrefix` та ручний workaround"
---

# Bun native Redis: відсутність `keyPrefix` та ручний workaround

**Status:** Accepted
**Date:** 2026-05-09

## Контекст

При міграції з `ioredis` на Bun native Redis виникло питання щодо наявності аналога опції `keyPrefix`, яка у `ioredis` дозволяє автоматично префіксувати всі ключі.

## Рішення/Процедура/Факт

`RedisOptions` у Bun native Redis (`bun-types/redis.d.ts`) не містить поля `keyPrefix`. Доступні лише сім опцій: `connectionTimeout`, `idleTimeout`, `autoReconnect`, `maxRetries`, `enableOfflineQueue`, `tls`, `enableAutoPipelining`. Аналог реалізується вручну через helper-функцію `const k = (key: string) => prefix + key` або тонку фабричну обгортку.

## Обґрунтування

Bun native Redis є мінімалістичним клієнтом без додаткових абстракцій. Опція `keyPrefix` — це convenience wrapper над звичайними операціями, тож відповідальність за її реалізацію покладено на застосунок.

## Розглянуті альтернативи

Logical DB (ізоляція через `redis://host:port/N`) — відхилено: не є семантичним еквівалентом `keyPrefix`, оскільки це інша база даних, а не інший префікс у тій самій базі.

## Зачіпає

Будь-який код, що мігрує з `ioredis` або `node-redis` на `bun:redis`. Особливо Lua-скрипти та pub/sub-канали: у `ioredis` опція `keyPrefix` не застосовується до них — та сама поведінка зберігається і при ручному підході.
