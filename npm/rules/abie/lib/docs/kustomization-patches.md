# kustomization-patches.mjs

## Огляд

Модуль розпізнає inline JSON6902-патчі всередині `kustomization.yaml` для abie ua-overlay і перевіряє, що вони відповідають вимогам правила `abie.mdc`. Обслуговує два сценарії: патч `nodeSelector` на `Deployment` (закріплення подів на не-preemptible вузлах) і патчі `HTTPRoute` (домени, namespace для `parentRefs` і `backendRefs`). Тіло `patch:` у YAML — це рядок із вкладеним JSON6902, тому розпізнавання спирається на пошук характерних підрядків (`path: …`, `value: …`), а не на повторний парсинг.

## Поведінка

Спільний препроцесинг тексту `kustomization.yaml`: знімається BOM; якщо перший рядок — editor-modeline, його відкидають; решта розбирається як набір YAML-документів (можливо кілька через `---`). Будь-яка помилка розбору перехоплюється і дає безпечний результат (`false` або порожній рядок).

### Перевірка nodeSelector-патча для Deployment

1. Серед документів шукають той, де `kind: Kustomization` і є масив `patches`.
2. Підходить елемент `patches`, у якого `target.kind` дорівнює `Deployment`, а текст патча містить одночасно шлях `/spec/template/spec/nodeSelector` і ключ `preem: false` (з лапками або без).
3. Якщо хоча б один такий патч знайдено — результат позитивний.

### Збір і валідація HTTPRoute-патчів

1. З усіх документів `Kustomization` збираються тексти патчів, у яких `target.kind` дорівнює `HTTPRoute` і `target.name` непорожній; зібрані фрагменти склеюються в один текст.
2. Об'єднаний текст перевіряється послідовно. Кожна невдала умова повертає конкретне україномовне повідомлення з посиланням на `abie.mdc`; повний успіх — `null`:
   - текст не може бути порожнім;
   - має бути шлях `/spec/hostnames`;
   - серед значень `hostnames` має бути хоча б один з доменів abie: `abie.app`, `vybeerai.com.ua`, `*.abie.app`, `*.vybeerai.com.ua`;
   - має бути шлях `/spec/parentRefs/0/namespace` зі значенням `ua` (дозволено й `ua-*`, напр. `ua-b2b`);
   - якщо в base-HTTPRoute є cross-namespace `backendRefs` до спільних сервісів (`auth-run-hl`, `file-link-hl`), то на кожен такий ref має бути окремий патч `path: /spec/rules/.../backendRefs/.../namespace` зі значенням `ua[-…]`; якщо патчів менше очікуваного — помилка з числами «потрібно/є».

Очікувана кількість cross-namespace патчів передається ззовні (з аналізу base-маніфестів). Некоректне чи від'ємне значення нормалізується до невід'ємного цілого; `0` означає, що ця перевірка пропускається.

Приклади namespace, що проходять: `ua`, `ua-b2b`.

## Публічний API

- `kustomizationHasAbieDeploymentNodeSelectorPatch(raw, mode)` — за повним текстом `kustomization.yaml` повертає `true`, якщо в ньому є коректний inline-патч `nodeSelector` (`preem: false`) на `Deployment` для overlay `ua`.
- `getCombinedNginxRunPatchTextFromKustomization(raw)` — повертає об'єднаний текст усіх inline JSON6902-фрагментів HTTPRoute (з непорожнім `target.name`); порожній рядок, якщо таких немає або файл не розбирається.
- `validateAbieNginxRunHttpRoutePatches(combined, mode, _fullKustomizationRaw, sharedCrossNsBackendRefCount)` — перевіряє об'єднаний текст HTTPRoute-патчів на відповідність abie.mdc; повертає `null` при успіху або повідомлення про помилку. Параметр `_fullKustomizationRaw` лишений лише для сумісності сигнатури й не використовується.

## Де використовується

- `npm/rules/abie/js/ua_node_selector.mjs` — перевірка наявності nodeSelector-патча в ua-overlay.
- `npm/rules/abie/js/ua_http_route.mjs` — збирає об'єднаний текст HTTPRoute-патчів і валідує його з урахуванням кількості спільних cross-namespace backendRefs.

## Гарантії поведінки

- Read-only: модуль лише обробляє переданий текст, нічого не змінює, не звертається до файлової системи чи мережі — IO виконують виклики на рівні правила.
- Стійкість до поганого вводу: помилки розбору YAML перехоплюються (предикат → `false`, збирач → `''`); некоректні чи відсутні поля (`patches` не масив, відсутній `target`, нерядкове тіло `patch`) безпечно ігноруються.
- Враховується тільки рядкове тіло `patch:` — елементи зі структурованим (об'єктним) патчем пропускаються.
- Логіка розрахована лише на `mode === 'ua'` (і похідні `ua-*`); для інших значень HTTPRoute-підрахунок повертає `0`.
