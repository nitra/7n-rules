---
type: JS Module
title: docker-nginx-user.mjs
resource: npm/rules/docker/lib/docker-nginx-user.mjs
docgen:
  crc: 26936a1c
---

Модуль `docker-nginx-user.mjs` — це чек-модуль для статичного аналізу Dockerfile (Containerfile), що спеціалізується на фінальному (runtime) `FROM`-stage на базі офіційного образу `nginxinc/nginx-unprivileged`. Належить до набору правил `npm/rules/docker/lib/` і викликається з агрегованого Docker-lint-набору.

Файл вирішує дві суміжні задачі для nginx-unprivileged-stage:

1. **Заборона зайвого `USER`.** Базовий образ `nginxinc/nginx-unprivileged` уже декларує `USER 101` (uid=101) та `EXPOSE 8080`. Будь-яка явна інструкція `USER …` у фінальному stage — це порушення канону:
   - `USER root` (`USER 0`) перезатирає успадкований `USER 101`. Якщо потім non-root не повернути, фінальний образ лишається root, а Kubernetes-pod із `securityContext.runAsNonRoot: true` падає у стан `CreateContainerConfigError`.
   - kubelet перевіряє non-root лише за **числовим** UID, а не за іменем користувача (`nginx`). Тому повернення `USER 101` чи `USER nginx` наприкінці stage саме по собі — симптом зайвого попереднього `USER root`.
   - Безпечний канон — взагалі не виходити з-під дефолтного uid=101: ні `USER root`, ні switch-back. Тому **будь-який** явний `USER`-токен у nginx-unprivileged-stage прапорцюється як зайвий, з диференційованим повідомленням залежно від токена.

2. **Заборона `COPY`/`ADD` без `--chown`.** Без явного `--chown` файли копіюються власником `root:root` і не читаються процесом nginx, який працює від uid=101. Канонічна форма — `COPY --chown=nginx:nginx …` / `ADD --chown=nginx:nginx …`.

Тригер модуля — **лише** фінальний (останній у файлі) `FROM`, який базується на `nginxinc/nginx-unprivileged` (з урахуванням можливих префіксів дзеркала на кшталт `mirror.gcr.io/…` чи `docker.io/…` та будь-якого тега/digest). Build-stage-и не перевіряються — там root і інструменти-помічники є нормою.

Цей чек — це окрема гілка від генеричного non-root-правила для alpine-бекендів (де канон, навпаки, `addgroup`+`adduser`+`USER app`; див. `getNonRootRuntimeHint` у `../js/lint.mjs`).

Шаблон структури base-image-специфічного чек-модуля — сусідній `./docker-mirror.mjs`.

## Експорти / API

Модуль експортує дві публічні функції (ESM-named exports):

