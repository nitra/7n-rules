---
type: JS Module
title: migration-cache.mjs
resource: npm/skills/taze/js/migration-cache.mjs
docgen:
  crc: 5f264929
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Модуль керує кешем уже відомих міграцій на диску (`~/.cache/n-rules/taze-migrations` за замовчуванням) — кеш персистентний і спільний для всіх repo/worktree на машині, не обмежений одним прогоном. `migrationCacheKey` формує ключ для запису, `readMigrationCache` і `writeMigrationCache` працюють із кешованими даними, а `withKnownMigrationNotes` підставляє вже відомі відомості там, де це доречно. Читання fail-safe (`readMigrationCache` перехоплює помилки й повертає `null` замість винятку); запис (`writeMigrationCache`) винятків не перехоплює.

## Поведінка

- `DEFAULT_CACHE_DIR` — задає спільний каталог кешу міграцій для всіх репозиторіїв на цій машині.
- `migrationCacheKey` — перетворює пару версій пакета на безпечний крос-репо ключ кешу.
- `readMigrationCache` — читає кешований запис міграції для конкретної пари версій; якщо запису немає або він пошкоджений, повертає `null` без помилки.
- `writeMigrationCache` — зберігає запис про вже проаналізовану міграцію в кеш, щоб не повторювати той самий аналіз у наступних прогонових середовищах.
- `withKnownMigrationNotes` — додає до промпта підсумок відомої міграції з кешу й підказує пропустити повторне дослідження та перейти до перевірки в поточному проєкті.

## Публічний API

- DEFAULT_CACHE_DIR — Спільний каталог для кешу міграцій на цій машині, незалежний від конкретного repo чи worktree.
- migrationCacheKey — Перетворює `pkg`, `from` і `to` на безпечну назву файла для спільного кешу.
- readMigrationCache — Повертає збережені дані про вже відому міграцію для тієї самої пари версій, або `null`, якщо запису немає чи він пошкоджений.
- writeMigrationCache — Записує результат вже розібраної міграції в кеш, щоб наступний repo з тим самим оновленням не починав дослідження заново.
- withKnownMigrationNotes — Додає до prompt короткий підсумок знайденої міграції і пропускає початковий етап з пошуком у CHANGELOG та diff.

## Гарантії поведінки

- `readMigrationCache` перехоплює помилки читання/парсингу й повертає `null` замість винятку (fail-safe); `writeMigrationCache` винятків не перехоплює.
- Кеш персистентний на диску і спільний для всіх repo/worktree на машині — не обмежений одним прогоном.
