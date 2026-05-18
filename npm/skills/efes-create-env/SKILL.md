---
name: n-efes-create-env
description: >-
  Створення нового середовища (env) в репозиторії efes/manager — приймає назву
  середовища як аргумент (наприклад `kz`, `kz-qa`, `tr-stage`, `ua-dev`).
  Генерує .env.prod-<env>, .env.remote-<env>, оверлей site/k8s/<env>/,
  додає скрипт start-remote-<env> у site/package.json і реєструє <env> у
  списках branches GitHub Actions та Azure Pipelines. Якщо назва закінчується
  на dev або -qa — non-production (база: md-qa); інакше — production (база: md).
  Тригери: «створи середовище», «новий env», «add environment», «n-efes-create-env».
---

# n-efes-create-env — створення нового середовища

Скіл генерує всі конфіги для нового середовища `manager`, спираючись на існуюче як шаблон. Запуск: `/n-efes-create-env <env>` або «створи середовище `<env>`».

## Існуючі середовища (станом на створення скіла)

`dev` · `md` · `md-qa` · `tr` · `tr-qa`

## Аргумент

Назва середовища — `$ARGUMENTS` (kebab-case, без пробілів). Якщо аргументу немає — спитай користувача.

## Класифікація та джерело

| Закінчення      | Тип            | Базове середовище | Базовий домен               |
| --------------- | -------------- | ----------------- | --------------------------- |
| `dev` або `-qa` | non-production | `md-qa`           | `mayamd-qa.anadoluefes.com` |
| інше            | production     | `md`              | `mayamd.anadoluefes.com`    |

Перед роботою зафіксуй у себе:

- `ENV` — `$ARGUMENTS`
- `BASE` — `md-qa` або `md` згідно з таблицею вище
- `BASE_DOMAIN` — домен бази
- `DOMAIN` — `maya${ENV}.anadoluefes.com` (шаблон: префікс `maya` + env). Якщо ENV вже містить країну з дефісом (наприклад `kz-qa`) — домен буде `mayakz-qa.anadoluefes.com`. Якщо користувач хоче інший домен — підтверди.
- `COUNTRY` — країна без суфіксу `-qa`/`-dev`/`-stage` (наприклад `kz-qa` → `kz`). Потрібно для ACR-шляхів.

## Кроки

### 0. Перевірити, що середовище ще не існує

```bash
test ! -f site/.env.prod-$ENV \
  && test ! -f site/.env.remote-$ENV \
  && test ! -d site/k8s/$ENV \
  || { echo "Середовище $ENV вже існує — припини"; exit 1; }
```

### 1. Інтерактивне опитування — зібрати country-specific дані

**ОБОВ'ЯЗКОВО** перед будь-якими `cp`/`sed` запитай користувача через `AskUserQuestion` (у Cursor — звичайним повідомленням з варіантами). Не виконуй кроки 2–5, поки не отримав усі відповіді.

Запитай **одним викликом** `AskUserQuestion` із кількома запитаннями:

1. **Тип середовища** — заголовок «Тип env»:
   - «Нова країна» — env вводить нову країну (новий VITE_COUNTRY, своя SAP-tenant, свій бакет)
   - «Новий етап існуючої країни» — env є додатковим етапом md/tr (інший суфікс, але та сама країна та tenant)

2. **Домен** — заголовок «Domain»:
   - `maya${ENV}.anadoluefes.com` (default, рекомендований)
   - «Інший» — користувач введе власний

3. **SAP-credentials** — заголовок «SAP auth»:
   - «Залишити як у бази (`$BASE`)» — для нових етапів існуючої країни
   - «Заглушки `TODO_SAP_*`» — для нової країни, реальні значення додасть devops/security окремим commit
   - «Введу зараз» — користувач передасть значення в `Other` (формат: `ENDPOINT=…; CLIENT_ID=…; CLIENT_SECRET=…`)

4. **Storage account (`VITE_BUCKET`)** — заголовок «Bucket»:
   - «Залишити як у бази» — той самий storage account (`stmdmayasfaprod001`/`stmdmayasfadev001`)
   - «Власний для нової країни» — користувач введе ім'я storage account в `Other` (наприклад `stkzmayasfaprod001`)

Якщо «Нова країна» — окремо (у тому ж або наступному виклику) запитай:

5. **VITE_COUNTRY** — заголовок «Country»: `md`, `tr`, інше (через `Other`)
6. **VITE_TFM_DEFAULT** — заголовок «TFM default»: `ru`, `en`, `tr`, `ro`, інше
7. **VITE_TFM_LIST** — заголовок «TFM list»: набір популярних варіантів (`ru,en,ro,tr`, `en,tr`, `ru,en`) + `Other`

Збережи відповіді у змінні `DOMAIN`, `COUNTRY`, `TFM_DEFAULT`, `TFM_LIST`, `BUCKET_ACCOUNT`, `SAP_MODE` (`keep`/`stub`/`custom`), `SAP_VALUES` (якщо `custom`).

### 2. Створити `.env.prod-$ENV` та `.env.remote-$ENV`

Скопіюй файли бази:

```bash
cp site/.env.prod-$BASE   site/.env.prod-$ENV
cp site/.env.remote-$BASE site/.env.remote-$ENV

# домен
sed -i '' "s|$BASE_DOMAIN|$DOMAIN|g" site/.env.prod-$ENV site/.env.remote-$ENV

# bucket path (maya-files-<base> → maya-files-$ENV)
sed -i '' "s|maya-files-$BASE|maya-files-$ENV|g" site/.env.prod-$ENV site/.env.remote-$ENV
```

Далі **застосуй відповіді з кроку 1** (через `Edit`):

