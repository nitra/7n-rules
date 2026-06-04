# manifests.mjs — перевірки та автофікси Kubernetes-маніфестів

## Огляд

Модуль `npm/rules/k8s/js/manifests.mjs` — реалізація команди `check k8s` (правило `k8s.mdc`). Він обходить усі `*.yaml` / `*.yml` під сегментом каталогу `k8s` у репозиторії та виконує комплексну перевірку та автокорекцію Kubernetes-маніфестів:

- modeline `# yaml-language-server: $schema=…` (URL за `https://`, без дублікатів, рівно один на файл, у першому рядку);
- URL схеми обирається за `apiVersion`/`kind` маніфесту — kustomization (schemastore), yannh, datree (CRDs-catalog) або «явна таблиця» `EXPLICIT_K8S_SCHEMAS`; виняток — `apiVersion: alb.yc.io/v1alpha1`, `kind: HttpBackendGroup`, де modeline бути не повинно;
- ресурси контейнерів для `kind: Deployment` (`spec.template.spec.containers[].resources.requests.cpu` і `…memory`); жорсткий канон у `…/k8s/…/base/…` — `cpu: '0.02'` / `memory: '128Mi'`, поза base — рекомендовані дефолти `0.5` / `512Mi`;
- структура Kustomize: заборона каталогу `…/k8s/dev/…`; обовʼязковий `namespace:` у `k8s/base/kustomization.yaml`; сортування `resources:` (через rego) та `patches[]`; перевірка JSON6902 inline-патчів (сорт за `path`, заборона `remove`+`add` на один шлях);
- існування локальних посилань у `kustomization.yaml` (`resources` / `bases` / `components` / `crds` / `patches[].path` / `patchesStrategicMerge` / `patchesJson6902[].path` / `configurations` / `replacements[].path`);
- розвʼязання `patches[].target` і `patchesJson6902[].target` у каталозі ресурсів (рекурсивно через вкладені kustomization-и); видалення зайвих `group` / `version` у `target`, коли немає колізії GVK + name;
- пари `svc.yaml` ⇄ `svc-hl.yaml` у каталозі та підключення обох у `kustomization.yaml`; перевірка `Service.spec.type: ClusterIP` у `svc.yaml`, `spec.clusterIP: None` і суфіксу `-hl` у `svc-hl.yaml`; перевірка `HealthCheckPolicy.spec.targetRef.name` (GKE) на headless-сервіс; перевірка Gateway-API `backendRefs` (тільки `-hl`, без надлишкового `namespace`);
- автоматична заміна `apiVersion: batch/v1beta1` → `batch/v1` на диску;
- автоматичне видалення YAML-файлів, що складаються лише з `kind: BackendConfig`; `fail` при змішуванні з іншими `kind`;
- автоматична конвертація патчів `op: replace` на `/spec/template/spec/containers/<N>/image` у блок `images:` Kustomize та чистка існуючого `images:` (зрізає `:tag` у `name`, прибирає зайвий `newTag`);
- HPA / PDB / `topologySpreadConstraints` для `Deployment` у `…/k8s/…/base/`: HPA і PDB живуть у sibling-каталозі `…/k8s/…/components/` (Kustomize Component) — у base/ їх заборонено; ENV-залежні межі (dev-like vs прод);
- `NetworkPolicy` для кожного workload-маніфесту (`Deployment`, `StatefulSet`, `DaemonSet`, `Job`, `CronJob`): канонічний YAML генерується зі snippet-шаблонів (`deployment`, `statefulSet`), додає HTTPRoute-aware GCLB ingress-правило з `35.191.0.0/16` + `130.211.0.0/22` + `10.0.0.0/8`; відсутні документи створюються автоматично; заборонено `egress: [{}]`;
- спеціальні правила Hasura: канонічний `HTTPRoute` (4 правила з `URLRewrite`/`RequestHeaderModifier`); обовʼязковий ключ `HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS=true` у `ConfigMap` поруч з Deployment з образом `hasura/graphql-engine`; контроль `HASURA_GRAPHQL_ENABLED_APIS` в overlays;
- прод-оверрайди в overlay `kustomization.yaml`: `/spec/minReplicas`, `/spec/maxReplicas` для HPA та `/spec/minAvailable` для PDB через JSON6902 або Strategic Merge.

Усе пер-документне ядро перевірок (Ingress заборонено, autoscaling/v1 заборонено, GCP-анотації Service, metadata.namespace, рутинне валідаційне ядро) делеговано в `rego`-полісі `npm/policy/k8s/*` і виконується одним батчем через `runConftestBatch` всередині `runAllK8sRego`. JS лишає кросфайлову оркестрацію, modeline та FS-existence перевірки.

## Експорти / API

### Константи

| Експорт | Тип | Призначення |
| --- | --- | --- |
| `SERVICE_FORBIDDEN_GCP_ANNOTATION_KEYS` | `readonly string[]` (frozen) | Заборонені ключі анотацій `cloud.google.com/neg` та `cloud.google.com/backend-config` у `Service`. |
| `DEFAULT_CONTAINER_CPU_REQUEST` | `string = '0.5'` | Рекомендований `resources.requests.cpu` поза base. |
| `DEFAULT_CONTAINER_MEMORY_REQUEST` | `string = '512Mi'` | Рекомендований `resources.requests.memory` поза base. |
| `K8S_BASE_CONTAINER_CPU_REQUEST` | `string = '0.02'` | Обовʼязковий `cpu` у шарі `…/k8s/…/base/…`. |
| `K8S_BASE_CONTAINER_MEMORY_REQUEST` | `string = '128Mi'` | Обовʼязковий `memory` у шарі `…/k8s/…/base/…`. |
| `HASURA_REQUIRED_ENV_KEYS` | `string[]` | Перелік env-ключів, які мають бути у `data` ConfigMap для Hasura-Deployment (для людиночитного pass-повідомлення; авторитет — rego). |
| `HPA_FILENAME` | `string = 'hpa.yaml'` | Канонічна назва HPA-файла. |
| `PDB_FILENAME` | `string = 'pdb.yaml'` | Канонічна назва PDB-файла. |
| `NETWORK_POLICY_FILENAME` | `string = 'networkpolicy.yaml'` | Канонічна назва NetworkPolicy-файла. |
| `WORKLOAD_KINDS_WITH_NETWORK_POLICY` | `readonly string[]` (frozen) | `kind`-и, для яких потрібен `NetworkPolicy` поруч. |
| `COMPONENTS_DIR` | `string = 'components'` | Назва каталогу sibling до `base/` для Kustomize Components з HPA/PDB. |
| `KIND_TO_SNIPPET` | `Record<string, 'deployment' \| 'statefulSet'>` | Mapping `kind` → ім’я snippet-шаблону для `NetworkPolicy`. |

