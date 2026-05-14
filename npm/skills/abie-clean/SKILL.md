---
name: n-abie-clean
description: >-
  Очистка проєкту від ru-середовища: гілка `ru`, директорії `ru/`, файли з суфіксом
  `-ru`/`values-ru.*`, гілки `endsWith(...'ru')` у GitHub Actions, ru-умови у
  Dockerfile/nginx, посилання на `cr.yandex` та раннер `ya`
version: '1.1'
---

Скіл прибирає з проєкту все, що належить **ru-середовищу**. Залишаються тільки `dev` (як база) та `ua` як активне продакшн-середовище. Працюй послідовно по секціях нижче — після кожної секції перевіряй, що проєкт лишається консистентним (`kustomization.yaml` посилається лише на наявні файли, GitHub Actions-вирази синтаксично коректні).

## 1. Директорії з назвою `ru`

Видали всі директорії з назвою `ru` у проєкті:

```bash
find . -type d -name "ru" -exec rm -rf {} +
```

Це чистить як `country/ru/`, так і `k8s/<...>/ru/` (overlay у kustomize). Після видалення overlay `ru/` обов’язково прибери відповідний запис у `resources:` у батьківському `kustomization.yaml`, якщо він там лишився.

## 2. Файли з ru-суфіксом

Видали файли, у назві яких є явний ru-маркер:

- `values-ru.ini`, `values-ru.yaml`, `values-ru.*` (Helm/абстракції values на середовище)
- будь-які файли, що закінчуються на `-ru` або `-ru.<ext>`, наприклад `site/.env.prod-ru`, `*.env.prod-ru`, `*.prod-ru.conf`

```bash
find . -type f \( -name "values-ru.*" -o -name "*-ru" -o -name "*.prod-ru" -o -name "*.prod-ru.*" \) -delete
```

## 3. `.github/workflows/*.yml`

### 3.1. Тригери `on.push.branches`

Прибирай `ru` зі списку гілок.

Було:

```yaml
on:
  push:
    branches: [dev, ru, ua]
```

Стало:

```yaml
on:
  push:
    branches: [dev, ua]
```

### 3.2. Тернарні вирази `endsWith(github.ref_name, …)`

У ланцюжках `endsWith(...)` залишай тільки гілки `dev` та `ua`. Гілку `ru` (а також пов’язаний з нею fallback на раннер `ya`, реєстр `cr.yandex/...`, NATS `cluster.local` тощо) — прибирай. Останнє значення в ланцюжку стає fallback’ом для всього, що не `dev`.

`runs-on` — було:

```yaml
runs-on: ${{ endsWith(github.ref_name, 'dev') && 'dev' || ( endsWith(github.ref_name, 'ua') && 'ua' || 'ya' ) }}
```

Стало:

```yaml
runs-on: ${{ endsWith(github.ref_name, 'dev') && 'dev' || 'ua' }}
```

`NATS_URL` — було:

```yaml
NATS_URL: ${{ endsWith(github.ref_name, 'dev') && 'nats.nats.svc.abie-dev.internal:4222' || ( endsWith(github.ref_name, 'ua') && 'nats.nats.svc.abie-ua.internal:4222' || 'nats.nats.svc.cluster.local:4222' ) }}
```

Стало:

```yaml
NATS_URL: ${{ endsWith(github.ref_name, 'dev') && 'nats.nats.svc.abie-dev.internal:4222' || 'nats.nats.svc.abie-ua.internal:4222' }}
```

`NATS_STREAM` — було:

```yaml
NATS_STREAM: ${{ endsWith(github.ref_name, 'dev') && 'dev' || ( endsWith(github.ref_name, 'ua') && 'ua' || 'ru' ) }}
```

Стало:

```yaml
NATS_STREAM: ${{ endsWith(github.ref_name, 'dev') && 'dev' || 'ua' }}
```

`REGISTRY` — було:

```yaml
REGISTRY: ${{ endsWith(github.ref_name, 'ru') && 'cr.yandex/crpaerfcq9t16fse5onm' || ( endsWith(github.ref_name, 'ua') && 'europe-west4-docker.pkg.dev/abie-ua/c' || 'europe-north1-docker.pkg.dev/abie-dev/c' ) }}
```

Стало:

```yaml
REGISTRY: ${{ endsWith(github.ref_name, 'ua') && 'europe-west4-docker.pkg.dev/abie-ua/c' || 'europe-north1-docker.pkg.dev/abie-dev/c' }}
```

Загальне правило: у фінальному виразі мають лишитися лише `endsWith(github.ref_name, 'dev')` та `endsWith(github.ref_name, 'ua')` (або лише один із них, якщо середовище одне). Будь-яка згадка `'ru'`, `'ya'`, `cr.yandex`, `cluster.local`-fallback для ru — прибирається.

### 3.3. `ignore_branches` / `branches-ignore`

У всіх workflow-файлах та конфігах (включно з тими, що використовуються правилом **abie** `clean_merged_ignore_branches`) прибирай `ru` зі списків ignore-гілок.

## 4. Dockerfile / nginx / build-скрипти

Прибирай умовні гілки `if [ "$BRANCH" = "ru" ]; then …` та копіювання `country/ru/*`. Лишається лише той код, що працює для `dev`/`ua`.

Було:

```dockerfile
RUN if [ "$BRANCH" = "ru" ]; then cp -r country/ru/* public/ || true; fi && \
    bun install && \
    if [ "$BRANCH" = "ru" ]; then BASE="/itool/"; else BASE="/contract/"; fi && \
    bun vite build --mode "prod-$BRANCH" --base="$BASE"
```

Стало:

```dockerfile
RUN bun install && bun vite build --mode "prod-$BRANCH" --base="$BASE"
```

Те саме стосується `nginx`-конфігів (`server_name`, `proxy_pass` з ru-доменами), `*.sh`-скриптів та `package.json` scripts (`build:ru`, `deploy:ru`, `prod-ru` тощо).

## 5. Після очистки

- Переконайся, що `kustomization.yaml` у кожній директорії `k8s/` не посилається на видалені overlay або файли.
- Пройдись `git grep` по репозиторію на залишки: `git grep -n -i -e '\bru\b' -e cr\.yandex -e country/ru -e prod-ru -e values-ru -e "'ya'"` — переглянь усі знахідки вручну, бо `ru` як слово може траплятися в легітимних контекстах (наприклад, `truncate`, `Aurum`, `cruft`). Видаляй лише ті входження, що належать ru-середовищу.
- Перевір CI локально: `npx @nitra/cursor check abie` (якщо правило **abie** ввімкнене у проєкті).
