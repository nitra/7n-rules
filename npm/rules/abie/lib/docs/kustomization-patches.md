# kustomization-patches.mjs

## Огляд

Модуль `kustomization-patches.mjs` належить пакету правил `abie` і обслуговує перевірку inline JSON6902-патчів у файлах `kustomization.yaml` для overlay-режиму `ua` (і його похідних на кшталт `ua-b2b`). Він читає сирий текст файла `kustomization.yaml`, парсить YAML-документи через `yaml.parseAllDocuments`, відбирає елементи з полем `patches[]` і перевіряє два класи модифікацій ресурсів Kubernetes:

1. **`Deployment` nodeSelector patch** — підтверджує, що для overlay `ua` присутній JSON6902-патч на `Deployment`, який встановлює селектор вузла з міткою `preem: false` (не виштовхуваний пул).
2. **`HTTPRoute` patch** — перевіряє, що JSON6902-патч для ресурсу `HTTPRoute` встановлює коректний список `hostnames` (із доменами abie), namespace для `parentRefs/0` і, за потреби, namespace для `backendRefs` спільних cross-namespace сервісів (`auth-run-hl`, `file-link-hl`).

Парсер не виконує повторного розбору вкладеного JSON6902-документа: тіло `patch:` — це YAML-string, і модуль шукає в ньому характерні підрядки (`path: …`, `value: …`) за допомогою регулярних виразів. Це навмисне рішення задокументовано в JSDoc-заголовку файла.

Модуль використовується як набір предикатних і валідаційних утиліт правилами abie (наприклад `abie.mdc`) під час лінт-перевірок репозиторіїв з Kubernetes-маніфестами.

## Експорти / API

Модуль експортує три публічні функції:

| Експорт | Тип | Призначення |
|---------|-----|------------|
| `kustomizationHasAbieDeploymentNodeSelectorPatch(raw, mode)` | function → `boolean` | Чи у `kustomization.yaml` є валідний inline-патч на `Deployment` з ua nodeSelector. |
| `getCombinedNginxRunPatchTextFromKustomization(raw)` | function → `string` | Збирає всі inline patch-тіла для `HTTPRoute` у єдиний текст. |
| `validateAbieNginxRunHttpRoutePatches(combined, mode, _fullKustomizationRaw, sharedCrossNsBackendRefCount?)` | function → `string \| null` | Валідує сукупний текст HTTPRoute-патчів; повертає повідомлення про помилку або `null` при успіху. |

Усі інші ідентифікатори файла (`PATCH_*_RE`, `ABIE_UA_HTTPROUTE_HOST_MARKERS`, допоміжні функції) — приватні (module-scope) і доступні лише всередині модуля.

## Функції

### Приватні константи-регекси

- `PATCH_NODE_SELECTOR_PATH_RE = /path:\s*\/spec\/template\/spec\/nodeSelector\b/u` — шукає JSON-pointer `path` патча nodeSelector.
- `PATCH_PREEM_FALSE_RE = /\bpreem:\s*['"]?false['"]?\b/u` — шукає значення мітки `preem: false` (з лапками або без).
- `PATCH_HOSTNAMES_PATH_RE = /path:\s*\/spec\/hostnames\b/mu` — шукає JSON-pointer `path` HTTPRoute hostnames.
- `PATCH_PARENT_REF_NS_UA_RE` — шукає пару `path: /spec/parentRefs/0/namespace` + `value: ua` (або `ua-<suffix>`, наприклад `ua-b2b`), допускаючи між ними до 200 символів довільного тексту/відступів. Прапори: `imu` (case-insensitive, multiline, unicode).
- `ABIE_UA_HTTPROUTE_HOST_MARKERS = ['abie.app', 'vybeerai.com.ua', '*.abie.app', '*.vybeerai.com.ua']` — список доменів, хоча б один з яких має фігурувати у `value:` для `/spec/hostnames` патча.

### `jsonPatchTextHasUaDeploymentNodeSelector(patchText)` (приватна)

- **Сигнатура:** `(patchText: string) => boolean`
- **Параметри:**
  - `patchText` — сирий текст YAML-stringу `patch:` (вкладене JSON6902-тіло).