### Predicate / класифікатори шляху

- `isK8sYamlUnderBaseDirectory(relPosix: string): boolean` — чи відносний POSIX-шлях має сегмент `base/` всередині `k8s/…`.
- `pathHasK8sSegment(filePath: string, root?: string): boolean` — чи серед компонентів шляху (відносно `root`, якщо передано) є сегмент `k8s`.
- `isForbiddenK8sDevPath(rel: string): boolean` — `true` для шляхів виду `…/k8s/dev/…`.
- `isClusterScopedKubernetesKind(kind: string): boolean` — `true` для вбудованих cluster-scoped `kind`-ів (`Namespace`, `Node`, `ClusterRole`, …).
- `isBaseKustomizationPath(rel: string): boolean` — чи це `…/k8s/base/kustomization.yaml`.
- `isK8sBaseManifestYamlPath(rel: string, baseLower: string): boolean` — чи це ресурсний YAML у `k8s/base/` (не `kustomization.yaml`).
- `isHasuraDeploymentManifest(manifest: unknown): boolean` — чи `Deployment` використовує образ `hasura/graphql-engine` у будь-якому контейнері (`containers` / `initContainers`).

### Парсери / витягувачі

- `splitK8sApiVersion(apiVersion: unknown): { group: string, version: string }` — для `v1` повертає `group: ''`.
- `extractApiVersionAndKind(doc)` — внутрішня (не експортована), повертає `{ apiVersion, kind }` з тексту першого YAML-документа.
- `expectedSchemaUrl(filePath: string, doc: string): { expected: string \| null, reason: string }` — очікуваний `$schema` для маніфесту згідно з k8s.mdc; `null` означає «немає публічної схеми, modeline допустимо опустити».
- `k8sYamlFirstDocIsAlbYcHttpBackendGroup(yamlBody: string): boolean` — чи перший документ — `alb.yc.io/v1alpha1 HttpBackendGroup` (для виключення modeline).
- `collectJson6902OperationsFromPatchText(patchText: string): Array<{ op: string, path: string }>` — нормалізовані `op` (lowercase, trim) і `path`; порожній масив, якщо це не JSON6902-масив.

### Перевірки (повертають `string | null` — текст порушення або `null`)

- `deploymentResourcesViolation(manifest, inK8sBaseLayer = false)` — перевірка `Deployment.spec.template.spec.containers[].resources.requests.{cpu,memory}` (у base — жорстко `0.02` / `128Mi`).
- `metadataNamespaceRequiredViolation(manifest, inBaseDir = false)` — непорожній `metadata.namespace` для namespaced-документів (крім `Kustomization`, `List` і кластерних `kind`).
- `baseKustomizationNamespaceViolation(obj)` — непорожній `namespace:` у `base/kustomization.yaml`.
- `kustomizationPatchesSortedViolation(obj)` — `patches[]` у Kustomization відсортовано за tuple `[target.kind, target.name, target.namespace, path]`.
- `kustomizationInlinePatchOpsSortedViolation(patchText)` — inline JSON6902-ops відсортовано за `path` (тільки якщо всі `add`/`replace` і `path` попарно дизʼюнктні).
- `kustomizationSvcYamlMissingSvcHlViolation(kustomizationDir, pathRefs)` — для кожного `svc.yaml` у `pathRefs` є sibling `svc-hl.yaml`.
- `serviceSvcYamlClusterIpTypeViolation(manifest)` — `Service.spec.type === 'ClusterIP'` у `svc.yaml`.
- `serviceSvcHlYamlHeadlessViolation(manifest)` — `Service` у `svc-hl.yaml` headless (`spec.clusterIP: 'None'`) і `metadata.name` із суфіксом `-hl`.
- `healthCheckPolicyTargetRefHeadlessServiceViolation(manifest)` — `HealthCheckPolicy` (`networking.gke.io/v1`) посилається на headless `Service` (суфікс `-hl`).
- `httpRouteHasuraCanonViolation(manifest)` — канон 4 правил `HTTPRoute` для Hasura-Deployment.
- `deploymentTopologySpreadConstraintsViolation(manifest, expectedAppLabel)` — обовʼязкові канонічні `topologySpreadConstraints` у `Deployment`.
- `hpaManifestViolations(manifest, expectedDeployName, isDevLike): string[]` — список помилок (`scaleTargetRef`, replica-межі, `behavior`, …).
- `pdbManifestViolations(manifest, expectedAppLabel, isDevLike): string[]` — список помилок (`minAvailable`, `selector`).

### Класифікатори / збиральники

- `classifyBackendConfigManifestPresence(body: string): 'none' \| 'only' \| 'mixed' \| 'unparsed'` — для логіки «видалити лише `BackendConfig`-файл / fail при змішуванні».
- `collectDeploymentConfigMapRefs(deployment): Set<string>` — імена ConfigMap із `envFrom[*].configMapRef.name` та `volumes[*].configMap.name`.
- `collectGatewayApiRouteBackendServiceNames(spec): string[]` — імена `Service` з `backendRefs`/`backendRef` у дереві `spec` маршруту Gateway API (можливі дублікати).
- `collectGatewayApiRouteBackendRefsWithRedundantNamespace(spec, routeNs): string[]` — імена backend-сервісів, у яких `namespace` дорівнює `metadata.namespace` маршруту (надлишкове поле).
- `kustomizePathRefsForExistenceCheck(obj): string[]` — унікальні локальні шляхи з `resources`/`bases`/`components`/`crds`/`patchesStrategicMerge`/`patches[].path`/`patchesJson6902[].path`/`configurations[]`/`replacements[].path`.

