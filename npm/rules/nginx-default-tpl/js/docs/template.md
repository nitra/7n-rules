# template.mjs — перевірка nginx-шаблону (правило `nginx-default-tpl`)

## Огляд

Модуль реалізує JS-частину правила `nginx-default-tpl.mdc`. Він шукає у проєкті файли `default.conf.template` (типовий nginx-шаблон, який рендериться `envsubst` під час старту контейнера) і пов'язані з ними артефакти, після чого:

1. виконує міграції старих/невалідних артефактів у канонічний вигляд:
   - перейменовує застаріле `default.tpl.conf` у `default.conf.template` (або перезаписує контентом, якщо ціль уже є, після чого видаляє джерело);
   - замінює невалідну директиву `error_log off;` на канонічну `error_log /dev/null crit;`;
2. перевіряє вміст кожного `default.conf.template` на наявність обов'язкових директив (порт `8080`, `/healthz`, `gzip_static`, `try_files`, `server_tokens off`, `sendfile_max_chunk` тощо) і **відсутність** будь-яких `*_pass` директив (`proxy_pass`, `fastcgi_pass`, `grpc_pass`, `uwsgi_pass` тощо — бекенд-логіка має бути винесена в HTTPRoute на рівні k8s);
3. перевіряє, що поруч із шаблоном є щонайменше один `*.ini` (values для середовища), а кожен ключ з ini використовується в шаблоні як `$KEY` (контракт `envsubst`);
4. перевіряє, що в будь-якому `Dockerfile` / `Containerfile` репозиторію є крок стиснення статики `find … /usr/share/nginx/html … gzip -k` і виклик `envsubst` з `default.conf.template`;
5. делегує валідацію `.vscode/extensions.json` і `.vscode/settings.json` rego-пакетам `nginx_default_tpl.vscode_extensions` / `nginx_default_tpl.vscode_settings` через `runConftestBatch`.

Перевірка є **умовною**: якщо в дереві (після міграції) немає жодного `default.conf.template`, увесь крок пропускається з exit-кодом `0`. Приклад HTTPRoute з правила залишений лише для рев'ю — функція `httpRouteMatchesNginxDefaultTpl` присутня в експорті як інструмент для тестів і потенційного майбутнього вузького застосування, але в `check()` зараз **не** викликається (через різнорідність схем маршрутизації в продукті).

### Канонічні константи

Літерали правила, винесені в регулярні вирази й рядки модуля:

- порт listen: `8080`;
- кореневий каталог статики: `/usr/share/nginx/html`;
- директива заміни невалідного логу: `error_log /dev/null crit;`;
- розширення для стиснення: `*.{js,css}` (через `GZIP_EXTENSION_RE`).

## Експорти / API

Усі експорти — іменовані; default-експорту немає.

| Символ                                             | Тип            | Призначення                                                                            |
| -------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------- |
| `findDefaultConfTemplatePaths(root, ignorePaths?)` | async function | Збирає абсолютні шляхи всіх `default.conf.template` у дереві (виключаючи `fixtures/`). |
| `migrateDefaultTplConfFiles(root, ignorePaths?)`   | async function | Мігрує застарілі `default.tpl.conf` у `default.conf.template`.                         |
| `migrateErrorLogOffDirective(root, ignorePaths?)`  | async function | Замінює `error_log off;` на `error_log /dev/null crit;` у всіх знайдених шаблонах.     |
| `parseIniVariableNames(iniText)`                   | function       | Витягує імена ключів з тексту `.ini` (рядки виду `KEY=value`).                         |
| `nginxTemplateViolations(content)`                 | function       | Повертає перше порушення канону шаблону або `null`.                                    |
| `httpRouteMatchesNginxDefaultTpl(manifest)`        | function       | Перевіряє структуру `HTTPRoute` (зараз не використовується в `check()`).               |
| `iniKeysMissingInTemplate(keys, template)`         | function       | Повертає повідомлення про першу ключ-змінну з `*.ini`, якої немає в шаблоні як `$KEY`. |
| `check(cwd?)`                                      | async function | Головна точка входу правила; повертає `0`/`1` як код виходу.                           |

Внутрішні (не експортовані) хелпери:

- `dockerfileHasGzipStaticPipeline(dockerfileContent)` — детектор стиснення статики в Dockerfile;
- `dockerfileHasEnvsSubstTemplate(dockerfileContent)` — детектор кроку `envsubst` із шаблоном;
- `checkTemplateFile(abs, root, passFn, failFn)` — перевірка одного шаблону й сусідніх `*.ini`;
- `checkDockerfiles(root, ignorePaths, passFn, failFn)` — перевірка Dockerfile'ів проєкту;
- `checkVscodeNginx(passFn, failFn, cwd)` — делегування у rego-перевірки VSCode-конфігів.

## Функції

### `findDefaultConfTemplatePaths(root, ignorePaths = [])`

**Сигнатура:** `async (root: string, ignorePaths?: string[]) => Promise<string[]>`

**Параметри:**

- `root` — абсолютний корінь обходу (зазвичай `process.cwd()` репозиторію);
- `ignorePaths` — список абсолютних шляхів каталогів, повністю виключених з обходу (зчитується з `.cursorignore` / `.gitignore` через `loadCursorIgnorePaths`).

**Повертає:** відсортований (`localeCompare`) масив абсолютних шляхів до файлів з іменем `default.conf.template`.

**Поведінка:** обходить дерево через `walkDir`, додає тільки шляхи з базовим іменем `default.conf.template`. Будь-який шлях, у якому хоч один сегмент дорівнює `fixtures`, пропускається — це покриває як кореневі `tests/fixtures/`, так і co-located `rules/<rule>/js/<concern>/fixtures/`. Перед порівнянням бекслеші у відносному шляху нормалізуються в `/` (Windows-safe).

**Side effects:** виключно читання дерева ФС через `walkDir`.

---

### `migrateDefaultTplConfFiles(root, ignorePaths = [])`

**Сигнатура:** `async (root: string, ignorePaths?: string[]) => Promise<{ renamed: string[], overwritten: string[] }>`

**Параметри:** аналогічні `findDefaultConfTemplatePaths`.

**Повертає:** об'єкт з двома масивами відносних (від `root`) шляхів колишніх `default.tpl.conf`:

- `renamed` — файл був просто перейменований у `default.conf.template`;
- `overwritten` — поруч уже існував `default.conf.template`, тому його вміст замінено вмістом `default.tpl.conf`, а сам `default.tpl.conf` видалено.

**Поведінка:**

1. збирає всі `default.tpl.conf` через `walkDir` і сортує їх для детермінованого порядку обробки;
2. для кожного шляху обчислює цільовий `default.conf.template` у тому ж каталозі (`dirname` + `join`);
3. якщо ціль існує (`existsSync`) — читає вміст `default.tpl.conf`, записує його в `default.conf.template` (`writeFile` з `utf8`), видаляє джерело (`unlink`);
4. інакше виконує `rename(old → new)`.

**Side effects:** мутація ФС — записи, перейменування, видалення файлів. Усі шляхи в звіті нормалізовані `/`-роздільником.

---

### `migrateErrorLogOffDirective(root, ignorePaths = [])`

**Сигнатура:** `async (root: string, ignorePaths?: string[]) => Promise<string[]>`

**Параметри:** аналогічні попереднім міграційним функціям.

**Повертає:** відносні шляхи шаблонів, у яких було виконано заміну (для звіту `pass`).

**Поведінка:** для кожного `default.conf.template`, знайденого `findDefaultConfTemplatePaths`, читає вміст, виконує заміну `ERROR_LOG_OFF_RE → ERROR_LOG_CANONICAL` (тобто `error_log\s+off\s*;` → `error_log /dev/null crit;`). Якщо текст не змінився — файл не переписується (раннє `continue`); інакше — `writeFile` з `utf8`.

**Мотивація:** `error_log off;` у nginx **не** валідна директива — `off` трактується як ім'я файлу (`/etc/nginx/off`), і під `readOnlyRootFilesystem` контейнер падає. `/dev/null` — writable character device і коректно «вимикає» лог.

**Side effects:** перезапис вмісту шаблонів на місці.

---

### `parseIniVariableNames(iniText)`

**Сигнатура:** `(iniText: string) => string[]`