- **Повертає:** `true`, якщо `patchText` — непорожній рядок, у якому одночасно знайдено `PATCH_NODE_SELECTOR_PATH_RE` та `PATCH_PREEM_FALSE_RE`; інакше `false`.
- **Side effects:** немає.

### `inlineKustomizationPatchMatchesAbieMode(p, mode)` (приватна)

- **Сигнатура:** `(p: unknown, mode: 'ua') => boolean`
- **Параметри:**
  - `p` — довільний елемент масиву `patches[]` з Kustomization-документа.
  - `mode` — лише `'ua'` у поточній імплементації.
- **Повертає:** `true`, якщо `p` — об’єкт (не масив, не `null`), його `target.kind === 'Deployment'`, поле `patch` — рядок, і для `mode === 'ua'` `jsonPatchTextHasUaDeploymentNodeSelector(p.patch)` повертає `true`.
- **Side effects:** немає. Усе суто read-only над JSON-структурою.

### `kustomizationDocumentHasAbieDeploymentNodeSelectorPatch(doc, mode)` (приватна)

- **Сигнатура:** `(doc: import('yaml').Document, mode: 'ua') => boolean`
- **Параметри:**
  - `doc` — один YAML-документ (`Document` з пакета `yaml`).
  - `mode` — режим overlay (на даний час лише `'ua'`).
- **Повертає:** `true`, якщо:
  - `doc.errors.length === 0` (документ без помилок парсингу),
  - корінь — об’єкт (не масив/не `null`) з `kind === 'Kustomization'`,
  - `patches` — масив, і хоча б один елемент відповідає `inlineKustomizationPatchMatchesAbieMode(p, mode)`.
- **Side effects:** немає. Викликає `doc.toJSON()` (чиста конвертація AST → POJO).

### `kustomizationHasAbieDeploymentNodeSelectorPatch(raw, mode)` (експорт)

- **Сигнатура:** `(raw: string, mode: 'ua') => boolean`
- **Параметри:**
  - `raw` — повний текст файла `kustomization.yaml`, як прочитано з диска (включно з можливим BOM/modeline у першому рядку).
  - `mode` — overlay-режим (`'ua'`).
- **Повертає:** `true`, якщо хоча б один YAML-документ у файлі містить inline patch на `Deployment` з ua nodeSelector (delegate у `kustomizationDocumentHasAbieDeploymentNodeSelectorPatch`).
- **Обробка тексту:**
  1. Знімає BOM через `stripBom(raw)`.
  2. Розщеплює на рядки через `LINE_SPLIT_RE`.
  3. Якщо перший рядок збігається з `MODELINE_RE` (наприклад editor modeline `# vim: ...`), відрізає його, інакше використовує тіло як є.
  4. Парсить решту через `parseAllDocuments(rest)`.
- **Поведінка при помилках:** будь-який виняток у `parseAllDocuments` ловиться і повертається `false`.
- **Side effects:** немає (повністю детермінована функція над рядком).

### `extractHttpRoutePatchString(p)` (приватна)

- **Сигнатура:** `(p: unknown) => string | null`
- **Параметри:**
  - `p` — елемент масиву `patches[]`.
- **Повертає:** значення `p.patch` як непорожній рядок, якщо `p` — об’єкт, `p.target.kind === 'HTTPRoute'`, `p.target.name` — непорожній рядок, і `p.patch` — непорожній рядок; інакше `null`.
- **Side effects:** немає.

### `collectAbieHttpRoutePatchStringsFromKustomizationDoc(doc)` (приватна)

- **Сигнатура:** `(doc: import('yaml').Document) => string[]`
- **Параметри:**
  - `doc` — один YAML-документ.
- **Повертає:** масив `patch`-рядків (як string), знятих з усіх валідних HTTPRoute-патчів документа. Якщо документ із помилками, не Kustomization або `patches` не масив — повертається `[]`.
- **Side effects:** немає.

### `getCombinedNginxRunPatchTextFromKustomization(raw)` (експорт)

- **Сигнатура:** `(raw: string) => string`
- **Параметри:**
  - `raw` — повний текст `kustomization.yaml`.