### Кустомайз: дескриптори ресурсів і `target`

- `shouldValidateKustomizePatchTarget(target): boolean` — чи статичний resolve застосовується (без `labelSelector`/`annotationSelector`).
- `kustomizePatchTargetMatchesDescriptor(target, res): boolean` — порівнює `target` із `KustomizeResourceDescriptor`.
- `kustomizeResourceCatalogMatchesPatchTarget(catalog, target): boolean` — чи хоч один дескриптор у `catalog` відповідає `target`.
- `kustomizeResourceDescriptorsIdentityEqual(a, b): boolean` — повна тотожність `{group, version, kind, name, namespace}`.
- `kustomizeResourceDescriptorFromManifest(obj, kustomizationDefaultNs): KustomizeResourceDescriptor \| null` — будує дескриптор з YAML-кореня; `Kustomization` та документи без `metadata.name` пропускаються; для кластерних `kind` `namespace = ''`.
- `collectResourceDescriptorsForKustomizationWalk(kustAbs, rootNorm, visitedKustomization): Promise<KustomizeResourceDescriptor[]>` — рекурсивний обхід `resources` / `bases` / `components` / `crds` (через вкладені `kustomization.yaml`); повторний вхід в один файл — порожній внесок.
- `kustomizationPatchPathsByTargetKind(kust): Record<string, string[]>` — для прод-overlay: групує модифіковані JSON-Pointer paths за `kind` ресурсу-цілі (з урахуванням Strategic Merge).
- `kustomizePatchModifiedPaths(patchText): string[]` — нормалізовані `path`-и з тексту inline patch (JSON6902).

### Манипуляції з YAML / автофікси

- `replaceBatchV1beta1ApiVersionInYamlText(raw): { changed: boolean, content: string }` — рядкова заміна `apiVersion: batch/v1beta1` → `batch/v1`, з повагою до EOL і коментарів.
- `cleanupKustomizationImagesInYamlText(raw): string` — зрізає `:tag` із `name` у блоку `images:` (digest не чіпає) і видаляє зайвий `newTag`, який збігається з відрізаним тегом.
- `splitImageNameTagDigest(image): { name, tag, digest }` — розбиває рядок образу.
- `imageReplaceDeploymentPatchInfo(patchObj): { deployName, containerIndex, value } \| null` — розпізнає JSON6902 `op: replace` на `…/containers/<N>/image` для конвертації у `images:`.
- `convertImagePatchesToImagesInKustomization(kustAbs, rootNorm): Promise<void>` — повна конвертація patch → `images:` для одного `kustomization.yaml` (включно з резолвом базового образу через дерево kustomize).
- `ensureResourceInKustomizationYaml(raw, resourceName): string` — додає `- <resourceName>` у блок `resources:` без переписування решти файлу (стабільна вставка з YAML-кваліфікатором).
- `regenerateLegacyNetworkPolicyDocsInFile(npAbs, fail): Promise<void>` — переписує legacy-документи `NetworkPolicy` (наприклад з `egress: [{}]`) у канонічну форму через snippet.

### NetworkPolicy

- `loadSnippetSpec(snippetName: 'deployment' \| 'statefulSet'): object` — читає snippet-файл з `../policy/network_policy/template/*.snippet.yaml` і повертає розпарсений `spec`; результат кешується в пам’яті процесу.
- `snippetNameForKind(kind): 'deployment' \| 'statefulSet'` — диспетчеризація через `KIND_TO_SNIPPET`; кидає `Error` на невідомий `kind`.
- `buildNetworkPolicyYaml(deployName, appLabel, kind, gclbPorts?): string` — повний YAML `NetworkPolicy` із modeline `$schema`, анотацією `nitra.dev/workload-kind`, опційним GCLB ingress-правилом.
- `collectHttpRouteIngressForWorkload(dir, appLabel, fail): Promise<{ ports: number[] } | null>` — відсортовані унікальні TCP-порти з backendRefs `HTTPRoute`, що адресують workload з міткою `appLabel`.

### Workload-helper-и

- `deploymentAppLabel(deployment): string` — мітка `app` з `spec.selector.matchLabels` (з fallback на pod-template).
- `workloadAppLabel(manifest): string` — узагальнено для `Deployment`/`StatefulSet`/`DaemonSet`/`Job`/`CronJob`.
- `findDeploymentDocInDir(dirPath): Promise<Record<string, unknown> | null>` — перший YAML-документ `kind: Deployment` у каталозі.
- `k8sEnvSegmentFromRelPath(relPath): string` — повертає сегмент каталогу після `/k8s/` (`base`, `dev`, `ua-qa`, `ua`, …).
- `isDevLikeK8sEnvSegment(segment): boolean` — `true` для `base`, `dev`, `*-qa`.

### Hasura

- `kustomizationTreeHasHasuraDeployment(kustAbs, rootNorm): Promise<boolean>` — `true`, якщо в Kustomize-дереві є Hasura-Deployment.
- `enabledApisValueFromPatchText(patchText): string | null` — витягує значення `HASURA_GRAPHQL_ENABLED_APIS` із inline JSON6902-патча.
- `hasuraEnabledApisOverrideValue(kust): string | null` — значення overlay-патча для ConfigMap-ключа.

### Прод-оверрайди

- `prodOverlayHpaPdbOverrideNeeds(rootNorm, kustAbs): Promise<{ hpaNames: Set<string>, pdbNames: Set<string> }>` — для прод-overlay визначає, для яких HPA/PDB потрібні `/spec/minReplicas`, `/spec/maxReplicas`, `/spec/minAvailable`.
- `kustomizeResourceTreeHpaPdbDeploymentFlags(kustAbs, rootNorm): Promise<{ hasHpa, hasPdb, hasDeployment }>` — прапорці наявності в дереві ресурсів.

### Перевірка компонентів

- `validateComponentsForBaseDeployment(baseDir, deployName, appLabel, root, fail, passFn): Promise<void>` — повна перевірка sibling-каталогу `components/` для одного `Deployment` у base.