**Параметри:**

- `iniText` — повний текст INI-файлу.

**Повертає:** масив імен ключів у порядку появи (дублікати не дедуплікуються; вони з'являться стільки разів, скільки разів зустрілися).

**Поведінка:** розбиває вхід за `LINE_SPLIT_RE` (`\r?\n`), для кожного рядка обрізає пробіли (`trim()`), пропускає порожні й коментарі (`#`, `;`), решту матчить регексом `INI_KEY_RE = /^([A-Za-z_]\w*)\s*=/` і додає першу групу. Секції (`[section]`) ігноруються природним чином, бо не матчаться регексом.

**Side effects:** немає, чиста функція.

---

### `nginxTemplateViolations(content)`

**Сигнатура:** `(content: string) => string | null`

**Параметри:**

- `content` — повний текст `default.conf.template`.

**Повертає:** рядок з першим знайденим порушенням або `null`, якщо шаблон валідний.

**Поведінка:** проходить упорядкований список правил і повертає повідомлення першого, чий предикат `ok(content)` повернув `false`. Порядок матеріалізовано в коді; перелік правил, що перевіряються (у порядку виконання):

1. наявність `server_tokens off`;
2. наявність `port_in_redirect off`;
3. наявність `client_max_body_size 0`;
4. наявність `client_body_buffer_size 512M`;
5. наявність `listen 8080`;
6. наявність `server_name _`;
7. наявність `access_log off`;
8. наявність `error_log /dev/null crit` (саме така форма; `error_log off` не валідний);
9. наявність `root /usr/share/nginx/html`;
10. `location /healthz` повертає healthy (підрядок `healthy` **або** `return\s+200`);
11. `location` для статики без gzip — мають бути присутні підрядки `gif|jpe?g|png|ico|woff2|xlsx`, `31536000` та `alias /usr/share/nginx/html/`;
12. `location` для текстової статики з gzip — підрядок `svg|js|css|ttf|map|xml|webmanifest|wasm`;
13. `gzip_static on` зустрічається **щонайменше двічі** (для двох location-блоків зі стисненням);
14. використання `$PUBLIC_PATH` у будь-якому location;
15. наявність `sendfile on`, `sendfile_max_chunk 512k`, `tcp_nopush on`;
16. наявність `try_files $uri $uri/ /index.html =404`.

Після всіх «позитивних» правил додатково перевіряється негативне: якщо регекс `PROXY_LIKE_RE` (`proxy_pass|proxy_redirect|proxy_set_header|proxy_http_version|fastcgi_pass|grpc_pass|uwsgi_pass`) **матчить** вміст, повертається повідомлення про `*_pass` із вказівкою винести логіку в HTTPRoute. У коді є директива `// cspell:ignore fastcgi uwsgi`, щоб ці назви не лаялися спелчекером.

**Side effects:** немає.

---

### `httpRouteMatchesNginxDefaultTpl(manifest)`

**Сигнатура:** `(manifest: unknown) => boolean`

**Параметри:**

- `manifest` — десеріалізований корінь YAML-документа (об'єкт, мапа, або довільне значення з парсера).

**Повертає:** `true`, якщо структура збігається з еталонним прикладом `HTTPRoute` з `nginx-default-tpl.mdc`; інакше `false`.

**Поведінка:** ретельно гардить кожен шар від `null`/`undefined`/масивів/не-об'єктів і перевіряє:

- `kind === 'HTTPRoute'`;
- `spec` — об'єкт, не масив;
- `spec.rules` — масив довжиною ≥ 2;
- у `rules[0]`:
  - `matches` містить елемент з `path.type === 'Exact'`;
  - `filters` містить елемент з `type === 'RequestRedirect'`, `requestRedirect.scheme === 'https'`, `requestRedirect.path.type === 'ReplaceFullPath'` і `statusCode` `301` (як число або рядок);
- у `rules[1]`:
  - `matches` містить елемент з `path.type === 'PathPrefix'`;
  - `backendRefs` містить елемент з `port` `8080` (як число або рядок).

Підсумок: `hasExact && hasRedirect && hasPrefix && has8080`.

**Side effects:** немає. Зараз не викликається з `check()` (зарезервована для тестів і майбутніх перевірок).

---

### `iniKeysMissingInTemplate(keys, template)`

**Сигнатура:** `(keys: string[], template: string) => string | null`

**Параметри:**

- `keys` — масив імен змінних (зазвичай результат `parseIniVariableNames`);
- `template` — повний текст `default.conf.template`.

**Повертає:** повідомлення про першу змінну, для якої в шаблоні немає підрядка `$KEY`; або `null`, якщо всі ключі присутні.

**Поведінка:** простий послідовний перебір `keys` з перевіркою `template.includes('$' + key)`. Це контракт `envsubst`: якщо ключ є у values-ini, він має бути використаний у шаблоні (або вилучений з ini).

**Side effects:** немає.

---

### `dockerfileHasGzipStaticPipeline(dockerfileContent)` (внутрішня)

**Сигнатура:** `(dockerfileContent: string) => boolean`

**Параметри:**

- `dockerfileContent` — повний текст одного Dockerfile/Containerfile.

**Повертає:** `true`, якщо в тексті одночасно присутні: `find` (через `FIND_CMD_RE`), підрядок `/usr/share/nginx/html`, `gzip` (через `GZIP_CMD_RE`), прапор `-k` і регекс розширень `*.(js|css)` (через `GZIP_EXTENSION_RE`).

**Side effects:** немає.

---

### `dockerfileHasEnvsSubstTemplate(dockerfileContent)` (внутрішня)

**Сигнатура:** `(dockerfileContent: string) => boolean`

**Параметри:**

- `dockerfileContent` — повний текст Dockerfile/Containerfile.

**Повертає:** `true`, якщо текст містить одночасно `envsubst` і `default.conf.template`.

**Side effects:** немає.

---

### `checkTemplateFile(abs, root, passFn, failFn)` (внутрішня, async)

**Сигнатура:** `async (abs: string, root: string, passFn: (msg: string) => void, failFn: (msg: string) => void) => Promise<void>`

**Параметри:**

- `abs` — абсолютний шлях до `default.conf.template`;
- `root` — корінь репозиторію (для відносних повідомлень);
- `passFn`, `failFn` — колбеки `createCheckReporter`.

**Поведінка:**

1. читає шаблон, викликає `nginxTemplateViolations`, рапортує `pass` або `fail` зі стислим описом порушення;
2. читає сусідній каталог (`readdir(dirname(abs))`); якщо `readdir` падає (наприклад, нет прав), список INI-файлів вважається порожнім (`try/catch`);
3. з усіх записів обирає тільки ті, що закінчуються на `.ini`;
4. якщо INI немає — викликає `failFn` з підказкою додати `values-*.ini` і повертається;
5. інакше — рапортує `pass` про знайдені ini (з кількістю), і для кожного:
   - читає текст (`readFile utf8`); якщо `readFile` падає — рапортує `fail` з повідомленням помилки (`Error.message` або `String(error)` для не-`Error`);
   - інакше парсить імена через `parseIniVariableNames`, передає у `iniKeysMissingInTemplate(keys, content)`; якщо є невикористаний ключ — `fail` з відносним шляхом ini.

**Side effects:** читання файлів і каталогів, виклик колбеків репортера.

---

### `checkDockerfiles(root, ignorePaths, passFn, failFn)` (внутрішня, async)

**Сигнатура:** `async (root: string, ignorePaths: string[], passFn, failFn) => Promise<void>`

**Поведінка:**

1. шукає Dockerfile'и через `findDockerfilePaths(root, ignorePaths)` (імпорт з `../../docker/js/lint.mjs`);
2. якщо їх немає — `fail` з підказкою (бо `default.conf.template` уже знайдено);
3. читає вміст усіх Dockerfile'ів `Promise.all`;
4. якщо **хоч один** має gzip-pipeline (`dockerfileHasGzipStaticPipeline`) — `pass`, інакше `fail`;
5. якщо **хоч один** має envsubst+template (`dockerfileHasEnvsSubstTemplate`) — `pass`, інакше `fail`.

**Side effects:** читання Dockerfile'ів, виклик колбеків.

---

### `checkVscodeNginx(passFn, failFn, cwd)` (внутрішня, sync)

**Сигнатура:** `(passFn, failFn, cwd: string) => void`

**Поведінка:** має дві однотипні гілки для `.vscode/extensions.json` і `.vscode/settings.json`:

- якщо файл існує — викликає `runConftestBatch` із відповідним `policyDirRel` (`nginx-default-tpl/vscode_extensions` або `…/vscode_settings`) і `namespace` (`nginx_default_tpl.vscode_extensions` / `…vscode_settings`), передає масив з одного файлу. Якщо `violations` порожній — `pass`; інакше для кожного `v` — `failFn(v.message)`;
- якщо файлу немає — `failFn` з підказкою з `nginx-default-tpl.mdc`.

Для `settings.json` при відсутності файлу функція робить ранній `return`, не виконуючи `runConftestBatch` другий раз.

**Side effects:** виконання `conftest` як зовнішнього процесу (через `runConftestBatch`), виклик колбеків.

---

### `check(cwd = process.cwd())`

**Сигнатура:** `async (cwd?: string) => Promise<number>`

**Параметри:**

- `cwd` — корінь репозиторію; за замовчанням `process.cwd()`.

**Повертає:** код виходу від `reporter.getExitCode()`: `0`, якщо `failFn` жодного разу не викликався (тільки `pass`); `1` — якщо була хоч одна помилка.

**Поведінка (потік виконання):**

1. створює репортер `createCheckReporter()` і деструктурує `{ pass, fail }`;
2. читає список ігнорованих шляхів через `loadCursorIgnorePaths(root)`;
3. виконує міграцію `default.tpl.conf` → `default.conf.template` (`migrateDefaultTplConfFiles`) і репортує `pass` за кожним перейменованим/перезаписаним файлом;
4. виконує заміну `error_log off;` (`migrateErrorLogOffDirective`) і репортує `pass` за кожним виправленим шаблоном;
5. шукає `default.conf.template` (`findDefaultConfTemplatePaths`); якщо їх нуль — `pass` про пропуск і ранній `return reporter.getExitCode()`;
6. репортує `pass` з кількістю знайдених шаблонів;
7. послідовно (через `for…of` з `await`) перевіряє кожен шаблон через `checkTemplateFile`;
8. перевіряє Dockerfile'и через `checkDockerfiles`;
9. перевіряє VSCode-конфіги через `checkVscodeNginx` (синхронно);
10. повертає `reporter.getExitCode()`.

**Side effects:** виклик усіх міграцій (мутація ФС), читання файлів і каталогів, виконання `conftest` через `runConftestBatch`, запис у репортер.

## Залежності

### Стандартна бібліотека Node.js

- `node:fs` — `existsSync` (синхронна перевірка існування файлу для міграції й VSCode-конфігів);
- `node:fs/promises` — `readdir`, `readFile`, `rename`, `unlink`, `writeFile`;
- `node:path` — `basename`, `dirname`, `join`, `relative`.

### Внутрішні модулі правил

- `../../docker/js/lint.mjs` — `findDockerfilePaths(root, ignorePaths)` — пошук Dockerfile'ів у дереві (повторне використання логіки правила `n-docker`);
- `../../../scripts/lib/check-reporter.mjs` — `createCheckReporter()` — стандартний репортер pass/fail з агрегованим exit-кодом;
- `../../../scripts/lib/load-cursor-config.mjs` — `loadCursorIgnorePaths(root)` — список абсолютних ігнорованих шляхів з `.cursor` конфігу;
- `../../../scripts/lib/run-conftest-batch.mjs` — `runConftestBatch({ policyDirRel, namespace, files })` — синхронний запуск `conftest` для пакетної перевірки rego;
- `../../../scripts/utils/walkDir.mjs` — `walkDir(root, visitor, ignorePaths)` — асинхронний обхід дерева.

### Регулярні вирази та константи модуля

- `LINE_SPLIT_RE = /\r?\n/u` — універсальний роздільник рядків для INI;
- `INI_KEY_RE = /^([A-Za-z_]\w*)\s*=/u` — розпізнавання ключа `KEY=` в INI;
- `RETURN_200_RE = /return\s+200/u` — індикатор успішного `/healthz`;
- `GZIP_STATIC_ON_RE = /gzip_static\s+on/gu` — підрахунок входжень для перевірки «щонайменше 2»;
- `PROXY_LIKE_RE = /\b(proxy_pass|proxy_redirect|proxy_set_header|proxy_http_version|fastcgi_pass|grpc_pass|uwsgi_pass)\b/u` — заборонені директиви бекенду;
- `FIND_CMD_RE = /\bfind\b/u`, `GZIP_CMD_RE = /\bgzip\b/u` — детектори команд у Dockerfile;
- `GZIP_EXTENSION_RE = /\*\.(?:js|css)/u` — детектор маски розширень gzip-кроку;
- `ERROR_LOG_OFF_RE = /error_log\s+off\s*;/gu` — глобальний регекс для заміни;
- `ERROR_LOG_CANONICAL = 'error_log /dev/null crit;'` — канонічна заміна.

## Потік виконання / Використання

Модуль використовується як одна з перевірок репозитарного лінтера `n-cursor`/правил `.mdc`. Типовий виклик з контекстного скрипту правила:

```mjs
import { check } from './template.mjs'

const exitCode = await check(process.cwd())
process.exit(exitCode)
```

Послідовність дій `check(cwd)`:

1. **Підготовка:** створення репортера, завантаження ігнор-списку.
2. **Міграції (мутативна фаза, до перевірок):**
   - застаріле `default.tpl.conf` → `default.conf.template` (rename або overwrite + unlink);
   - невалідне `error_log off;` → `error_log /dev/null crit;`.
3. **Збір шаблонів:** `findDefaultConfTemplatePaths` (виключає сегменти `fixtures/`).
4. **Швидкий вихід:** якщо шаблонів нуль — функція повертає `0` як «нічого перевіряти».
5. **Перевірка кожного шаблону:**
   - валідація директив через `nginxTemplateViolations` (на перше порушення);
   - пошук сусідніх `*.ini`, парс ключів, перевірка `$KEY` у шаблоні через `iniKeysMissingInTemplate`.
6. **Перевірка Dockerfile'ів:** наявність gzip-кроку для статики й кроку `envsubst` з шаблоном.
7. **Перевірка VSCode-конфігів:** делегування у rego через `runConftestBatch`.
8. **Підсумок:** `reporter.getExitCode()` — `0` або `1`.

### Контракт з користувачами модуля

- Усі публічні функції є чистими або «атомарними» (одна відповідальність), що дозволяє точково використовувати їх у тестах (наприклад, `parseIniVariableNames`, `nginxTemplateViolations`, `iniKeysMissingInTemplate`, `httpRouteMatchesNginxDefaultTpl`).
- Шляхи в звітах нормалізовані до `/`-роздільника й відносні до `root`.
- Сортування результатів (`findDefaultConfTemplatePaths`, `migrateDefaultTplConfFiles` через `oldPaths.sort`) гарантує детермінований порядок виводу повідомлень — це важливо для стабільності тестів.
- Фази «міграції» виконуються **до** валідації, тому застарілі артефакти не призводять до false-negative; натомість користувач бачить `pass` про факт міграції.
- Шлях VSCode-перевірки залежить від `existsSync` у момент виклику, тобто новостворені файли (у тій самій сесії процесу) будуть враховані.

### Особливості й нюанси

- `nginxTemplateViolations` повертає **перше** порушення, а не повний список — це свідома стратегія fail-fast (мінімізація шуму в репортері).
- `httpRouteMatchesNginxDefaultTpl` приймає тип `unknown`, бо очікує безпосередньо результат YAML-парсера; усі гарди — позитивні (object && !Array && !null && !undefined).
- `parseIniVariableNames` **не** дедуплікує ключі: дубль у ini призведе до повторного перебору в `iniKeysMissingInTemplate`, проте через `template.includes` обидва результати будуть однакові — це не впливає на коректність.
- `checkTemplateFile` обережно обробляє помилки `readdir` (поглинає винятки, продовжує без INI), але помилки `readFile` для ini рапортує як `fail` із текстом помилки.
- `migrateErrorLogOffDirective` не запускає файлову операцію, якщо вміст не змінився — оптимізація для ідемпотентних запусків.
