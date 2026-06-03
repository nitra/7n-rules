---
session: b6bfe2b1-7a9a-47f9-9f80-a8bac7833bb2
captured: 2026-06-03T13:49:05+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/b6bfe2b1-7a9a-47f9-9f80-a8bac7833bb2.jsonl
---

Готово. Все чисто і здано.

## Що зроблено

**Нові записи в реєстрі `TOOLS` (`ensure-tool.mjs`):**
- `opa` — raw binary, `opa_linux_${arch}`, brew `opa`, scoop `opa`
- `regal` — raw binary, `regal_Linux_${arch}`, brew `regal`, scoop (404 → GitHub fallback)
- `hadolint` — raw binary, `hadolint-linux-${arch}`, brew `hadolint`, scoop `hadolint`
- `kubeconform` — tar.gz, `kubeconform-linux-${arch}.tar.gz`, brew `kubeconform`, scoop `kubeconform`
- `kubescape` — raw binary, `kubescape_${ver}_linux_${arch}`, brew `kubescape`, scoop `kubescape`

**Движок `installFromGithub` розширено** на `archive: false` (download+chmod без tar) — сирі бінарники тепер обробляються нарівні з архівами.

**Мігровані call-sites:**
- `rego/lint/lint.mjs` — `opa`/`regal` → `ensureTool` (обов'язкові), `conftest` — м'який skip (як було, свідомо)
- `docker/lib/docker-hadolint.mjs` — `ensureTool('hadolint')` try/catch, docker-fallback збережений
- `k8s/lint/lint.mjs` — `kubeconform`/`kubescape` → `ensureTool`

**Тести:** `scripts/lib/tests/ensure-tool.test.mjs` (новий, 6 тестів), docker/rego/ga/text-тести оновлено під `ensureTool` + lint-чисті (статичні regex, no-empty-function). `withBinRemovedFromPath` тепер сам виставляє `N_CURSOR_NO_AUTO_INSTALL=1`. Change-файл: `npm/.changes/…` `Added`, minor.
---

## ADR Авто-встановлення зовнішніх CLI-залежностей в `@nitra/cursor` (`ensureTool`)

## Context and Problem Statement
Скрипти `@nitra/cursor` спавнять зовнішні бінарники (`conftest`, `hk`, `shellcheck`, `opa`, `regal`, `hadolint`, `kubeconform`, `kubescape`, `actionlint`, `dotenv-linter`). До цього резолв відбувався через `resolveCmd` з ad-hoc install-підказками в кожному `lint.mjs`/`fix.mjs`. При відсутності бінарника — команда падала без чіткого remediation. Вирішено ввести єдиний seam авто-встановлення із крос-платформною матрицею (macOS/Windows/Linux).

## Considered Options
* Авто-install через пакетний менеджер OS (brew/scoop) + GitHub Release fallback на Linux і Win без Scoop
* Завантаження pinned GitHub Release binary на всіх платформах (версійна детерміністичність)
* Залишити `resolveCmd` + hint-only без авто-install (status quo)

## Decision Outcome
Chosen option: "Авто-install через пакетний менеджер OS + GitHub Release fallback", because команда свідомо прийняла latest-версії без пінінгу, а brew/scoop — типовий інструментарій розробників команди (macOS: brew, Windows: Scoop з Main-bucket, Linux: GitHub Release tar/binary + chmod). winget відхилено — ні `hk`, ні `conftest` не присутні у winget-pkgs.

### Consequences
* Good, because transcript фіксує очікувану користь: зовнішній CLI самостійно ставиться при першому виклику `n-fix`/`n-lint` замість молчазного падіння.
* Good, because `withBinRemovedFromPath` централізовано виставляє `N_CURSOR_NO_AUTO_INSTALL=1` — тести не тягнуть реальний brew/curl.
* Bad, because `brew install`/`scoop install` дають latest без пінінгу — різні члени команди можуть мати різні версії інструментів; transcript не містить підтверджених негативних наслідків щодо поведінкових розходжень.

## More Information
- `npm/scripts/lib/ensure-tool.mjs` — движок: `resolveCmd` → кеш → `brew`/`scoop install` → `installFromGithub` (tar.gz або raw binary + chmod) → hard-fail з hint.
- `N_CURSOR_NO_AUTO_INSTALL=1` — opt-out env для тестів і CI-сценаріїв без мережі.
- Реєстр `TOOLS` (інлайн у `ensure-tool.mjs`): `hk`, `conftest`, `shellcheck`, `actionlint`, `dotenv-linter`, `opa`, `regal`, `hadolint`, `kubeconform`, `kubescape`.
- Перевірено: `hk` є у Scoop Main ([github.com/ScoopInstaller/Main/blob/master/bucket/hk.json](https://github.com/ScoopInstaller/Main/blob/master/bucket/hk.json)); `conftest` є у Scoop Main (v0.68.2); `regal` відсутній у Scoop → GitHub Release fallback.
- `hk install` (вписати git pre-commit hook) викликається з `runFixCommand` у `npm/bin/n-cursor.js` з гардом `process.env.CI`.
- Попередній канон — «Plan B: hint + hard-fail» у коментарі `run-conftest-batch.mjs` — замінено на авто-install (Plan A).

---

## ADR `error_log off` → `error_log /dev/null crit` у nginx-шаблонах

## Context and Problem Statement
Правило `nginx-default-tpl` вимагало `error_log off;` у `default.conf.template`. Виявилось, що `off` в nginx — це **ім'я файлу** (`/etc/nginx/off`), а не директива вимкнення логу. Під `readOnlyRootFilesystem: true` (Kubernetes) nginx не може писати у нечислені файли, тому `error_log off;` падає при старті контейнера.

## Considered Options
* Замінити `error_log off;` на `error_log /dev/null crit;`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Замінити `error_log off;` на `error_log /dev/null crit;`", because `/dev/null` — writable character device, доступний під `readOnlyRootFilesystem`, а `crit` мінімізує обсяг логів без ризику краша контейнера.

### Consequences
* Good, because transcript фіксує очікувану користь: nginx не падає під `readOnlyRootFilesystem: true` у Kubernetes.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/nginx-default-tpl/js/template.mjs` — додано `migrateErrorLogOffDirective()`: regex `/error_log\s+off\s*;/gu` → `error_log /dev/null crit;`; перевірка змінена з `c.includes('error_log off')` на `c.includes('error_log /dev/null crit')`.
- `npm/rules/nginx-default-tpl/nginx-default-tpl.mdc` — канонічний приклад оновлено з поясненням: `error_log off;` = ім'я файлу `/etc/nginx/off`, `error_log /dev/null crit;` — коректна директива.
- Фікстура `js/tests/template/fixtures/default.conf.template` оновлена.
- Тести: 2 нових кейси `migrateErrorLogOffDirective` (заміна і no-op); усього 50/50.
