# @nitra/cursor

Консольна утиліта для завантаження cursor-правил Nitra у локальний git-репозиторій.

## Як це працює

Репозиторій `@nitra/cursor` містить cursor-правила у директорії `mdc/`. CLI завантажує обрані правила з npm (через unpkg.com) і копіює їх у `.cursor/rules/` поточного проекту з префіксом `nitra-`.

Наприклад, правило `mdc/js-format.mdc` буде збережено як `.cursor/rules/nitra-js-format.mdc`.

## Підготовка

Перед першим запуском у вашому репозиторії створіть файл `nitra-cursor.json` у корені проекту зі списком правил для завантаження:

```json
{
  "rules": [
    "js-format",
    "npm-module",
    "spell"
  ]
}
```

Доступні правила:

| Назва        | Опис                                              |
| ------------ | ------------------------------------------------- |
| `js-format`  | Правила форматування JavaScript ecosystem (oxfmt) |
| `npm-module` | Структура репозиторію для npm-модуля (bun mono)   |
| `spell`      | Перевірка правопису через cspell                  |

Щоб завантажити правила конкретної версії пакету, додайте поле `version`:

```json
{
  "version": "2.5.0",
  "rules": ["js-format", "spell"]
}
```

## Запуск

```bash
npx @nitra/cursor
```

CLI автоматично:

1. Знайде `nitra-cursor.json` у поточній директорії
2. Завантажить кожне з перелічених правил з unpkg.com
3. Створить директорію `.cursor/rules/` якщо вона відсутня
4. Збереже файли з префіксом `nitra-`

## Приклад виводу

```
🔧 @nitra/cursor — завантаження cursor-правил

📋 Правил до завантаження: 3
  ⬇  js-format → .cursor/rules/nitra-js-format.mdc ... ✅
  ⬇  npm-module → .cursor/rules/nitra-npm-module.mdc ... ✅
  ⬇  spell → .cursor/rules/nitra-spell.mdc ... ✅

✨ Готово: 3 завантажено, 0 з помилками
```

## Структура пакету

```
npm/
├── mdc/               # cursor-правила
│   ├── js-format.mdc
│   ├── npm-module.mdc
│   └── spell.mdc
└── bin/
    └── nitra-cursor.js  # CLI-скрипт
```

## Мета проекту

Консольна утиліта яка дозволить оновлювати в локальних GIT репозиторіях правила для cursor з можливістю наслідування правил від файлів в цьому репозиторії та забезпечення версійності правил для cursor.