### Точка входу

- `async check(cwd = process.cwd()): Promise<number>` — повний прогін `check k8s`; повертає `process.exitCode` (`0` при успіху, `1` при будь-якому `fail`).

## Функції

Через об'єм модуля нижче згруповано фрагменти за функціональним призначенням; для кожної функції-вершини наведено сигнатуру, ключові параметри, що повертає та помітні побічні ефекти.

### Точка входу

#### `check(cwd?)`

- **Сигнатура:** `async function check(cwd: string = process.cwd()): Promise<number>`
- **Параметри:** `cwd` — корінь репозиторію.
- **Повертає:** `Promise<number>` — `0` (успіх) або `1` (якщо реєструвався хоча б один `fail`); агрегація через `createCheckReporter()`.
- **Side effects:** читання/запис YAML-файлів (автозаміна `batch/v1beta1`, переписування `images:`, генерація `networkpolicy.yaml`, видалення `BackendConfig`-only файлів через `unlink`); виклик `runConftestBatch` (Rego-полісі під `npm/policy/k8s/*`).
- **Послідовність кроків:** `loadCursorIgnorePaths` → `rewriteBatchV1beta1ApiVersionInK8sYamlFiles` → `removeBackendConfigOnlyK8sYamlFiles` → `findK8sYamlFiles` → `autofixKustomizationImagesYaml` → `ensureNetworkPoliciesForK8sWorkloads` → `assertNoForbiddenK8sDevPaths` → `runAllK8sRego` → `checkK8sYamlFile` для кожного файла → серія `validate*` (svc-pair, Hasura HTTPRoute, kustomization path refs, patch targets, HPA/PDB only with base Deployment, ConfigMap name match, Hasura ConfigMap, HPA/PDB/topology, NetworkPolicy, прод-оверрайди, Hasura overlay enabled APIs).

#### `runAllK8sRego(root, yamlFiles, fail)` _(внутрішня)_

Запускає `runConftestBatch` для 8 цільових namespace: `k8s.manifest`, `k8s.gateway`, `k8s.hpa_pdb`, `k8s.network_policy` (з `templateData` snippet-ів), `k8s.kustomization`, `k8s.svc_yaml`, `k8s.svc_hl_yaml`, `k8s.base_kustomization`, `k8s.base_manifest`. Поки що файлами обмежує: kustomization-и — за basename, base-resource — за регексом `/k8s/base/`, інше — весь набір.

### Виявлення / фільтрація шляхів

- `pathHasK8sSegment(filePath, root?)` — `relative` від `root`, потім розбиття за `/` чи `\` і пошук компонента `k8s`; пустий `relative` → `false` (сам корінь репо). Без `root` — старий шлях для тестів.
- `isK8sYamlUnderBaseDirectory(relPosix)` — `splitParts.indexOf('k8s')` + перевірка `dirs.includes('base')` для каталогу між `k8s` і файлом.
- `isForbiddenK8sDevPath(rel)` — `rel.includes('/k8s/dev/')` (попередньо `\\` → `/`).
- `isBaseKustomizationPath(rel)` — `K8S_BASE_KUSTOMIZATION_PATH_RE` = `/(^|\/)k8s\/base\/kustomization\.yaml$/`.
- `isK8sBaseManifestYamlPath(rel, baseLower)` — не `kustomization.yaml` + `K8S_BASE_SEGMENT_RE` (`/(^|\/)k8s\/base\//`).
- `findK8sYamlFiles(root, ignorePaths?)` _(внутрішня)_ — `walkDir` із фільтром `pathHasK8sSegment` + `YAML_EXTENSION_RE`; виключає `.github/` (належить `ga.mdc`); сортує `localeCompare`.

### Modeline `$schema` та валідація URL

- `checkK8sYamlFile(abs, root, fail, pass)` _(внутрішня)_ — диспетчер на `.yml` (fail), `HttpBackendGroup` (`k8sYamlFirstDocIsAlbYcHttpBackendGroup` — modeline заборонено), без modeline (`pass` із підказкою «опційно», fail якщо modeline нижче), стандартний шлях (`checkK8sYamlFileWithSchemaModeline`).
- `checkK8sYamlFileWithSchemaModeline` — `MODELINE_RE` для першого рядка, `countSchemaModelines > 1` → fail, заборона `$schema=file:…`, перевірка `https://`, виклик `expectedSchemaUrl` і порівняння з фактом.
- `expectedSchemaUrl(filePath, doc)` — `kustomization.yaml` → `KUSTOMIZATION_SCHEMA` (`schemastore`); інакше через `expectedSchemaUrlForTypedManifest(doc, apiVersion, kind)`.
- `expectedSchemaUrlForTypedManifest` — спочатку `lookupExplicitK8sSchema` (за `apiVersion + kind + type`/`*`), далі `v1` → `${YANNH_BASE}<kind>-v1.json`, group у `YANNH_GROUPS` → `${YANNH_BASE}<kind>-<group-first-segment>-<version>.json`, інакше → `${DATREE_CRD_BASE}<group>/<kind>_<version>.json`.
- `EXPLICIT_K8S_SCHEMAS` — `Map` з ключем `apiVersion\0kind\0typeKey`; зараз містить `InfisicalSecret v1alpha1` (datree raw) і `Secret type kubernetes.io/basic-auth` (yannh).

### Структура Kustomize

