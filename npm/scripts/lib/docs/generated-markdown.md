# generated-markdown.mjs

## Огляд

Модуль `generated-markdown.mjs` містить набір чистих утиліт для генерації згенерованих маркдаун-файлів (зокрема `AGENTS.md` та `CLAUDE.md`) у межах CLI `n-cursor`. Він виконує дві основні задачі:

1. Розгортає Mustache-подібні блоки `{{#section}}…{{/section}}` із простою підстановкою одного поля `{{prop}}` для кожного елемента переданого масиву.
2. Нормалізує підсумковий markdown, не лишаючи послідовностей із трьох і більше `\n` (тобто двох і більше порожніх рядків поспіль), щоб результат відповідав правилу markdownlint **MD012** (no multiple blank lines).

Усі функції модуля — суто функціональні (без побічних ефектів, без I/O, без залежностей від глобального стану). Вхід — рядки та звичайні JS-обʼєкти, вихід — рядок.

Файл реалізовано як ES-модуль (ESM), розширення `.mjs`, експорти `export function`.

## Експорти / API

Модуль експортує чотири іменовані функції:

| Експорт                        | Тип                                                                                                                          | Призначення                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `collapseMultipleBlankLines`   | `(text: string) => string`                                                                                                   | Згортає 3+ послідовних `\n` до рівно `\n\n`.                                                                                  |
| `expandMustacheSection`        | `(template: string, section: string, items: Record<string,string>[], prop: string) => string`                                | Розгортає блок `{{#section}}…{{/section}}` для кожного елемента масиву `items`, підставляючи `item[prop]` замість `{{prop}}`. |
| `renderAgentsTemplate`         | `(templateText: string, mdcBasenames: string[], skillItems: { name: string }[], commandItems: { name: string }[]) => string` | Високорівневий рендерер шаблону `AGENTS.template.md`: підставляє списки правил, скілів і команд та нормалізує порожні рядки.  |
| `formatGeneratedMarkdownLines` | `(lines: string[]) => string`                                                                                                | Збирає масив рядків у єдиний markdown-документ із гарантованим завершальним `\n` і без подвійних порожніх рядків.             |

Усі функції детерміновані: для однакових входів повертають однаковий вихід.

## Функції

### `collapseMultipleBlankLines(text)`

**Сигнатура**

```js
export function collapseMultipleBlankLines(text)
```

**Параметри**

- `text` (`string`) — вихідний markdown або будь-який текст. Якщо передано не-рядок, він буде явно скастовано через `String(text)`.

**Повертає**

- `string` — той самий текст, у якому всі послідовності з трьох і більше `\n` замінено на рівно два `\n` (тобто між блоками лишається не більше ніж один порожній рядок).

**Алгоритм**

1. Виконує `String(text)` — захист від нерядкового входу (наприклад, `null`, `undefined`, число, обʼєкт).
2. Викликає `replaceAll(/\n{3,}/g, '\n\n')` — глобальна заміна всіх послідовностей `\n{3,}` на `\n\n`.

**Side effects**

- Немає. Функція чиста.

**Особливості**

- Послідовності `\n\n` (один порожній рядок) залишаються без змін.
- Працює лише з символом `\n`; `\r\n` (CRLF) не нормалізується явно — якщо вхід містить CRLF, регулярка не спрацює на парах `\r\n\r\n\r\n` як на трьох `\n`.

### `expandMustacheSection(template, section, items, prop)`

**Сигнатура**

```js
export function expandMustacheSection(template, section, items, prop)
```

**Параметри**

- `template` (`string`) — вихідний текст шаблону, що може містити нуль чи більше блоків `{{#section}}…{{/section}}`.
- `section` (`string`) — імʼя секції (наприклад, `services`, `skills`, `commands`). Підставляється у відкриваючий тег `{{#section}}` і закриваючий `{{/section}}`.
- `items` (`Record<string, string>[]`) — масив елементів-обʼєктів. Для кожного елемента тіло секції повторюється один раз.
- `prop` (`string`) — імʼя поля, значення якого підставляється замість `{{prop}}` у тілі секції. Значення приводиться до рядка через `String(item[prop])`.

**Повертає**

- `string` — текст шаблону, у якому всі знайдені блоки `{{#section}}…{{/section}}` замінено на згенерований вміст. Якщо блоків немає — повертає вхідний рядок без змін.

**Алгоритм**

