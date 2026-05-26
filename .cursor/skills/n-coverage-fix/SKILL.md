---
name: n-coverage-fix
description: >-
  Автономна команда: запускає coverage, читає ## Recommendations у COVERAGE.md, ітеративно пише тести для вижилих мутантів до конвергенції
---

# /n-coverage-fix — ітеративне підвищення mutation score

## Важливо

⚠️ Не запускати паралельно з іншим `/n-coverage-fix` або `bun coverage` — Stryker пише `mutation.json` і `incremental.json` в одну директорію. `n-cursor coverage` всередині вже серіалізований через `withLock('coverage')`, але паралельний запуск двох ітерацій скілу зіпсує дані.

## Мета

Автономно підвищити mutation score: запустити `bun coverage`, записати тести для вижилих мутантів, повторити до конвергенції (score перестав зростати).

## Алгоритм

### Крок 1: Запусти coverage

```bash
bun coverage
```

(або `bun run coverage` якщо команда у `package.json`)

Чекай завершення. Якщо команди немає у `package.json` — запусти `n-cursor coverage` з кореня.

### Крок 2: Прочитай вижилих мутантів

Прочитай `COVERAGE.md` — знайди секцію `## Recommendations`.

Якщо секції немає або вона порожня:
```
✓ Нема вижилих мутантів — mutation score повний
```
→ DONE

Запам'ятай поточний mutation score як `baseline_score` (рядок `| **Разом** |` з таблиці у COVERAGE.md).

### Крок 3: Для кожного файлу з Recommendations — пиши тести

Для кожного `### <file>` у секції:

**3a. Читай контекст:**
- Source-файл (`<file>` від кореня проєкту)
- Таблицю вижилих мутантів: рядок, оригінал, заміна, тип
- Блок `**Приклад наявного тесту:**` — style guide для нових тестів

**3b. Знайди тестовий файл:**
Перший що існує:
1. `<dir>/<basename>.test.js` — поруч із source
2. `<dir>/<basename>.spec.js`
3. `test/<basename>.test.js` від кореня
4. `tests/<basename>.test.js` від кореня

Якщо жоден не знайдено — створи `<dir>/<basename>.test.js` з правильними imports (орієнтуйся на сусідні файли).

**3c. Напиши тести що вбивають кожен мутант:**

Керуйся типом мутації:
- `ConditionalExpression` (`→ false` / `→ true`): протестуй обидва branch явно — значення що робить умову `true` і значення що робить її `false`
- `BooleanLiteral` (`true → false`): перевір початковий стан — `initialValue === false`
- `LogicalOperator` (`&&` ↔ `||`): передай `null` та `undefined` **окремо**, перевір що результат різний для кожного
- `StringLiteral` / `EqualityOperator`: перевір точний рядок/значення, а не лише happy-path

Правила:
- НЕ видаляй і НЕ змінюй наявні тести
- Стиль: той самий `describe`/`it`/`expect`, мова коментарів — як у прикладі тесту
- Якщо `**Приклад наявного тесту:**` відсутній — орієнтуйся на інші test-файли у тій самій директорії

**3d. Після написання тестів:**
```bash
bun test <testFile>
```

Якщо FAIL — виправи саме ті тести що впали (до 2 спроб). Якщо не вдалося — логуй і переходь до наступного файлу.

### Крок 4: Перевір що весь suite проходить

```bash
bun test
```

Якщо FAIL:
- Не відкочувати зміни
- Показати: яка помилка, які файли змінені, що вже покращено
- Очікувати рішення від user: [виправити вручну → продовжити] / [пропустити файл] / [зупинити]

### Крок 5: Запусти coverage і перевір конвергенцію

```bash
bun coverage
```

Якщо CRASH (SIGURG, memory pressure): нагадати user — Stryker incremental зберіг прогрес, перезапустити `bun coverage`.

Прочитай новий COVERAGE.md. Візьми `new_score` з рядка `| **Разом** |`.

**Рішення:**
- Якщо `new_score > baseline_score` → `baseline_score = new_score` → перейти до Кроку 2 (наступна ітерація)
- Якщо `new_score <= baseline_score` → конвергенція:
  ```
  ✓ Конвергенція: mutation score більше не покращується.
  Baseline: <baseline_score> → Фінал: <new_score>
  ```
  → DONE

## Нотатки

- Stryker `incremental` (`incrementalFile`) зберігає прогрес між запусками — crash ≠ перезапуск з нуля
- Не комітити зміни автоматично — user вирішує коли комітити
- Пріоритет файлів: більше вижилих мутантів = важливіший (першим у Recommendations = найважливіший)
- Якщо `COVERAGE.md` відсутній — запусти `bun coverage` спочатку