- `kustomizationPatchesSortedViolation(obj)` — порядок `patches[]` за `compareStringTuplesEn([kind, name, namespace, path])` (`localeCompare('en', { sensitivity: 'base' })`); `length < 2` → `null`; повертає `Have: …; Expected: …` у людиночитній формі.
- `kustomizationInlinePatchOpsSortedViolation(patchText)` — парсить JSON6902 через `parseJson6902OpsFromText` (`yaml.parseDocument(...).toJSON()` → масив `{op, path}`); сортує **тільки** якщо всі `add`/`replace` і `path` попарно дизʼюнктні (`jsonPointerPathsAreDisjoint`).
- `kustomizePathRefsForExistenceCheck(obj)` — `pathsFromKustomizationObject` (resources/bases/components/crds/patchesStrategicMerge/`patches[].path`) + `patchesJson6902[].path` + `configurations[]` + `replacements[].path`; dedup через `Set`.
- `validateKustomizationPathRefsExistOnDisk` _(внутрішня)_ — для кожного `kustomization.yaml`: `validateKustomizationRef` (resolve, перевірка під коренем, `stat`, `.yaml`/`.yml` для файла).
- `validateKustomizationPatchTargetsResolved` _(внутрішня)_ + `validatePatchTargetsOneKustomizationFile` — будує `catalog: KustomizeResourceDescriptor[]` через `collectResourceDescriptorsForKustomizationWalk` (рекурсивно), порівнює `target` (`failIfExplicitPatchTargetsNotInCatalog`), реєструє надлишкові `group`/`version` (`failIfExplicitPatchTargetsHaveRedundantGroupVersion`), перевіряє файлові kind/name (`failIfYamlFileRootsMissingFromCatalog`, `failIfStrategicMergePatchesNotInCatalog`, `failIfPathOnlyPatchesNotInCatalog`).
- `validateKustomizationIncludesSvcHlWithSvc` _(внутрішня)_ + `kustomizationSvcYamlMissingSvcHlViolation` — у `pathRefs` `svc.yaml` має парний `svc-hl.yaml` за тим самим `resolve`-каталогом.
- `baseKustomizationNamespaceViolation(obj)` — `obj.namespace` має бути непорожнім рядком після `.trim()`.

### Resource resolve / дескриптори

- `kustomizeResourceDescriptorFromManifest(obj, kustomizationDefaultNs)` — пропускає `Kustomization` і документи без `metadata.name`; для кластерних `kind` `namespace = ''`; інакше — `metadata.namespace` або дефолт із батьківського kustomization.
- `collectResourceDescriptorsForKustomizationWalk(kustAbs, rootNorm, visitedKustomization)` — рекурсивний обхід `resources`/`bases`/`components`/`crds`. Для каталогу — спускається у вкладений `kustomization.yaml`; для файлу — парсить документи і будує дескриптор з YAML-кореня. `visitedKustomization` (`Set<string>`) запобігає повторному входу. Дефолтний `namespace` тягнеться з батьківського kustomize.
- `kustomizePatchTargetMatchesDescriptor`, `kustomizeResourceCatalogMatchesPatchTarget`, `kustomizeResourceDescriptorsIdentityEqual` — порівняння `target` (`group/version/kind/name/namespace`).
- `shouldValidateKustomizePatchTarget(target)` — `patchTargetUsesSelector(target) === false`.

### Resources (`Deployment` containers)

- `deploymentResourcesViolation(manifest, inK8sBaseLayer = false)` — обходить `spec.template.spec.containers[]`, для кожного — `deploymentContainerResourcesViolation`. Перевіряє наявність `resources.requests.cpu` і `.memory` (`isValidCpuRequestValue`, `isValidMemoryRequestValue`); у base — додатково `isBaseCanonCpuValue` (`0.02` як рядок чи число) і `isBaseCanonMemoryValue` (`/^128Mi$/iu`).
- Допускає `cpu` як число (`0.02`) і як рядок (`"0.02"`, `"500m"`); `memory` лише непорожній рядок Quantity. У повідомленнях про помилку друкує `JSON.stringify(value)`.

### Service / Gateway API

- `serviceSvcYamlClusterIpTypeViolation(manifest)` — `kind === 'Service'` + `spec.type === 'ClusterIP'`.
- `serviceSvcHlYamlHeadlessViolation(manifest)` — `metadata.name` має `endsWith('-hl')`, `spec.clusterIP === 'None'`.
- `healthCheckPolicyTargetRefHeadlessServiceViolation(manifest)` — `apiVersion === 'networking.gke.io/v1'`, `kind === 'HealthCheckPolicy'`; якщо `targetRef.kind` явно задано і ≠ `Service` → `null`; вимагає `name.endsWith('-hl')`.
- `collectGatewayApiRouteBackendServiceNames(spec)` / `collectGatewayApiRouteBackendRefsWithRedundantNamespace(spec, routeNs)` — обхід дерева `spec`, для кожного вузла-обʼєкта перевіряє `isGatewayApiBackendRefToService` (потрібен числовий `port`, `kind === 'Service'`/відсутнє, `group === ''`/`core`/відсутнє); другий ще порівнює `namespace === routeNs`.

### Hasura

- `isHasuraDeploymentManifest(manifest)` — `kind: Deployment` і хоч один `containers[i].image` або `initContainers[i].image` під регекс `HASURA_GRAPHQL_ENGINE_RE` (`(^|\/)hasura/graphql-engine(?::|$)`); digest `@…` ігнорується.
- `httpRouteHasuraCanonViolation(manifest)` — пошук канонічного блока з 4 правилами (`<prefix>/ql` redirect, `<prefix>/ql/` redirect, `PathPrefix <prefix>/ql` + URLRewrite на `/`, WebSocket з `RequestHeaderModifier` remove `Authorization`); префікс параметризовано (рядок до `/ql`); додаткові правила поверх канону дозволені.
- `validateHasuraConfigMapRemoteSchemaPermissions` _(внутрішня)_ — у `data` ConfigMap у каталогу з Hasura-Deployment має бути `HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS=true` (рядок або булева).
- `validateHasuraOverlayEnabledApisOverride` _(внутрішня)_ — overlay має перевизначати `HASURA_GRAPHQL_ENABLED_APIS` на `'metadata,graphql'` (через JSON6902 на `/data/HASURA_GRAPHQL_ENABLED_APIS` або strategic merge).
- `kustomizationTreeHasHasuraDeployment(kustAbs, rootNorm)` — `true`, якщо у дереві ресурсів є Hasura-Deployment.

### HPA / PDB / Topology / NetworkPolicy