1. Будує константи `open = '{{#${section}}}'`, `close = '{{/${section}}}'`, `placeholder = '{{${prop}}}'`.
2. У циклі шукає першу позицію `start = indexOf(open)` та `end = indexOf(close)` у поточному значенні `result`.
3. Поки знайдено валідну пару (`start !== -1 && end !== -1 && end > start`):
   - Витягує `inner = result.slice(start + open.length, end).trim()` — тіло секції без обрамних пробілів/переносів.
   - Для кожного `item` з `items` будує рядок `inner.split(placeholder).join(String(item[prop]))` — повна заміна всіх входжень `placeholder` на значення поля.
   - Зʼєднує всі рендери одним `\n` (без зайвих порожніх рядків між елементами).
   - Підставляє згенерований текст замість усього блоку: `result = result.slice(0, start) + rendered + result.slice(end + close.length)`.
   - Перераховує `start` і `end` для наступної ітерації.
4. Повертає `result`.

**Side effects**

- Немає. Функція чиста.

**Особливості й обмеження**

- Блок підставляється лише за умови `end > start`, тобто закриття має йти після відкриття; вкладені секції з тим самим імʼям не підтримуються.
- `trim()` тіла секції видаляє пробіли/переноси на початку й у кінці — це навмисно, щоб не лишати пустого рядка на стику з оточуючим markdown.
- Plаceholder `{{prop}}` замінюється через `split(...).join(...)` — це еквівалентно глобальній заміні без побудови RegExp.
- Якщо `items` порожній — блок замінюється на порожній рядок (`[].join('\n') === ''`).
- Підстановка `prop` єдина на блок: модуль не підтримує кілька різних змінних усередині одного блоку.

### `renderAgentsTemplate(templateText, mdcBasenames, skillItems, commandItems)`

**Сигнатура**

```js
export function renderAgentsTemplate(templateText, mdcBasenames, skillItems, commandItems)
```

**Параметри**

- `templateText` (`string`) — повний вміст файлу `AGENTS.template.md` із Mustache-блоками `{{#services}}`, `{{#skills}}`, `{{#commands}}` (кожен зі своїм `{{name}}` усередині).
- `mdcBasenames` (`string[]`) — масив імен файлів правил `*.mdc` з каталогу `.cursor/rules` (саме базові імена, без шляху).
- `skillItems` (`{ name: string }[]`) — готові рядки для секції Skills у форматі `{ name: '…' }` (зазвичай вже включають bullet/опис).
- `commandItems` (`{ name: string }[]`) — готові рядки для секції commands у форматі `{ name: '…' }`.

**Повертає**

- `string` — готовий вміст `AGENTS.md` із розгорнутими секціями та згорнутими подвійними порожніми рядками.

**Алгоритм**

1. Перетворює `mdcBasenames` на `serviceItems` виду `{ name: '- .cursor/rules/${mdcName}' }` — додає префікс маркера списку й каталог `.cursor/rules/`.
2. Послідовно викликає `expandMustacheSection` для трьох секцій:
   - `services` із `serviceItems` і ключем `name`;
   - `skills` із `skillItems` і ключем `name`;
   - `commands` із `commandItems` і ключем `name`.
3. Передає результат у `collapseMultipleBlankLines` і повертає його.

**Side effects**

- Немає. Файлову систему не читає й не пише — лише трансформує переданий рядок.

**Особливості**

- Ключ `name` зашитий у функцію — структура `skillItems` і `commandItems` має містити саме поле `name`.
- Кожен елемент `mdcBasenames` форматується як bullet списку (`- ...`) у єдиному стилі.

### `formatGeneratedMarkdownLines(lines)`

**Сигнатура**

```js
export function formatGeneratedMarkdownLines(lines)
```

**Параметри**

- `lines` (`string[]`) — масив рядків markdown-документа. Кожен елемент — окремий «рядок» (може бути порожнім або містити кілька логічних рядків).

**Повертає**

- `string` — підсумковий текст, у якому:
  - елементи `lines` зʼєднано через `\n`;
  - послідовності з 3+ `\n` згорнуто до `\n\n` (через `collapseMultipleBlankLines`);
  - гарантовано додано завершальний `\n`, якщо його не було.

**Алгоритм**

1. `text = lines.join('\n')` — конкатенація через символ переносу рядка.
2. `collapsed = collapseMultipleBlankLines(text)` — нормалізація порожніх рядків.
3. Якщо `collapsed.endsWith('\n')` — повернути як є; інакше повернути `collapsed + '\n'`.