| Експорт                                     | Тип                            | Призначення                                                                                                                                                                                                          |
| ------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isNginxUnprivilegedImage(image)`           | `(string) => boolean`          | Перевірити, чи токен `FROM`-образу вказує на `nginxinc/nginx-unprivileged` (з будь-яким тегом і необов'язковим префіксом дзеркала).                                                                                  |
| `getNginxUnprivilegedUserHint(fileContent)` | `(string) => (string \| null)` | Перевірити вміст Dockerfile і повернути готове повідомлення помилки про порушення в nginx-unprivileged-stage, або `null`, якщо порушень немає, або це не nginx-unprivileged-stage, або у файлі взагалі немає `FROM`. |

Внутрішні (не експортуються): `getFinalStage`, `normalizeUserToken`, регулярні вирази `NEWLINE_RE`, `USER_LINE_RE`, `COPY_ADD_RE`, `CHOWN_FLAG_RE`, `NGINX_UNPRIVILEGED_REPO_RE`.

JSDoc-тип, що використовується внутрішньо:

```
@typedef {{ image: string, lines: Array<{ lineNo: number, text: string }> }} FinalStage
```

## Функції

### `isNginxUnprivilegedImage(image)`

**Сигнатура:** `export function isNginxUnprivilegedImage(image: string): boolean`

**Параметри:**

- `image` (`string`) — токен образу, який ідентифікує посилання після інструкції `FROM` у Dockerfile. Допускається `undefined`/`null`/порожній рядок: функція захищена від цього через `(image || '').trim()`.

**Повертає:** `boolean` — `true`, якщо `image` (після тримінгу) збігається з регулярним виразом `NGINX_UNPRIVILEGED_REPO_RE`, тобто містить шлях `nginxinc/nginx-unprivileged`, який або стоїть на початку рядка, або після `/` (це покриває префікси дзеркал на зразок `mirror.gcr.io/nginxinc/nginx-unprivileged` чи `docker.io/nginxinc/nginx-unprivileged`), і за яким іде `:` (тег), `@` (digest) або кінець рядка. Інакше `false`.

**Side effects:** немає. Чиста, ідемпотентна функція.

**Деталі реалізації:** регулярний вираз нечутливий до регістру (прапор `iu`):

```
/(?:^|\/)nginxinc\/nginx-unprivileged(?::|@|$)/iu
```

### `getNginxUnprivilegedUserHint(fileContent)`

**Сигнатура:** `export function getNginxUnprivilegedUserHint(fileContent: string): string | null`

**Параметри:**

- `fileContent` (`string`) — повний текстовий вміст Dockerfile або Containerfile (з можливими `\r\n` чи `\n` як роздільниками рядків).

**Повертає:** `string | null`.

- `null`, якщо:
  - у файлі немає жодного `FROM` (`getFinalStage` повертає `null`);
  - фінальний stage не базується на `nginxinc/nginx-unprivileged`;
  - у фінальному stage не знайдено жодного порушення.
- Інакше — рядок із зібраними повідомленнями про порушення. Кожне повідомлення на окремому рядку, склеєне роздільником `'\n     - '` (символ нового рядка + п'ять пробілів + дефіс із пробілом). Такий роздільник розрахований на форматування у bullet-list у звітах лінтера.

**Кроки алгоритму:**

1. Виділити фінальний stage функцією `getFinalStage(fileContent)`. Якщо `null` — повернути `null`.
2. Перевірити `stage.image` функцією `isNginxUnprivilegedImage`. Якщо не nginx-unprivileged — повернути `null`.
3. Для кожного рядка stage (включно з самим `FROM` — на цьому рядку `USER`/`COPY` неможливі, але цикл лишається загальним для уніфікації):
   - Спробувати зматчити `USER_LINE_RE`. Якщо є збіг — захопити перший аргумент `USER`, нормалізувати через `normalizeUserToken` і додати одне з трьох повідомлень:
     - якщо токен — `root` або `0`: підказка прибрати `USER root`/`USER 0`, бо без switch-back образ лишиться root і k8s `runAsNonRoot` впаде;
     - якщо токен — `101` або `nginx`: підказка прибрати зайвий switch-back — база вже працює від uid=101, повернення USER — симптом зайвого `USER root`;
     - інакше: підказка прибрати будь-який інший явний `USER` — окремий `USER` не потрібен.
   - Після обробки `USER` зробити `continue` (рядок із `USER` уже не може бути одночасно `COPY`/`ADD`).
   - Якщо рядок не `USER`, зматчити `COPY_ADD_RE`. Якщо це `COPY` чи `ADD` **і** в рядку немає прапорця `--chown=` (перевірка `CHOWN_FLAG_RE`) — додати повідомлення з підказкою додати `--chown=nginx:nginx`. У повідомленні інструкція приводиться до верхнього регістру через `.toUpperCase()`.
4. Якщо масив `problems` порожній — повернути `null`, інакше — `problems.join('\n     - ')`.

**Side effects:** немає. Не читає файлову систему, не виконує I/O, не модифікує аргументи.

### `getFinalStage(fileContent)` (внутрішня)

**Сигнатура:** `function getFinalStage(fileContent: string): FinalStage | null`

**Параметри:**

- `fileContent` (`string`) — вміст Dockerfile/Containerfile.

**Повертає:** об'єкт `{ image, lines }` або `null`, якщо у файлі немає `FROM`.

- `image` — токен образу останнього `FROM` (значення, повернене `getFromImageToken` із `./docker-mirror.mjs`);
- `lines` — масив об'єктів `{ lineNo, text }`, де `lineNo` — людиночитабельний номер рядка (1-based), `text` — текст рядка. Масив містить усі рядки **від рядка останнього `FROM` і до кінця файла**.

**Алгоритм:**

1. Розбити `fileContent` на рядки регулярним виразом `NEWLINE_RE` (`/\r?\n/`).
2. Пройти всі рядки, обчислити `getFromImageToken(line)`. Якщо результат істинний — оновити `lastFrom = { image, idx }`. Це гарантує, що `lastFrom` зрештою вкаже на **останній** `FROM` у файлі (фінальний stage).
3. Якщо `lastFrom === null` — повернути `null`.
4. Інакше — вирізати з `lines` хвіст починаючи з `lastFrom.idx` і змапити в `{ lineNo: lastFrom.idx + i + 1, text }`. Зверніть увагу: `lineNo` обчислюється як зсув від `lastFrom.idx` плюс зміщення в хвості плюс 1 — це коректно конвертує 0-based індекс у людиночитабельний 1-based номер рядка вихідного файлу.

**Side effects:** немає.

### `normalizeUserToken(token)` (внутрішня)

**Сигнатура:** `function normalizeUserToken(token: string): string`

**Параметри:**

- `token` (`string`) — захоплена група після ключового слова `USER` (один токен — або UID, або ім'я користувача, без пробілів і коментарів).

**Повертає:** нормалізований рядок:

1. Видаляються подвійні лапки (`"`) через `replaceAll('"', '')`.
2. Видаляються одинарні лапки (`'`) через `replaceAll("'", '')`.
3. Тримаються пробіли по краях (`.trim()`).
4. Все приводиться до нижнього регістру (`.toLowerCase()`).

