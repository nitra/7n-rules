---
session: 8a604541-32f2-4a17-b482-d057d3059bc4
captured: 2026-05-19T14:35:02+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/8a604541-32f2-4a17-b482-d057d3059bc4.jsonl
---

Ось що відбувається:

**Джерело проблеми — `npm/rules/k8s/` потрапляє під `findK8sRoots`**

`findK8sRoots` шукає будь-який `*.yaml` під деревом `k8s/`. Оскільки в cursor-репо є `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml` (та інші `.yaml`-файли), функція повертає `npm/rules/k8s` як корінь для сканування.

Далі `runKubeconform` отримує цей каталог і kubeconform рекурсивно заходить у нього — зустрічаючи:
- `policy/*/target.json` — OPA-фікстури для rego-тестів, не K8s-ресурси
- `fix/kubescape_exceptions/template/.kubescape-exceptions.json.snippet.json` — шаблон, не маніфест
- `policy/network_policy/template/networkpolicy.snippet.yaml` — snippet, не повноцінний маніфест

Kubeconform намагається розпарсити їх як Kubernetes YAML/JSON → `error unmarshalling resource`.

**Два шляхи фіксу:**

**Варіант A — `-ignore-filename-pattern` у `runKubeconform`** (kubeconform це підтримує — є прапор):
```
-ignore-filename-pattern \.snippet\.
-ignore-filename-pattern /target\.json$
```
Плюс: не треба чіпати `.n-cursor.json`. Мінус: захардкоджена конвенція імен файлів у лінтері.

**Варіант B — `ignore` в `.n-cursor.json` cursor-репо** (найчистіший для самого cursor-репо):
```json
"ignore": ["npm/rules"]
```
`loadCursorIgnorePaths` вже передається у `findK8sRoots` — просто прибрати `npm/rules/k8s` з обходу. Мінус: `.n-cursor.json` в cursor-репо вже є і там є інші rules, треба переконатись що `ignore` підтримується для конкретних піддиректорій.

Рекомендую **Варіант A** — він generic (захищає будь-яке майбутнє репо з `*.snippet.*`-файлами під `k8s/`), тоді як Варіант B — точкове виключення саме для cursor-репо. Хочеш щоб зробив А?

---

## ADR Перехід з stdin-пайпу на тимчасовий файл для kubescape scan

## Context and Problem Statement
`kubescape` v4.0.8 не підтримує читання маніфесту зі stdin через `-` як псевдошлях: бінарник трактує `-` як ім'я файлу, не знаходить його і завершується з `fatal: no resources found to scan`. Флагу типу `--stdin` або `--input` у `kubescape scan --help` немає. Через це `lint-k8s` → `runKubescapeStdin` завжди повертав exit 1.

## Considered Options
* Передача маніфесту через тимчасовий файл (`mkdtempSync` + `writeFileSync` + `rmSync` у `finally`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "тимчасовий файл", because kubescape v4.x не має жодного CLI-механізму для stdin; шлях до файлу — єдиний задокументований спосіб передачі маніфесту.

### Consequences
* Good, because transcript фіксує очікувану користь: мінімальний kustomize-проект проходить `kubescape scan` з exit 0 після фіксу.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файл: `npm/rules/k8s/lint/lint.mjs`, функція перейменована `runKubescapeStdin` → `runKubescapeManifest` (рядки ~210–224)
- Тимчасова директорія: `mkdtempSync(join(tmpdir(), 'nitra-cursor-k8s-'))`, файл `manifest.yaml`, прибирається у `finally` через `rmSync(dir, { recursive: true, force: true })`
- `k8s.mdc` версія `1.38` → `1.39`: текст про вхід kubescape виправлено (видалено `| kubescape scan -`)
- `npm/package.json`: `1.13.50` → `1.13.51`; `npm/CHANGELOG.md`: новий запис `[1.13.51] Fixed`
- Відтворення помилки: `echo "apiVersion: v1..." | kubescape scan -` → `{"level":"fatal","msg":"no resources found to scan"}`