- Якщо `BUCKET_ACCOUNT` != base — заміни storage account host у `VITE_BUCKET`.
- Якщо тип = «Нова країна»:
  - `VITE_COUNTRY=$COUNTRY`
  - `VITE_TFM_DEFAULT=$TFM_DEFAULT`
  - `VITE_TFM_LIST=$TFM_LIST`
- Якщо `SAP_MODE=stub` — заміни значення на:
  - `VITE_SAP_AUTH_ENDPOINT=TODO_SAP_ENDPOINT`
  - `VITE_SAP_AUTH_CLIENT_ID='TODO_SAP_CLIENT_ID'`
  - `VITE_SAP_AUTH_CLIENT_SECRET=TODO_SAP_CLIENT_SECRET`
- Якщо `SAP_MODE=custom` — підстав `SAP_VALUES`.

Інваріанти, які мають лишитися після всіх правок:

- У `.env.remote-$ENV` — `VITE_DOMAIN=localhost`, `VITE_UPLOADER=/file-link/`, `VITE_EXPORT_EXCEL=/export-table/`.
- У `.env.prod-$ENV` — `VITE_DOMAIN=$DOMAIN`, `VITE_UPLOADER=https://$DOMAIN/file-link/`, `VITE_EXPORT_EXCEL=https://$DOMAIN/export-table/`.

### 2. Створити `site/k8s/$ENV/kustomization.yaml`

```bash
mkdir -p site/k8s/$ENV
cp site/k8s/$BASE/kustomization.yaml site/k8s/$ENV/kustomization.yaml
```

Відредагуй новий файл:

- `namespace: $ENV`
- `images[].newName`:
  - **production** → `aefes.azurecr.io/mayasfa-$ENV/$ENV/manager-site`
  - **non-production** → `aefes.azurecr.io/mayasfa-$COUNTRY-dev/$ENV/manager-site`
- `HTTPRoute` патч → `hostnames: ["$DOMAIN"]`
- Для **production** залиш блок `components: [../components]` (HPA/PDB).
- Для **non-production** видали `components` блок і HPA/PDB-патчі (як у `md-qa`).

Перевір: запусти `kubectl kustomize site/k8s/$ENV --output /dev/null` (якщо `kubectl` доступний) — має пройти без помилок.

### 3. Додати `start-remote-$ENV` у `site/package.json`

У секцію `"scripts"` додай рядок (зберігай порядок поряд із сусідніми `start-remote-*`):

```json
{ "scripts": { "start-remote-$ENV": "vite dev --mode remote-$ENV" } }
```

### 4. Зареєструвати `$ENV` у CI/CD branch-списках

Додай `$ENV` у такі місця (зберігай існуючий порядок: dev → md-qa → md → tr → tr-qa → нові):

| Файл                                        | Поле                           |
| ------------------------------------------- | ------------------------------ |
| `.github/workflows/sync-to-azure.yml`       | `on.push.branches`             |
| `.github/workflows/clean-merged-branch.yml` | `ignore_branches` (через кому) |
| `.azurepipelines/apply-k8s.yml`             | `trigger.branches.include`     |
| `.azurepipelines/site.yml`                  | `trigger.branches.include`     |

Якщо існують інші `**/k8s/`-проекти у репозиторії — переконайся, що `$ENV` потрібен і там (на момент створення скіла є тільки `site/k8s/`).

### 5. Попередження користувачу про зовнішні залежності

Скіл **не** створює ці артефакти — повідом про них користувача:

- У repo `MayaSFA/k8s` має існувати шаблон `.azurepipelines/azure-pipeline-templates/$ENV.yml` (його використовує `apply-k8s.yml` і `site.yml`).
- Гілка `$ENV` має бути створена в обох remote (GitHub + Azure DevOps).
- DNS-запис для `$DOMAIN` та health-check у gateway мають бути налаштовані відповідною командою.
- Якщо ENV — нова країна: ACR-репозиторій `mayasfa-$ENV` (для prod) або `mayasfa-$COUNTRY-dev` (для non-prod) має бути створений.

### 6. Перевірка результату

```bash
ls site/.env.prod-$ENV site/.env.remote-$ENV site/k8s/$ENV/kustomization.yaml
grep -n "$ENV" \
  .github/workflows/sync-to-azure.yml \
  .github/workflows/clean-merged-branch.yml \
  .azurepipelines/apply-k8s.yml \
  .azurepipelines/site.yml \
  site/package.json
git status
```

Виведи користувачу короткий звіт: що створено, що змінено, які зовнішні дії потрібні (з кроку 5). **Не комітити автоматично** — користувач сам перегляне через `git diff` і закомітить.

## Нюанси та пастки

- **Доменний шаблон `maya${ENV}.anadoluefes.com`** працює для існуючих країн (md/tr). Якщо нова країна має інший публічний URL — підтверди в користувача _до_ запуску `sed`.
- **ACR-шлях суворо за шаблоном**: prod → `mayasfa-$ENV/$ENV/manager-site`, non-prod → `mayasfa-$COUNTRY-dev/$ENV/manager-site`. Жодних додаткових сегментів між ACR-namespace та `$ENV` бути не повинно.
- **`ENV=dev`**: гілка `dev` — спеціальний випадок (вживає `base/`, без оверлею). Скіл не призначений для перестворення `dev`.
- **`.env.development`** — лише для локального запуску без бекенду; скіл його не чіпає.
- **Не запускай `bun run lint` / `lint-ga`** в один потік з іншими — дивись CLAUDE.md «Лінт і ESLint». Перевір лише потрібний файл (`bunx eslint <path>` або точково).