**Призначення:** дозволяє уніфіковано порівнювати токен із константами `'root'`, `'0'`, `'101'`, `'nginx'` незалежно від того, чи був він написаний як `Root`, `"nginx"`, `'101'` тощо.

**Side effects:** немає.

## Константи та регулярні вирази

| Ім'я                         | Значення                                               | Призначення                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEWLINE_RE`                 | `/\r?\n/`                                              | Розбиття рядка на лінії з підтримкою CRLF.                                                                                                                                                               |
| `USER_LINE_RE`               | `/^\s*USER\s+([^\s#]+)/iu`                             | Розпізнавання інструкції `USER` на початку рядка (допускається ведучий whitespace), захоплює перший токен-аргумент до пробілу чи `#`. Прапори: case-insensitive, Unicode.                                |
| `COPY_ADD_RE`                | `/^\s*(COPY\|ADD)\b(.*)$/iu`                           | Розпізнавання інструкцій `COPY` чи `ADD` на початку рядка. Перша група захоплює саме ім'я інструкції, друга — решту рядка (для діагностики не використовується, окрім потенційних розширень).            |
| `CHOWN_FLAG_RE`              | `/(?:^\|\s)--chown=/iu`                                | Виявлення прапорця `--chown=` у рядку `COPY`/`ADD`. Перевіряє, що прапор стоїть на початку або після whitespace, щоб не сплутати з підрядком в імені файлу.                                              |
| `NGINX_UNPRIVILEGED_REPO_RE` | `/(?:^\|\/)nginxinc\/nginx-unprivileged(?::\|@\|$)/iu` | Точне розпізнавання репозиторію `nginxinc/nginx-unprivileged` — або на початку токена, або після `/` (для дзеркал на зразок `mirror.gcr.io/…`), з допустимим суфіксом `:tag`, `@digest` чи кінцем рядка. |

## Залежності

### Імпорти модуля

- `getFromImageToken` із `./docker-mirror.mjs` — повертає токен образу з рядка `FROM …` (або `null`/`undefined` для не-`FROM`-рядків). Використовується для пошуку **останнього** `FROM` у файлі. Стиль реалізації цього модуля прямо успадковано від `docker-mirror.mjs` (він названий шаблоном для base-image-специфічних чеків).

### Зовнішні залежності

- Жодних npm-пакетів. Тільки стандартні можливості JavaScript (`String.prototype.split`, `String.prototype.match`, `String.prototype.replaceAll`, `Array.prototype.entries`, `Array.prototype.slice`, `Array.prototype.map`, регулярні вирази, шаблонні рядки).

### Сторонні припущення / контекст

- Модуль не виконує файлового I/O — він приймає вже прочитаний рядок із вмістом Dockerfile.
- Очікується, що `getFromImageToken` повертає очищений токен (без коментарів, без `AS <alias>`), або falsy-значення для рядків без `FROM`.
- Модуль розрахований на каноні **дзеркал**: `mirror.gcr.io/nginxinc/nginx-unprivileged:<tag>`, `docker.io/nginxinc/nginx-unprivileged:<tag>`, чисте `nginxinc/nginx-unprivileged:<tag>` тощо. Локальні префікси на зразок `localhost:5000/nginxinc/nginx-unprivileged` також спрацюють — головне, щоб `nginxinc/nginx-unprivileged` стояло після `/`.

## Потік виконання / Використання

Типовий сценарій вбудовування — у Docker-lint-набір, що ітерує всі Dockerfile у репозиторії й агрегує `null`/`string`-повідомлення кількох чек-функцій:

```
import { readFile } from 'node:fs/promises'
import { getNginxUnprivilegedUserHint } from './docker-nginx-user.mjs'

const content = await readFile('Dockerfile', 'utf8')
const hint = getNginxUnprivilegedUserHint(content)
if (hint) {
  console.error(`Dockerfile:\n     - ${hint}`)
  process.exitCode = 1
}
```

Послідовність роботи `getNginxUnprivilegedUserHint`:

1. Викликає `getFinalStage(fileContent)` — розбиває файл на рядки, шукає **останній** `FROM`. Якщо `FROM` немає — `null`.
2. Викликає `isNginxUnprivilegedImage(stage.image)` — швидкий regex-фільтр базового образу. Якщо це не `nginxinc/nginx-unprivileged` — `null` (тобто чек ігнорує сторонні образи й залишає їх іншим правилам).
3. Ітерує рядки фінального stage. Кожен рядок класифікується одним із трьох сценаріїв:
   - **`USER …`** — порушення завжди (для трьох категорій токенів — різні повідомлення):
     - `root`/`0` — попередження про root-escape;
     - `101`/`nginx` — попередження про зайвий switch-back;
     - інше — попередження про зайвий явний `USER`.
   - **`COPY …` / `ADD …` без `--chown=`** — порушення, потрібно додати `--chown=nginx:nginx`.
   - решта (`RUN`, `ENV`, `EXPOSE`, `ENTRYPOINT`, `CMD`, коментарі, порожні рядки тощо) — ігнорується.
4. Якщо порушень не знайдено — `null`. Інакше всі повідомлення склеюються в один рядок із роздільником `'\n     - '` (відформатовано для bullet-list).

**Приклади поведінки:**

- Dockerfile без `FROM` → `null`.
- Dockerfile, де **останній** `FROM` — `node:20-alpine`, навіть якщо раніше був `nginxinc/nginx-unprivileged` як build-stage → `null` (чек дивиться лише на фінальний stage).
- `FROM mirror.gcr.io/nginxinc/nginx-unprivileged:1.27` без `USER` і з `COPY --chown=nginx:nginx ./dist /usr/share/nginx/html` → `null`.
- `FROM nginxinc/nginx-unprivileged:1.27` + `USER root` + `RUN apk add …` + `USER 101` + `COPY ./dist /usr/share/nginx/html` → повідомлення з трьома bullet-пунктами: про `USER root`, про switch-back `USER 101`, про `COPY` без `--chown`.

## Rebuild Test

Після гіпотетичного перепису модуля з нуля для перевірки еквівалентної поведінки використовуйте такий набір кейсів (мінімум, що відтворює всі гілки):

1. **Файл без `FROM`** (`''`, `'# comment\n'`) → `getNginxUnprivilegedUserHint` повертає `null`.
2. **Фінальний `FROM` — інший образ** (`'FROM node:20-alpine\n'`) → `null`.
3. **Фінальний `FROM` — `nginxinc/nginx-unprivileged` без зайвих інструкцій** (`'FROM nginxinc/nginx-unprivileged:1.27\nCOPY --chown=nginx:nginx ./dist /usr/share/nginx/html\n'`) → `null`.
4. **`USER root` усередині nginx-stage** → одне повідомлення з підстрокою `прибери \`USER root\`` і коректним номером рядка.
5. **`USER 0`** → повідомлення з підстрокою `прибери \`USER 0\``.
6. **`USER 101`** → повідомлення з підстрокою про зайвий switch-back і `uid=101`.
7. **`USER nginx`** (у тому числі `USER "nginx"`, `USER 'NGINX'`) → той самий тип повідомлення (нормалізація лапок і регістру).
8. **`USER app`** (інше ім'я) → повідомлення з підстрокою про зайвий явний `USER`.
9. **`COPY ./a ./b`** у nginx-stage → повідомлення `додай \`--chown=nginx:nginx\` до \`COPY\``.
10. **`ADD ./a ./b`** у nginx-stage → повідомлення з `\`ADD\``(верхній регістр, навіть якщо в Dockerfile було`add`).
11. **`COPY --chown=nginx:nginx ./a ./b`** → не прапорцюється.
12. **Кілька порушень одночасно** (USER root + USER 101 + COPY без chown) → рядок із трьома пунктами, склеєними `'\n     - '`.
13. **Префікс дзеркала**: `FROM mirror.gcr.io/nginxinc/nginx-unprivileged:1.27` → активує перевірку. `FROM docker.io/nginxinc/nginx-unprivileged@sha256:…` → також активує.
14. **Регістр і пробіли**: рядок `  user   ROOT  ` (нижній регістр інструкції, лідуючі пробіли, верхній регістр аргументу) → ловиться як `USER root`.
15. **Build-stage із `nginxinc/nginx-unprivileged`, але фінальний — інший** → `null` (чек ігнорує не-фінальні stage).
16. **`isNginxUnprivilegedImage` окремо**:
    - `'nginxinc/nginx-unprivileged:1.27'` → `true`;
    - `'mirror.gcr.io/nginxinc/nginx-unprivileged@sha256:abc'` → `true`;
    - `'nginx:1.27'` → `false`;
    - `''`/`null`/`undefined` → `false` (без винятків).
17. **Номер рядка**: для файлу з порожніми/коментованими рядками перед фінальним `FROM`, повідомлення повинне посилатися на 1-based номер рядка вихідного файла, а не на зміщення всередині stage.

Якщо повний набір кейсів проходить — поведінка переписаного модуля еквівалентна оригіналу.