- **Повертає:** усі знайдені HTTPRoute-патчі склеєні через `'\n'` в один великий рядок. Якщо ніщо не знайдено або не вдалося розпарсити — повертає `''`.
- **Обробка тексту:** ті ж 4 кроки, що в `kustomizationHasAbieDeploymentNodeSelectorPatch` (stripBom → LINE_SPLIT_RE → MODELINE_RE → `parseAllDocuments`).
- **Поведінка при помилках:** будь-який виняток у `parseAllDocuments` ловиться і повертається `''`.
- **Side effects:** немає.

### `countAbieHttpRouteBackendRefNamespacePatchesInCombined(combined, mode)` (приватна)

- **Сигнатура:** `(combined: string, mode: 'ua') => number`
- **Параметри:**
  - `combined` — сукупний текст HTTPRoute-патчів (зазвичай з `getCombinedNginxRunPatchTextFromKustomization`).
  - `mode` — режим; якщо не `'ua'`, одразу повертається `0`.
- **Повертає:** кількість збігів регексу
  `path: /spec/rules/<num>/backendRefs/<num>/namespace … value: 'ua' (або ua-<suffix>)`
  у `combined`. Прапори: `gimu`.
- **Side effects:** немає.

### `validateAbieNginxRunHttpRoutePatches(combined, mode, _fullKustomizationRaw, sharedCrossNsBackendRefCount=0)` (експорт)

- **Сигнатура:**
  `(combined: string, mode: 'ua', _fullKustomizationRaw?: string, sharedCrossNsBackendRefCount?: number) => string | null`
- **Параметри:**
  - `combined` — сукупний текст HTTPRoute-патчів. Очікується результат `getCombinedNginxRunPatchTextFromKustomization`.
  - `mode` — overlay-режим (`'ua'`); вживається у формуванні текстових повідомлень і у виклику `countAbieHttpRouteBackendRefNamespacePatchesInCombined`.
  - `_fullKustomizationRaw` — **не використовується**. Залишений у сигнатурі лише для зворотної API-сумісності з попередніми викликами.
  - `sharedCrossNsBackendRefCount` — очікувана кількість cross-namespace backendRefs (наприклад до `auth-run-hl`, `file-link-hl`) у base HTTPRoute. Якщо число некоректне (NaN, від’ємне, не-число), нормалізується до `0` через `Math.max(0, Math.floor(n))`.
- **Повертає:** `null` при успішній валідації або текст повідомлення про помилку (українською, з посиланням на `abie.mdc`).
- **Послідовність перевірок:**
  1. `combined` не є непорожнім рядком → повертає `очікується patch target kind HTTPRoute з непорожнім target.name …`.
  2. У `combined` немає `path: /spec/hostnames` → `HTTPRoute: потрібен path /spec/hostnames у patch (abie.mdc)`.
  3. У `combined` немає жодного з маркерів `ABIE_UA_HTTPROUTE_HOST_MARKERS` → `HTTPRoute: у value для /spec/hostnames має бути один із доменів abie (…)`.
  4. У `combined` немає `path: /spec/parentRefs/0/namespace` з value `ua[-suffix]` → `HTTPRoute: потрібен path /spec/parentRefs/0/namespace з value ua …`.
  5. Якщо `sharedCount > 0` і `countAbieHttpRouteBackendRefNamespacePatchesInCombined(combined, mode) < sharedCount` → `HTTPRoute: для backendRefs до спільних сервісів auth-run-hl, file-link-hl очікується N JSON6902 patch(ів) … (зараз M)`.
- **Side effects:** немає. Чиста функція, повертає string або null.

## Залежності

### Зовнішні пакети

- **`yaml`** — npm-пакет; використовується `parseAllDocuments` для розбору багатодокументного YAML-файла й типи `Document` (через JSDoc-теги `import('yaml').Document`).

### Внутрішні модулі

- **`./yaml.mjs`** — у файлі імпортовані:
  - `LINE_SPLIT_RE` — регекс для split тексту на рядки (підтримує `\r\n`/`\n`).
  - `MODELINE_RE` — регекс, який матчить editor modeline в першому рядку (щоб його відрізати перед парсингом).
  - `stripBom(raw)` — функція зняття BOM-префікса з тексту.

