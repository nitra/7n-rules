# docker-mirror.mjs

## Огляд

Модуль `docker-mirror.mjs` — це частина правила `n-docker` (тека `npm/rules/docker/lib/`) монорепо `n-cursor`. Він реалізує чисту (без I/O, без побічних ефектів) бібліотеку функцій для статичного аналізу директив `FROM` у файлах `Dockerfile` / `Containerfile` та визначає, чи звертається образ до Docker Hub без використання GCR-дзеркала `mirror.gcr.io`.

Призначення:

- Перевірити, що базові образи з обмеженого списку популярних публічних репозиторіїв (`oven/bun`, `library/alpine`, `library/nginx`, `library/node`, `nginxinc/nginx-unprivileged`) тягнуться не напряму з Docker Hub, а через дзеркало `mirror.gcr.io` (зменшує ризики rate limiting Docker Hub та підвищує доступність CI/CD).
- Виявити порушення й сформувати людиночитане повідомлення з номером рядка та рекомендованим референсом образу.

Модуль свідомо ігнорує приватні реєстри (наприклад, `gcr.io/foo/bar`, `registry.example.com:5000/app`, IP-адреси, `localhost`). Канонічні заміни:

- `oven/bun` → `mirror.gcr.io/oven/bun`
- `library/alpine` → `mirror.gcr.io/library/alpine`
- `library/nginx` → `mirror.gcr.io/library/nginx`
- `library/node` → `mirror.gcr.io/library/node`
- `nginxinc/nginx-unprivileged` → `mirror.gcr.io/nginxinc/nginx-unprivileged`

Модуль є чистим: жодних звернень до файлової системи, мережі, глобального стану. Усі експортовані функції детерміновані й безпечні для повторного виклику.

## Експорти / API

Файл є ES-модулем (`.mjs`) і експортує чотири іменовані функції; стандартного експорту немає.

| Експорт                     | Тип                                       | Призначення                                                              |
| --------------------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| `getFromImageToken`         | `(line: string) => string \| null`        | Витягує токен образу з рядка `FROM` Dockerfile.                          |
| `isDockerHubStyleImageRef`  | `(imageToken: string) => boolean`         | Повертає `true`, якщо посилання схоже на Docker Hub.                     |
| `normalizeHubRepoPath`      | `(imageToken: string) => string`          | Нормалізує шлях репозиторію (без тега/digest) у канонічну форму.         |
| `getRequiredMirrorGcrImage` | `(imageToken: string) => string \| null`  | Повертає рекомендований `mirror.gcr.io/...`-референс, якщо потрібен.     |
| `getMirrorGcrHint`          | `(fileContent: string) => string \| null` | Сканує вміст Dockerfile та повертає підказку про порушення (або `null`). |

Внутрішні (не експортовані) допоміжні елементи:

- Константи-регулярки: `FROM_LINE_RE`, `TOKEN_RE`, `MIRROR_GCR_RE`, `IP_LIKE_RE`, `HOST_PORT_RE`, `DOCKER_IO_PREFIX_RE`, `NEWLINE_SPLIT_RE`.
- Функція `stripFromImageQuotes(t)` — знімає зовнішні одинарні/подвійні лапки з токена.
- `HUB_REPOS_REQUIRING_MIRROR` — `Set` із п'яти канонічних шляхів репозиторіїв, що підлягають дзеркалу.
- `EXPECTED_MIRROR` — `Record<string, string>` із зіставленням канонічний шлях → рекомендований `mirror.gcr.io/...` префікс.

## Функції

### `stripFromImageQuotes(t)`

Внутрішня (не експортована) утиліта.

- **Сигнатура:** `(t: string) => string`
- **Параметри:**
  - `t` — токен образу, можливо обгорнутий парою `"…"` або `'…'`.
- **Повертає:** ту саму рядкову форму без зовнішньої пари лапок, якщо довжина ≥ 2 і перший символ — `"` або `'`. Інакше — рядок без змін.
- **Side effects:** немає (чиста функція).
- **Особливості:** не валідовує парність лапок (просто зрізає перший і останній символи). Передбачає, що вхід уже виокремлено токенайзером, який сам парує лапки (`TOKEN_RE`).

### `getFromImageToken(line)`