**Side effects**

- Немає.

**Особливості**

- Завершальний `\n` гарантує, що згенерований файл закінчується новим рядком (вимога багатьох лінтерів і POSIX-конвенції).
- Жодних відступів чи табуляцій функція не корегує — лише вертикальну щільність.

## Залежності

### Зовнішні

- Жодних. Модуль не імпортує нічого ні з `node:*`, ні з npm-пакетів, ні з інших файлів проєкту.

### Внутрішні (між функціями модуля)

- `renderAgentsTemplate` використовує `expandMustacheSection` (тричі) і `collapseMultipleBlankLines` (один раз).
- `formatGeneratedMarkdownLines` використовує `collapseMultipleBlankLines`.
- `collapseMultipleBlankLines` і `expandMustacheSection` — незалежні низькорівневі будівельні блоки.

### Runtime

- ECMAScript із підтримкою:
  - `String.prototype.replaceAll` (Node.js ≥ 15);
  - класичних `String.prototype.indexOf`, `slice`, `split`, `join`, `trim`, `endsWith`;
  - синтаксису ESM (`export function`).

## Потік виконання / Використання

Типовий потік генерації `AGENTS.md`:

1. Викликач (CLI `n-cursor`) читає шаблон `AGENTS.template.md` з файлової системи.
2. Збирає три масиви даних:
   - список `*.mdc`-файлів із `.cursor/rules` (через `fs.readdir` або еквівалент);
   - метадані скілів (`name` уже з bullet/описом);
   - метадані команд (`name` уже з bullet/описом).
3. Викликає `renderAgentsTemplate(templateText, mdcBasenames, skillItems, commandItems)`.
4. Записує отриманий рядок у файл `AGENTS.md` (наприклад, через `fs.writeFile`).

Типовий потік генерації багаторядкового документа (наприклад, `CLAUDE.md`):

1. Викликач формує масив рядків `lines` — заголовки, абзаци, bullet-и тощо. Між логічними секціями може лишатися кілька порожніх рядків.
2. Викликає `formatGeneratedMarkdownLines(lines)` — отримує цілісний документ із чистими стиками секцій та фінальним `\n`.
3. Записує результат у файл.

Приклад використання `expandMustacheSection` ізольовано:

```js
import { expandMustacheSection } from './generated-markdown.mjs'

const tpl = '# Rules\n{{#services}}- {{name}}\n{{/services}}\nEnd'
const out = expandMustacheSection(tpl, 'services', [{ name: 'a.mdc' }, { name: 'b.mdc' }], 'name')
// out === '# Rules\n- a.mdc\n- b.mdc\nEnd'
```

Приклад використання `collapseMultipleBlankLines`:

```js
import { collapseMultipleBlankLines } from './generated-markdown.mjs'

const cleaned = collapseMultipleBlankLines('A\n\n\n\nB')
// cleaned === 'A\n\nB'
```

Приклад використання `formatGeneratedMarkdownLines`:

```js
import { formatGeneratedMarkdownLines } from './generated-markdown.mjs'

const md = formatGeneratedMarkdownLines(['# Title', '', '', '', 'Body'])
// md === '# Title\n\nBody\n'
```

## Rebuild Test

Контрольний приклад для перевірки коректності модуля після рефакторингу:

Дано шаблон:

```text
# Agents

## Services
{{#services}}
{{name}}
{{/services}}

## Skills
{{#skills}}
{{name}}
{{/skills}}

## Commands
{{#commands}}
{{name}}
{{/commands}}
```

і виклик:

```js
renderAgentsTemplate(template, ['n-bun.mdc', 'n-vue.mdc'], [{ name: '- /n-fix — fix' }], [{ name: '- /n-lint — lint' }])
```

Очікувані властивості результату:

- секція `services` містить рядки `- .cursor/rules/n-bun.mdc` і `- .cursor/rules/n-vue.mdc`, розділені одним `\n`;
- секція `skills` містить рядок `- /n-fix — fix`;
- секція `commands` містить рядок `- /n-lint — lint`;
- ніде немає трьох поспіль `\n` (тобто не зʼявляються два порожніх рядки підряд);
- виклик `formatGeneratedMarkdownLines(result.split('\n'))` повертає той самий зміст із гарантованим завершальним `\n`.
