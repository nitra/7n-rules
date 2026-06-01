---
session: 928ca6a6-4e84-4ac7-804e-fad338a80f17
captured: 2026-06-01T09:35:33+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/928ca6a6-4e84-4ac7-804e-fad338a80f17.jsonl
---

## ADR Окрема non-root-перевірка для `nginxinc/nginx-unprivileged` у Dockerfile

## Context and Problem Statement
Фінальні Docker-stage на базі `nginxinc/nginx-unprivileged` можуть містити `USER root` для побічних побудовних кроків, після чого необхідно повернутися до `USER 101`. Якщо повернення пропущене або вказане іменем `nginx` замість числового UID, образ лишається root-owned і Kubernetes з `runAsNonRoot: true` падає з `CreateContainerConfigError`. Існуюче генеричне non-root-правило (Alpine-бекенди `USER app`) не охоплює цей специфічний сценарій.

## Considered Options
* Нова окрема гілка перевірки в `lib/docker-nginx-user.mjs` для `nginxinc/nginx-unprivileged`-specific stage
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Нова окрема гілка перевірки в `lib/docker-nginx-user.mjs`", because `nginxinc/nginx-unprivileged` вже оголошує `USER 101` і `EXPOSE 8080` в базовому образі, тому будь-який явний `USER`-інструкція є або небезпечним (root) або надлишковим; канон — жодного `USER`, `COPY`/`ADD` виключно з `--chown=nginx:nginx`.

### Consequences
* Good, because `npx @nitra/cursor check docker` прапорцює антипатерн (`USER root` у nginx-unprivileged stage) і пропускає канон (exit 0), що дозволяє ловити конфігурацію, яка призводить до `CreateContainerConfigError` у Kubernetes із `runAsNonRoot: true`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Тригер: фінальний `FROM` містить `nginxinc/nginx-unprivileged` (з або без `mirror.gcr.io/`-префікса).
- Прапорцюється: `USER root`/`USER 0`, switch-back `USER 101`/`USER nginx`, будь-який інший явний `USER`, `COPY`/`ADD` без `--chown`.
- Build-stage не зачіпається.
- Нові файли: `npm/rules/docker/lib/docker-nginx-user.mjs`, `npm/rules/docker/js/tests/lint/tests/check-nginx-user.test.mjs` (16 тестів).
- Змінені файли: `npm/rules/docker/js/lint.mjs` (виклик `getNginxUnprivilegedUserHint`), `npm/rules/docker/docker.mdc` (версія `1.9`→`1.10`, підрозділ «nginx-unprivileged — без USER, із --chown»).
- Перевірка через `node bin/n-cursor.js fix docker` на антипатерні → `❌ … USER root …`; на каноні → exit 0.

---

## ADR Виняток зі стеку auto-import для бібліотек компонентів Vue (`peerDependencies`)

## Context and Problem Statement
Правило в `vue.mdc` вимагає для Vite-проєктів: прибирати ручні `import { … } from 'vue'`, мати `'vue'` у `AutoImport.imports` і `VueMacros`/`AutoImport` у `vite.config`. Пакети-бібліотеки компонентів (де `vue` оголошено у `peerDependencies`) також мають `.vue`-файли з явними Vue-імпортами, але ці джерела не проходять через `unplugin-auto-import` споживача — вони компілюються й постачаються вже готовими. Застосування правила до таких пакетів є помилковим.

## Considered Options
* Виняток лише для `import { … } from 'vue'`, решта правил залишається
* Повний виняток усього стеку auto-import (заборона value-імпортів, вимога `'vue'` у `AutoImport.imports`, наявність `VueMacros`/`AutoImport` у `vite.config`) для бібліотек компонентів

## Decision Outcome
Chosen option: "Повний виняток усього стеку auto-import для бібліотек компонентів", because бібліотека компонентів постачається скомпільованою і не потребує цього стеку в собі — він налаштовується у Vite-проєкті-споживачі; часткове виключення залишало б хибні спрацьовування на `vite.config`.

### Consequences
* Good, because transcript фіксує очікувану користь: `check vue` на бібліотеці компонентів із `import { ref } from 'vue'` більше не видає помилок; звичайний Vite-додаток лишається без змін у поведінці перевірки.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Детектор: новий чистий хелпер `isVueComponentLibraryPkg(pkg)` у `npm/rules/vue/js/packages.mjs` — `true`, якщо `vue` у полі `peerDependencies` `package.json`.
- Ознака протягнута через `collectVueRoots` → `checkVuePackage` → `checkViteConfig` / `checkVueImportViolations`.
- Пропускається для бібліотеки: скан заборонених value-імпортів, вимога `'vue'` у `AutoImport.imports`, вимога `VueMacros`/`AutoImport` у `vite.config`. Виводиться одне pass-повідомлення `[component-library] auto-import стек не вимагається`.
- Не пропускається: перевірка `npm_lifecycle_event` (Bun-сумісність), наявність `vite-env.d.ts`, `jsconfig.json` тощо.
- Документація: параграф-виняток у `npm/rules/vue/vue.mdc` і дзеркалі `.cursor/rules/n-vue.mdc`, версія frontmatter `2.0`→`2.1`.
- Тести: `npm/rules/vue/js/tests/packages/tests/component-library.test.mjs` (6 кейсів), усього vue-сюїта 23 passed.
