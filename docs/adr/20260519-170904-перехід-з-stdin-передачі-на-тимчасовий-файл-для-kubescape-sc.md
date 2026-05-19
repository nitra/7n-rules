---
session: 8a604541-32f2-4a17-b482-d057d3059bc4
captured: 2026-05-19T17:09:04+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/8a604541-32f2-4a17-b482-d057d3059bc4.jsonl
---

## ADR Перехід з stdin-передачі на тимчасовий файл для kubescape scan v4.x

## Context and Problem Statement
`kubescape` v4.0.8 не підтримує читання маніфесту через stdin (`-`), інтерпретуючи `-` як ім'я файлу. Реалізація `runKubescapeStdin` у `npm/rules/k8s/lint/lint.mjs:204-212` передавала зібраний `kubectl kustomize` маніфест через stdin (`stdio: ['pipe', ...]`), що призводило до `fatal: no resources found to scan` і `exit 1` при `bun run lint-k8s`.

## Considered Options
* Передача маніфесту через тимчасовий файл (`mkdtempSync` + `kubescape scan <file>`)
* Передача через stdin (`kubescape scan -`)

## Decision Outcome
Chosen option: "Передача маніфесту через тимчасовий файл", because `kubescape` v4.x не читає stdin: `kubescape scan --help` не згадує stdin/`-`; безпосередній тест `echo "apiVersion: v1..." | kubescape scan -` повертав `fatal: no resources found to scan`. Натомість `kubescape scan /tmp/built.yaml` з попереднім `kubectl kustomize <dir> > /tmp/built.yaml` дає `All controls passed. No issues found`, exit 0.

### Consequences
* Good, because `lint-k8s` проходить на реальних kustomize-проектах: перевірка мінімального тест-кейсу в `$(mktemp -d)` пройшла успішно, exit 0.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінений файл: `npm/rules/k8s/lint/lint.mjs` — функція перейменована з `runKubescapeStdin` на `runKubescapeManifest`; tmp-директорія створюється через `mkdtempSync(tmpdir() + '/nitra-cursor-k8s-')` і прибирається у `finally`.
- `npm/rules/k8s/k8s.mdc`: версія `1.38` → `1.39`, опис пайплайну оновлено.
- `npm/package.json`: `1.13.50` → `1.13.51`.
- `npm/CHANGELOG.md`: новий запис `[1.13.51] Fixed`.
- `kubescape` версія: `4.0.8` (Homebrew build `2026-05-08`).

---

## ADR Інвертний інваріант: відсутнє правило → відсутній lint-скрипт

## Context and Problem Statement
Після вимкнення правила `k8s` через `disable-rules` у `.n-cursor.json` скрипти `lint-k8s` і `bun run lint-k8s` залишалися у кореневому `package.json`. Функція `checkCursorRuleScripts` у `npm/rules/bun/fix/layout/check.mjs` перевіряла лише пряму відповідність (правило є → скрипт є), але не зворотню (правило відсутнє → скрипт відсутній). Та сама проблема виявилася і для `docker` (немає Dockerfile-ів у репо, `docker` поза `rules` і `disable-rules`, але `lint-docker` жив у `scripts`).

## Considered Options
* Розширити `checkCursorRuleScripts` зворотньою перевіркою (якщо rule відсутнє → скрипт і chain-рядок мусять бути відсутні)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Розширити `checkCursorRuleScripts` зворотньою перевіркою", because user підтвердив підхід і попросив реалізувати обидва кроки (пряму правку `package.json` і розширення check-логіки).

### Consequences
* Good, because `npx n-cursor check bun` на cursor-репо тепер виявляє orphan-скрипти (`lint-docker`, `lint-k8s`) автоматично; усі 8 тестів `check.test.mjs` проходять.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/bun/fix/layout/check.mjs`: `checkCursorRuleScripts` доповнена fail-гілкою; розпізнавання chain'а — regex з токен-границями (`\bbun run <script>\b`).
- `npm/rules/bun/fix/layout/check.test.mjs`: додано 3 тести на інвертний інваріант.
- `npm/rules/bun/bun.mdc`: версія `1.8` → `1.9`, зворотній інваріант задокументовано.
- `npm/package.json`: `1.13.51` → `1.13.52`.
- `npm/CHANGELOG.md`: новий запис `[1.13.52]`.
- Кореневий `package.json` cursor-репо: `lint-k8s` і `lint-docker` видалено зі `scripts` і `scripts.lint` chain.
- `.n-cursor.json`: `docker` додано в `disable-rules`.