- `hpaManifestViolations(manifest, expectedDeployName, isDevLike)` — `validateHpaScaleTargetRef` (`scaleTargetRef.name === expectedDeployName`, `kind: Deployment`), `validateHpaReplicaLimits` (dev-like: `min === 1` && `max === 1`; прод: `min >= 2` && `max >= 2`), `validateHpaBehavior` (заборона будь-якого `behavior:`).
- `pdbManifestViolations(manifest, expectedAppLabel, isDevLike)` — `validatePdbMinAvailable` (dev-like: `0`; прод: `>= 1`), `validatePdbSelector` (`spec.selector.matchLabels.app === expectedAppLabel`).
- `deploymentTopologySpreadConstraintsViolation(manifest, expectedAppLabel)` — масив `topologySpreadConstraints` має містити канонічний елемент (`topologyKey: 'kubernetes.io/hostname'`, `whenUnsatisfiable: 'ScheduleAnyway'`, `maxSkew: 1`, `labelSelector.matchLabels.app === expectedAppLabel`).
- `validateComponentsForBaseDeployment(baseDir, deployName, appLabel, root, fail, passFn)` — перевіряє sibling `components/`: `kustomization.yaml` з `apiVersion: kustomize.config.k8s.io/v1alpha1, kind: Component`, `resources: [hpa.yaml, pdb.yaml]`; валідує `hpa.yaml` (dev-like `min=max=1`) і `pdb.yaml` (dev-like `minAvailable=0`).
- `validateKustomizeHpaPdbOnlyWithBaseDeployment` _(внутрішня)_ — заборонено HPA/PDB у дереві base; в overlay, що підключає `base`, HPA/PDB без узгодженого Deployment теж заборонено.
- `validateProdKustomizationOverrides` _(внутрішня)_ + `prodOverlayHpaPdbOverrideNeeds` — для прод-overlay перевіряє наявність JSON-Pointer-патчів `/spec/minReplicas`, `/spec/maxReplicas` (HPA) і `/spec/minAvailable` (PDB) у `patches[]`.
- `kustomizationPatchPathsByTargetKind(kust)` — групує модифіковані JSON-Pointer-шляхи з усіх `patches[]` за `kind` ресурсу-цілі (бере `target.kind` або з strategic merge — `kind`).
- `buildNetworkPolicyYaml(deployName, appLabel, kind, gclbPorts?)` — клонує `loadSnippetSpec(KIND_TO_SNIPPET[kind])`, підставляє `podSelector.matchLabels.app`, опційно додає GCLB ingress-правило (CIDR-и `35.191.0.0/16`, `130.211.0.0/22`, `10.0.0.0/8` + унікальні відсортовані TCP-порти), рендерить YAML з modeline `$schema=networkpolicy-networking-v1.json` (yannh).
- `collectHttpRouteIngressForWorkload(dir, appLabel, fail)` — у каталогу збирає `HTTPRoute` маніфести, для кожного `backendRef.name` зіставляє з `Service.metadata.name`, потім перевіряє `service.spec.selector.matchLabels.app === appLabel` і агрегує `port` як TCP. Результат — `{ ports: number[] }` (відсортовано, унікально) або `null`.
- `ensureNetworkPoliciesForK8sWorkloads` _(внутрішня)_ + `ensureNetworkPoliciesForWorkloadsInDir` — створює відсутні `networkpolicy.yaml` (multi-doc, якщо workload-ів кілька); legacy-документи (наприклад `egress: [{}]`) переписує через `regenerateLegacyNetworkPolicyDocsInFile`.

### Перетворення YAML

- `replaceBatchV1beta1ApiVersionInYamlText(raw)` — `rewriteLineBatchV1beta1ApiVersion` для кожного рядка; зберігає `\r\n`/`\n`; ігнорує рядки, що починаються з `#`; `BATCH_V1BETA1_API_VERSION_LINE_RE` ловить варіанти з `"`/`'`.
- `classifyBackendConfigManifestPresence(body)` — `parseAllDocuments(body)` → агрегує прапорці `hasBc`/`hasOther` через `updateBackendConfigKindFlags`; повертає `'only'`/`'mixed'`/`'none'`/`'unparsed'`.
- `cleanupKustomizationImagesInYamlText(raw)` — рядкова обробка блока `images:` (без YAML-rebuild): `findImagesBlockRange` (блок з відступу `KUSTOMIZATION_BLOCK_INDENT_RE`), `splitImagesBlockEntries` (елементи `- name:` за `KUSTOMIZATION_LIST_ITEM_RE`), `processImagesEntry` (зрізає `:tag` у `name` через `splitImageNameTagDigest`, видаляє `newTag` що дорівнює відрізаному).
- `convertImagePatchesToImagesInKustomization(kustAbs, rootNorm)` — будує `images:` із `patches[]` `op: replace` на `/spec/template/spec/containers/<N>/image` (`KUSTOMIZATION_DEPLOYMENT_CONTAINER_IMAGE_PATH_RE`); для кожного — резолвить базовий образ через `walkKustomizationForDeploymentImage` (обхід ресурсного дерева Kustomize), формує `name` (без тегу), `newName` (без тегу), `newTag` (лише якщо тег у patch.value відрізняється від базового); зайвий `patches[]` чистить.
- `regenerateLegacyNetworkPolicyDocsInFile(npAbs, fail)` — переписує файл, замінюючи legacy NetworkPolicy-документи на канонічні через `buildNetworkPolicyYaml`.

### Snippets

- `loadSnippetSpec(snippetName)` — `readFileSync(fileURLToPath(URL))` для `../policy/network_policy/template/deployment.snippet.yaml` або `…/stateful-set.snippet.yaml`; `parseDocument(raw).toJS().spec`; кеш у замиканні `_snippetCache`.
- `snippetNameForKind(kind)` — у `KIND_TO_SNIPPET`: `Deployment`/`Job`/`CronJob`/`DaemonSet` → `'deployment'`, `StatefulSet` → `'statefulSet'`; throw на невідомий.

### Допоміжні / утиліти

