---
session: 928ca6a6-4e84-4ac7-804e-fad338a80f17
captured: 2026-06-01T09:18:06+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/928ca6a6-4e84-4ac7-804e-fad338a80f17.jsonl
---

## ADR Docker-перевірка для nginx-unprivileged: заборона USER root і вимога --chown

## Context and Problem Statement
`nginxinc/nginx-unprivileged` вже оголошує `USER 101` і `EXPOSE 8080` у своїх шарах. Коли в Dockerfile додається `USER root` для виконання `COPY`/`RUN`, а потім не повертається назад числовим UID (`USER 101`), фінальний образ лишається root. Kubernetes з `runAsNonRoot: true` у такому разі падає з `CreateContainerConfigError`. Kubelet не підтверджує non-root за іменем `nginx` — лише за числовим UID.

## Considered Options
* Окремий check-модуль `lib/docker-nginx-user.mjs`, тригерований лише для фінального stage на базі `nginx-unprivileged`
* Розширення генеричного `getNonRootRuntimeHint` (вже існує для alpine-бекендів із `USER app`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Окремий check-модуль `lib/docker-nginx-user.mjs`", because генеричне non-root-правило (`getNonRootRuntimeHint`) покриває alpine-бекенди з паттерном `addgroup/adduser` + `USER app`, а nginx-unprivileged має специфічну семантику: дефолтний UID 101 успадковується з базового образу, явні `USER`-інструкції зайві взагалі, і необхідна вимога `--chown=nginx:nginx` на всіх `COPY`/`ADD`.

### Consequences
* Good, because антипатерн (`USER root` без switch-back) надійно прапорцюється на рівні check; канон (без `USER`, з `--chown`) проходить clean.
* Good, because transcript фіксує очікувану користь: 100 тестів у docker-suite пройшли; end-to-end через `check()` підтвердив exit 1 на антипатерні та exit 0 на каноні.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Новий модуль: `npm/rules/docker/lib/docker-nginx-user.mjs` — `getNginxUnprivilegedUserHint(content)`
- Підключення: `npm/rules/docker/js/lint.mjs` — гілка `(nginx non-root)` в `checkDockerfile`
- Тести: `npm/rules/docker/js/tests/lint/tests/check-nginx-user.test.mjs` (16 тестів)
- Документація: `npm/rules/docker/docker.mdc` v1.9 → v1.10, підрозділ «nginx-unprivileged — без USER, із --chown»
- Change-файл: `npm/.changes/1780293797694-679b5f.md` (bump: minor, section: Added)
- Тригер: фінальний `FROM` містить `nginxinc/nginx-unprivileged` (будь-який тег, з/без `mirror.gcr.io/`-префікса)
- Прапорцює: `USER root`/`USER 0`, switch-back `USER 101`/`USER nginx`, будь-який явний `USER`, `COPY`/`ADD` без `--chown`; build-stage не перевіряється

---

## ADR Виключення бібліотек компонентів Vue з правила auto-import

## Context and Problem Statement
Правило `vue.mdc` (рядки 291–292) вимагало використовувати `unplugin-auto-import` і забороняло явні `import { … } from 'vue'` у всіх пакетах із `vue` у `dependencies`. Бібліотеки компонентів (UI-кіти, shared-компоненти) декларують `vue` у `peerDependencies` і не мають власного Vite-білда зі споживачем — їхні джерела не проходять через `unplugin-auto-import` кінцевого Vite-проєкту, тому явний `import { ref } from 'vue'` у них обов'язковий.

## Considered Options
* Умовне пропускання перевірки для пакетів із `vue` у `peerDependencies` (окремий хелпер `isVueComponentLibraryPkg`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Умовне пропускання через `isVueComponentLibraryPkg`", because пакет із `vue` у `peerDependencies` є бібліотекою компонентів — він не має власного конфігу `AutoImport`, і його `import { … } from 'vue'` є коректним, а не порушенням.

### Consequences
* Good, because transcript фіксує очікувану користь: явний `import { ref } from 'vue'` у пакеті-бібліотеці більше не генерує помилку в `check()`.
* Good, because правило для Vite-застосунків (де `vue` у `dependencies`) лишилося незмінним — охоплення не звужено.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінений файл: `npm/rules/vue/js/packages.mjs` — новий чистий хелпер `isVueComponentLibraryPkg(pkg)`, умовне пропускання в `checkViteConfig` та `checkVueImportViolations`
- Тести: `npm/rules/vue/js/tests/packages/tests/component-library.test.mjs`
- Документація: `npm/rules/vue/vue.mdc` і `.cursor/rules/n-vue.mdc` — v2.0 → v2.1, уточнення параграфа про auto-import (обмеження лише для Vite-проєктів, не для бібліотек)
- Change-файл: `npm/.changes/1780294523083-0964b2.md` (bump: minor, section: Changed)
- Критерій виключення: `pkg.peerDependencies?.vue` є непорожнім рядком