### Інше

Модуль не виконує IO (не читає файли, не звертається до мережі). Він приймає `raw`-текст і повертає булеві/рядкові результати. Сценарій IO виносять виклики на рівні правила (`abie.mdc`/`check-abie.mjs`).

## Потік виконання / Використання

### Типовий сценарій (Deployment nodeSelector)

1. Викликач читає файл `kustomization.yaml` оверлейного namespace (наприклад `overlays/ua/kustomization.yaml`).
2. Передає текст і `'ua'` у `kustomizationHasAbieDeploymentNodeSelectorPatch(raw, 'ua')`.
3. Якщо результат `false` — правило фіксує порушення: для overlay `ua` має бути inline patch на `Deployment` з `preem: false` nodeSelector.

### Типовий сценарій (HTTPRoute)

1. Викликач читає той самий файл `kustomization.yaml`.
2. Отримує `combined = getCombinedNginxRunPatchTextFromKustomization(raw)` — конкатенацію тіл усіх HTTPRoute-патчів.
3. Окремо рахує (у викликаючому коді), скільки в base HTTPRoute визначено backendRefs до cross-namespace спільних сервісів `auth-run-hl`/`file-link-hl` — отримує `sharedCount` (число).
4. Передає `validateAbieNginxRunHttpRoutePatches(combined, 'ua', undefined, sharedCount)`.
5. Якщо повертається не-`null` — використовує отриманий текст як повідомлення про порушення `abie.mdc`. Якщо `null` — патчі валідні.

### Послідовність обробки `raw`

Обидві експортовані функції `kustomization*` і `getCombined*` мають однаковий початок:

```
raw
  → stripBom(raw)            // зняти UTF-8 BOM, якщо є
  → split(LINE_SPLIT_RE)     // на рядки
  → перевірка MODELINE_RE на першому рядку
     → якщо modeline: відкинути перший рядок, склеїти решту через '\n'
     → інакше: працювати з тілом як є
  → parseAllDocuments(...)   // у try/catch
```

Якщо `parseAllDocuments` кидає — функції повертають безпечне значення: `false` (предикат) або `''` (збирач).

### Інваріанти й обмеження

- **Mode lock:** усі публічні предикати приймають лише `mode: 'ua'`. Розширення на інші overlays потребує модифікації регексів і їх перевикористання.
- **Overlay `ua-<suffix>`:** дозволяється у регексах `PATCH_PARENT_REF_NS_UA_RE` і `countAbieHttpRouteBackendRefNamespacePatchesInCombined` через альтернацію `ua(?:-[a-z0-9][a-z0-9-]*)?`.
- **Без подвійного парсингу:** тіло `patch:` лишається сирим YAML-stringом, регекси шукають літеральні маркери `path:`/`value:`. Тому модуль чутливий до того, що між `path:` і `value:` має бути не більше 200 символів (обмеження back-tracking).
- **Тіло має бути string:** елементи `patches[]` зі структурованим (об’єктним) `patch` ігноруються. Очікується `patch: |` блок у YAML.
- **`_fullKustomizationRaw`:** залишений у сигнатурі `validateAbieNginxRunHttpRoutePatches`, але не використовується — підкреслений префікс ім’я є умовою лінт-сумісності з правилом «невикористаний параметр».

### Приклад інтеграції

```js
import { readFileSync } from 'node:fs'
import {
  kustomizationHasAbieDeploymentNodeSelectorPatch,
  getCombinedNginxRunPatchTextFromKustomization,
  validateAbieNginxRunHttpRoutePatches,
} from './kustomization-patches.mjs'

const raw = readFileSync('overlays/ua/kustomization.yaml', 'utf8')

if (!kustomizationHasAbieDeploymentNodeSelectorPatch(raw, 'ua')) {
  // правило-порушник: відсутній nodeSelector patch для Deployment
}

const combined = getCombinedNginxRunPatchTextFromKustomization(raw)
const msg = validateAbieNginxRunHttpRoutePatches(combined, 'ua', undefined, 2)
if (msg !== null) {
  // msg містить human-readable причину з посиланням на abie.mdc
}
```