- `splitK8sApiVersion(apiVersion)` — для `v1` повертає `{ group: '', version: 'v1' }`; для `apps/v1` — `{ group: 'apps', version: 'v1' }`.
- `metadataNameTrimmed(meta)` / `metadataNamespaceTrimmed(meta)` — `.trim()` рядкового значення або `''`.
- `trimYamlScalarQuotes(raw)` — прибирає **парні** зовнішні `"`/`'` (`length >= 2` і однакові на кінцях).
- `stripTrailingNewlines(s)` — codePoint-варіант без regex (для sonarjs/slow-regex).
- `extractTopLevelManifestType(doc)` — для пошуку `type:` у документі (без повного YAML-парсера), для `EXPLICIT_K8S_SCHEMAS`.
- `collectJson6902OperationsFromPatchText(patchText)` — пробує YAML (`parseAllDocuments`), потім JSON (якщо починається з `[`); `op` приводиться до lowercase, `path` через `normalizeJsonPatchPath`.
- `noopFail = msg => msg` — дефолтний `fail` у `regenerateLegacyNetworkPolicyDocsInFile`.

## Залежності

### Зовнішні (Node.js / npm)

| Імпорт | Модуль | Призначення |
| --- | --- | --- |
| `existsSync`, `readFileSync` | `node:fs` | Синхронне читання snippet-шаблонів і перевірка вкладеного `kustomization.yaml`. |
| `readFile`, `readdir`, `stat`, `unlink`, `writeFile` | `node:fs/promises` | Асинхронні FS-операції з YAML-файлами (читання, запис автофіксів, видалення `BackendConfig`-only файлів, стат каталогів). |
| `basename`, `dirname`, `join`, `relative`, `resolve` | `node:path` | Маніпуляції зі шляхами (резолв kustomization-посилань, відносні шляхи для повідомлень). |
| `fileURLToPath` | `node:url` | Конвертація `import.meta.url`-URL snippet-файла у шлях. |
| `isSeq`, `parseAllDocuments`, `parseDocument`, `stringify` | `yaml` (npm) | Парсинг multi-doc YAML, рендер NetworkPolicy YAML, `toJSON()`/`toJS()` для роботи з обʼєктним поданням. |

### Внутрішні (репозиторій)

| Імпорт | Модуль | Призначення |
| --- | --- | --- |
| `createCheckReporter` | `../../../scripts/lib/check-reporter.mjs` | Збір pass/fail повідомлень і обчислення `process.exitCode`. |
| `loadCursorIgnorePaths` | `../../../scripts/lib/load-cursor-config.mjs` | Завантаження списку ігнор-шляхів з cursor-конфіга для `findK8sYamlFiles`. |
| `runConftestBatch` | `../../../scripts/lib/run-conftest-batch.mjs` | Запуск Rego-полісі (`npm/policy/k8s/*`) одним батчем на namespace; авторитативне ядро пер-документних перевірок (Plan B). |
| `walkDir` | `../../../scripts/utils/walkDir.mjs` | Обхід дерева файлів з ігнор-списком. |

### Файли активів

- `../policy/network_policy/template/deployment.snippet.yaml` — канон NetworkPolicy для `Deployment`/`Job`/`CronJob`/`DaemonSet`.
- `../policy/network_policy/template/stateful-set.snippet.yaml` — канон NetworkPolicy для `StatefulSet`.

### Прив'язки до правил / Rego

- `.cursor/rules/n-k8s.mdc` (`k8s.mdc`) — людиночитна специфікація правил.
- `npm/policy/k8s/manifest`, `…/gateway`, `…/hpa_pdb`, `…/network_policy`, `…/kustomization`, `…/svc_yaml`, `…/svc_hl_yaml`, `…/base_kustomization`, `…/base_manifest` — Rego-полісі для пер-документних перевірок (виклик через `runAllK8sRego`).

## Потік виконання / Використання

### Запуск з командного рядка

Команда викликається із кореня репозиторію скриптами вищого рівня (`bun run check` / `n-cursor check k8s`):

```javascript
import { check } from './manifests.mjs'

const exitCode = await check(process.cwd())
process.exit(exitCode)
```

### Послідовність всередині `check()`

1. **Підготовка.** `createCheckReporter()` створює `pass`/`fail`-колбеки і лічильник помилок. `loadCursorIgnorePaths(root)` повертає список каталогів, які треба ігнорувати під час обходу.
2. **Автозаміна `apiVersion`.** `rewriteBatchV1beta1ApiVersionInK8sYamlFiles` обходить всі YAML під `k8s` і записує оновлені файли (`batch/v1beta1` → `batch/v1`); коментарі та лапки збережено.
3. **Видалення `BackendConfig`-only.** `removeBackendConfigOnlyK8sYamlFiles` через `classifyBackendConfigManifestPresence` визначає файли, що містять лише `kind: BackendConfig`, і викликає `unlink`. Змішані з іншими `kind` файли — `fail` (потрібна ручна сегментація).
4. **Збір файлів.** `findK8sYamlFiles` повертає відсортований список абсолютних шляхів `*.yaml`/`*.yml` під сегментом `k8s`.
5. **Автофікси перед валідацією.** `autofixKustomizationImagesYaml` (конвертація patch → `images:` + чистка `images:`); `ensureNetworkPoliciesForK8sWorkloads` (генерація відсутніх `networkpolicy.yaml`).
6. **Швидкі заборони.** `assertNoForbiddenK8sDevPaths` — `…/k8s/dev/…` дає негайний `fail`.
7. **Rego-полісі.** `runAllK8sRego(root, yamlFiles, fail)` запускає `runConftestBatch` для 8 namespace (`k8s.manifest`, `k8s.gateway`, `k8s.hpa_pdb`, `k8s.network_policy` з `templateData`, `k8s.kustomization`, `k8s.svc_yaml`, `k8s.svc_hl_yaml`, `k8s.base_kustomization`, `k8s.base_manifest`). Це авторитативне per-document ядро (заборона `Ingress`/`autoscaling/v1`, GCP-анотації, namespace, ресурс-патерни тощо).
8. **Modeline / `$schema`.** Для кожного файла `checkK8sYamlFile` робить: `.yml` → fail (перейменуй); `HttpBackendGroup` (alb.yc.io) → modeline заборонено; без modeline і без modeline нижче — `pass` (опційно); інакше — `checkK8sYamlFileWithSchemaModeline` (рівно один modeline у першому рядку, `https://`, відповідність `expectedSchemaUrl`).
9. **Кросфайлові валідації.** Послідовно:
   - `validateSvcYamlAndSvcHlPairs` — пара `svc.yaml`/`svc-hl.yaml` у каталогу (наявність файла, відповідність імен/портів).
   - `validateHasuraHttpRouteCanon` — канон `HTTPRoute` для Hasura-Deployment у тому ж каталозі.
   - `validateKustomizationIncludesSvcHlWithSvc` — обидва файли підключено у `kustomization.yaml`.
   - `validateKustomizationPathRefsExistOnDisk` — кожне локальне посилання у `kustomization.yaml` існує на диску.
   - `validateKustomizationPatchTargetsResolved` — `patches[].target` / `patchesJson6902[].target` мають відповідник у каталозі ресурсів; додатково — заборона зайвих `group`/`version` без колізії GVK + name.
   - `validateKustomizeHpaPdbOnlyWithBaseDeployment` — HPA/PDB у base-дереві заборонені; в overlay HPA/PDB допустимі лише якщо у naслідуваному base є Deployment.
   - `validateConfigMapNameMatchesDeployment` — ConfigMap у `k8s/base/configmap.yaml` має ім’я, на яке посилається Deployment.
   - `validateHasuraConfigMapRemoteSchemaPermissions` — `HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS=true` для Hasura.
   - `validateDeploymentHpaPdbAndTopology` — для кожного `Deployment` у base: канонічний `topologySpreadConstraints` + sibling `components/` із `hpa.yaml`/`pdb.yaml`/`kustomization.yaml` (Component).
   - `validateNetworkPoliciesForK8sWorkloads` — кожен workload (`Deployment`/`StatefulSet`/`DaemonSet`/`Job`/`CronJob`) має `networkpolicy.yaml` поруч; правила egress (`kube-dns`, TCP 80/443 → `0.0.0.0/0`, інше — `namespaceSelector: {}`); ingress відповідає snippet + опційне GCLB-правило.
   - `validateProdKustomizationOverrides` — у прод-overlay є `/spec/minReplicas`, `/spec/maxReplicas`, `/spec/minAvailable` патчі для HPA/PDB.
   - `validateHasuraOverlayEnabledApisOverride` — overlay-патч на `HASURA_GRAPHQL_ENABLED_APIS = 'metadata,graphql'`.