Експортована.

- **Сигнатура:** `(line: string) => string | null`
- **Параметри:**
  - `line` — один рядок із Dockerfile.
- **Повертає:**
  - Токен образу (без зовнішніх лапок), напр. `node:20-alpine`, `mirror.gcr.io/oven/bun:1.2`, `gcr.io/distroless/static@sha256:…`.
  - `null`, якщо рядок не директива `FROM` або токен не вдалося виокремити (порожньо, лише прапорці тощо).
- **Алгоритм:**
  1. Зрізає inline-коментар: `line.split('#')[0].trim()`.
  2. Перевіряє, що результат починається з `FROM ` (case-insensitive) через `FROM_LINE_RE`.
  3. Розбиває залишок на токени за `TOKEN_RE` — регулярка зберігає вміст у лапках як один токен.
  4. Циклом проходить токени, ігноруючи прапорці:
     - `--platform=…` — один токен, пропустити.
     - `--platform` без `=` — пропустити 2 токени (прапорець + значення), або 1, якщо значення відсутнє.
     - `--` або `AS` (case-insensitive) — припиняє пошук (повертає `null`, якщо токен ще не знайдено).
     - Інший `--key=value` — пропустити 1 токен.
     - Інший `--key` — пропустити 1 токен (припускає, що це boolean-прапорець без значення; це може бути неточно для прапорців із наступним значенням, окрім `--platform`).
     - Перший не-прапорцевий токен — це образ; повертає `stripFromImageQuotes(token)`.
- **Side effects:** немає.
- **Особливості:**
  - Не валідовує синтаксис Dockerfile повністю: підтримує найрозповсюдженіші форми `FROM`.
  - Не розпізнає неіменованих прапорців із наступним значенням (`--foo bar`) — `bar` буде сприйнято як токен образу. Це компроміс заради простоти; для канонічного Dockerfile `--platform` — єдиний релевантний випадок.
  - Залишок після образу (наприклад, `AS base`) не повертається.

### `isDockerHubStyleImageRef(imageToken)`

Експортована.

- **Сигнатура:** `(imageToken: string) => boolean`
- **Параметри:**
  - `imageToken` — ref образу (як повертає `getFromImageToken`).
- **Повертає:** `true`, якщо посилання виглядає як pull із Docker Hub; інакше `false`.
- **Алгоритм:**
  1. Порожнє/falsy значення → `false`.
  2. Починається з `mirror.gcr.io/` (за `MIRROR_GCR_RE`) → `false` (це вже дзеркало, не Hub).
  3. Зрізає `@digest` (`imageToken.split('@')[0]`).
  4. Якщо немає `/` — це коротке ім'я (`node:20`, `alpine`) → `true`.
  5. Виокремлює перший сегмент `first = noDigest.split('/')[0]`.
  6. `first === 'docker.io'` або `first === 'index.docker.io'` → `true`.
  7. Якщо `first` містить крапку (`.`) — це FQDN чужого реєстру (`gcr.io`, `ghcr.io`, `registry.example.com`) → `false`.
  8. `first === 'localhost'` або відповідає IP-патерну `^\d+\.\d+` → `false` (приватний/локальний реєстр).
  9. Містить `:` й відповідає `^\S+:\d+$` (host:port) → `false`.
  10. Інакше → `true` (типова форма `user/repo` або `org/image:tag`, яку Docker за замовчуванням резолвить через Docker Hub).
- **Side effects:** немає.
- **Особливості:** правило "крапка у першому сегменті = чужий реєстр" — Docker-канонічне евристичне правило (Docker CLI використовує його для розрізнення `docker.io/library/foo` від коротких посилань).

### `normalizeHubRepoPath(imageToken)`

Експортована.

- **Сигнатура:** `(imageToken: string) => string`
- **Параметри:**
  - `imageToken` — ref образу (передбачається, що це Hub-style, як після `isDockerHubStyleImageRef`).
- **Повертає:** канонічний шлях репозиторію (lower-case, без тега, без digest, без префіксу `docker.io/`):
  - `node` → `library/node`
  - `node:20-alpine` → `library/node`
  - `docker.io/oven/bun:1.2` → `oven/bun`
  - `index.docker.io/library/alpine` → `library/alpine`
  - `oven/bun@sha256:…` → `oven/bun`
