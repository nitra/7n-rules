---
type: JS Module
title: main.mjs
resource: plugins/lang-python/rules/python/mypy/main.mjs
docgen:
  crc: 3450fff6
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Please provide the draft section "overview" that needs revision, according to the context and requirements.

## Поведінка

1. Перевіряє наявність файлу `pyproject.toml` у кореневій директорії проєкту. Якщо його немає, перевірка не виконується.
2. Визначає цільові файли для перевірки: або всі `.py` файли у проєкті, або лише ті, що передані в контекст.
3. Перевіряє наявність у системному шляху інструмента `uv` та доступності `mypy` у середовищі `uv`. Якщо `uv` або `mypy` недоступні, перевірка пропускається.
4. Запускає `mypy` через `uv run --frozen` для визначених цільових файлів, передаючи поточну робочу директорію проєкту як робочу директорію для виконання.
5. Якщо `mypy` завершується з ненульовим кодом, фіксується порушення з виводом команди та кодом помилки.
6. Якщо `mypy` завершується успішно, результати перевірки вважаються позитивними.

## Публічний API

lint — виявляє помилки в коді Python за допомогою mypy.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