10. **Повернення коду виходу.** `reporter.getExitCode()` — `0` якщо `fail` не реєструвався, інакше `1`.

### Імпорт окремих утиліт

Окремі експорти (наприклад `expectedSchemaUrl`, `kustomizationPatchesSortedViolation`, `deploymentResourcesViolation`, `buildNetworkPolicyYaml`, `replaceBatchV1beta1ApiVersionInYamlText`, `splitK8sApiVersion`) використовуються:

- юніт-тестами під `tests/` поруч із модулем;
- допоміжними скриптами / автоматизаціями `n-cursor`;
- іншими правилами/полісі, які перевикористовують класифікатори (`isClusterScopedKubernetesKind`, `isHasuraDeploymentManifest`) і constants (`KIND_TO_SNIPPET`, `HPA_FILENAME`, `PDB_FILENAME`, `NETWORK_POLICY_FILENAME`, `WORKLOAD_KINDS_WITH_NETWORK_POLICY`, `COMPONENTS_DIR`, `HASURA_REQUIRED_ENV_KEYS`).

### Reporting

Усі `fail(msg)` колбеки додають повідомлення у спільний агрегатор `createCheckReporter`. Повідомлення мають префікс відносного шляху файла (`relative(root, abs).replaceAll('\\', '/')`), щоб у CI логи були переносимі. Reporter обчислює `process.exitCode = 1` при наявності хоча б одного fail; `pass` повідомлення друкуються у звіт як inform.

### Контракти між шарами JS та Rego

JS-функції модуля **не дублюють** перевірки, винесені у Rego (Plan B). Закоментовані секції в коді (`// Plan B: …`) явно фіксують, які функції-перевірки видалено зі скрипту й перенесено у `npm/policy/k8s/*`. JS лишає лише: cross-file orchestration, modeline-перевірку, перевірку існування шляхів і FS-автофікси.

## Rebuild Test

- Чи модуль експортує точку входу `check(cwd)`, що повертає `Promise<number>`? **Так** — рядок 6696 (`export async function check(cwd = process.cwd())`).
- Чи перевіряється `kind: Deployment` контейнерний `resources.requests`? **Так** — `deploymentResourcesViolation` (експорт на рядку 2267) + `deploymentContainerResourcesViolation`.
- Чи перевірка `$schema` modeline покриває kustomization, yannh, datree, явну таблицю? **Так** — `expectedSchemaUrl` + `expectedSchemaUrlForTypedManifest` + `EXPLICIT_K8S_SCHEMAS`.
- Чи перевизначаються константи base-канону `0.02`/`128Mi` поруч із дефолтами `0.5`/`512Mi`? **Так** — `K8S_BASE_CONTAINER_*_REQUEST` і `DEFAULT_CONTAINER_*_REQUEST`.
- Чи генерація `NetworkPolicy` використовує snippet-шаблони з `../policy/network_policy/template/`? **Так** — `NETWORK_POLICY_SNIPPET_URLS` і `loadSnippetSpec`.
- Чи передбачені автофікси `batch/v1beta1` → `batch/v1` і `BackendConfig`-only-видалення? **Так** — `replaceBatchV1beta1ApiVersionInYamlText` і `removeBackendConfigOnlyK8sYamlFiles`.
- Чи делеговано пер-документне ядро у Rego? **Так** — `runAllK8sRego` з 8 namespace + коментарі «Plan B».
- Чи `pathHasK8sSegment` приймає опційний `root` для relativize? **Так** — щоб уникнути false-positive у репо з компонентою `k8s` у самому корені.
- Чи `findK8sYamlFiles` виключає `.github/`? **Так** — належить правилу `ga.mdc`.
- Чи `isHasuraDeploymentManifest` дивиться і `containers`, і `initContainers`? **Так** — `containerListHasHasuraImage(p.containers) || containerListHasHasuraImage(p.initContainers)`.