- **Алгоритм:**
  1. Зрізає `@digest`, переводить у lower-case.
  2. Зрізає префікс `docker.io/` або `index.docker.io/` (через `DOCKER_IO_PREFIX_RE`).
  3. Якщо немає `/` — це коротке ім'я: повертає `library/<name>` (де `<name>` — частина до `:`).
  4. Інакше шукає останній `/` і останній `:`. Якщо `:` йде після `/`, це тег — зрізає від нього й до кінця.
- **Side effects:** немає.
- **Особливості:** уважно обробляє port-у-host (`host:5000/foo`) для випадків, коли функцію викликають на не-Hub посиланнях — порт перед `/` зберігається, тільки тег після останнього `/` зрізається. Однак функція передбачена для Hub-посилань і не повинна викликатися на FQDN.

### `getRequiredMirrorGcrImage(imageToken)`

Експортована.

- **Сигнатура:** `(imageToken: string) => string | null`
- **Параметри:**
  - `imageToken` — ref після `FROM` (як повертає `getFromImageToken`).
- **Повертає:**
  - Рекомендований `mirror.gcr.io/...` шлях (без тега й digest), якщо образ Hub-style і входить до `HUB_REPOS_REQUIRING_MIRROR`.
  - `null`, якщо: токен порожній; вже використовує `mirror.gcr.io/...`; не Hub-style; нормалізований шлях не входить до списку.
- **Алгоритм:**
  1. `!imageToken` → `null`.
  2. `MIRROR_GCR_RE.test(imageToken)` → `null` (вже на дзеркалі).
  3. `!isDockerHubStyleImageRef(imageToken)` → `null` (приватний реєстр).
  4. `norm = normalizeHubRepoPath(imageToken)`.
  5. Якщо `!HUB_REPOS_REQUIRING_MIRROR.has(norm)` → `null` (інший Hub-образ, правило не застосовується).
  6. Повертає `EXPECTED_MIRROR[norm]`.
- **Side effects:** немає.

### `getMirrorGcrHint(fileContent)`

Експортована.

- **Сигнатура:** `(fileContent: string) => string | null`
- **Параметри:**
  - `fileContent` — повний вміст Dockerfile/Containerfile (рядки розділені `\n` або `\r\n`).
- **Повертає:**
  - Рядок виду `рядок <N>: FROM має тягнути mirror.gcr.io/<repo> (замість <orig-token>)` — для першого знайденого порушення.
  - `null`, якщо порушень немає.
- **Алгоритм:**
  1. Ділить контент на рядки за `NEWLINE_SPLIT_RE` (`/\r?\n/`).
  2. Ітерує з індексом (`.entries()`); номер рядка у повідомленні — `n + 1` (1-based).
  3. Для кожного рядка: `image = getFromImageToken(line)`; `expected = getRequiredMirrorGcrImage(image)`.
  4. Перший рядок, де `expected` істинний (string), формує повідомлення і функція повертається.
- **Side effects:** немає.
- **Особливості:**
  - Зупиняється на першому порушенні (fail-fast). Якщо в одному Dockerfile є кілька `FROM` із порушеннями — повідомлено буде лише про перший.
  - Текст повідомлення українською (узгоджується з мовою спец-документів проєкту).

## Залежності

- **Зовнішні модулі:** немає (`import`/`require` відсутні).
- **Внутрішні модулі:** немає; модуль самодостатній.
- **Глобальні API:** виключно стандартний JavaScript — `RegExp`, `String.prototype` (`split`, `trim`, `match`, `slice`, `toLowerCase`, `replace`, `includes`, `startsWith`, `lastIndexOf`), `Set`, `Array.prototype.entries`.
- **Runtime:** ESM, працює в Node.js та Bun. Розширення `.mjs` обов'язкове за правилом `n-bun`/`n-js-run`.
- **JSDoc типи:** використовуються `@type`, `@param`, `@returns` із касти `/** @type {const} */` для імутабельних літералів — допомагають TypeScript/JSDoc-перевірці й ESLint.

## Потік виконання / Використання

### Типовий сценарій інтеграції

Модуль використовується перевіркою правила `n-docker` (вочевидь, файл `check-*.mjs` у `npm/rules/docker/`), яка:

1. Знаходить усі `Dockerfile` / `Containerfile` у воркспейсі.
2. Для кожного зчитує вміст і передає в `getMirrorGcrHint(content)`.
3. Якщо результат — рядок, репортує його як порушення лінтера/правила.

### Програмний приклад

```js
import { getMirrorGcrHint } from './docker-mirror.mjs'

const dockerfile = `
# syntax=docker/dockerfile:1
FROM --platform=linux/amd64 node:20-alpine AS builder
RUN bun install
FROM mirror.gcr.io/library/nginx:1.27
COPY --from=builder /app /usr/share/nginx/html
`

const hint = getMirrorGcrHint(dockerfile)
if (hint) {
  console.error(hint)
  // → рядок 3: FROM має тягнути mirror.gcr.io/library/node (замість node:20-alpine)
}
```

### Гранулярне використання

```js
import {
  getFromImageToken,
  isDockerHubStyleImageRef,
  normalizeHubRepoPath,
  getRequiredMirrorGcrImage
} from './docker-mirror.mjs'

const token = getFromImageToken('FROM --platform=$BUILDPLATFORM oven/bun:1.2 AS bun')
// → 'oven/bun:1.2'

isDockerHubStyleImageRef(token) // → true
normalizeHubRepoPath(token) // → 'oven/bun'
getRequiredMirrorGcrImage(token) // → 'mirror.gcr.io/oven/bun'

getRequiredMirrorGcrImage('gcr.io/foo/bar') // → null (чужий реєстр)
getRequiredMirrorGcrImage('mirror.gcr.io/library/node') // → null (вже на дзеркалі)
getRequiredMirrorGcrImage('redis:7') // → null (не в списку)
```

### Покриті випадки

- `FROM node` — коротке ім'я, рекомендує `mirror.gcr.io/library/node`.
- `FROM library/alpine:3.19` — Hub з явним `library/`, рекомендує `mirror.gcr.io/library/alpine`.
- `FROM docker.io/oven/bun:1.2` — Hub з явним хостом, рекомендує `mirror.gcr.io/oven/bun`.
- `FROM --platform=linux/arm64 nginx AS base` — пропускає прапорці й `AS`.
- `FROM "node:20"` — знімає лапки.
- `FROM nginxinc/nginx-unprivileged:1.27` — Hub-style з користувацьким наміспейсом, рекомендує `mirror.gcr.io/nginxinc/nginx-unprivileged`.

### Випадки, що не вважаються порушенням

- `FROM gcr.io/distroless/static` — крапка в першому сегменті → чужий реєстр.
- `FROM localhost:5000/myapp` — `localhost` + порт → приватний реєстр.
- `FROM 10.0.0.1/internal/app` — IP-патерн → приватний реєстр.
- `FROM mirror.gcr.io/library/node:20` — вже використовує дзеркало.
- `FROM redis:7` — Hub, але не в списку контрольованих репозиторіїв.
- `FROM scratch` — `scratch` нормалізується до `library/scratch`, але його немає в `HUB_REPOS_REQUIRING_MIRROR`.

### Обмеження й нюанси

- Перевірка зупиняється на першому порушенні в файлі. Якщо потрібно зібрати всі порушення — функцію треба інтегрувати на рівні викликача (наприклад, проходом по `fileContent.split('\n')` із власною агрегацією).
- Багаторядкові `FROM` із продовженням рядка через `\` не підтримуються (Dockerfile-специфіка така, що `FROM` зазвичай одно-рядковий, але формально це можливо).
- Інші прапорці з пробільним значенням (наприклад, гіпотетичне `--foo bar`) можуть бути неточно розпарсені — `bar` буде сприйнято як токен образу. Для канонічних Dockerfile цей випадок не реалістичний.
- Heredoc-форма Dockerfile (`FROM <<EOF`) явно не підтримується.
- Регістр літерала `FROM` нечутливий (`FROM_LINE_RE` має флаг `i`); літерал `AS` теж нечутливий (порівняння через `.toUpperCase()`); імена реєстрів і репозиторіїв нормалізуються через `.toLowerCase()`.
