# Docker: заборона `USER root` і вимога `--chown` для `nginxinc/nginx-unprivileged`

**Status:** Accepted
**Date:** 2026-06-01

## Context and Problem Statement

`nginxinc/nginx-unprivileged` оголошує `USER 101` у базовому образі. Dockerfile з `USER root` без числового switch-back лишає образ root-owned; Kubernetes з `runAsNonRoot: true` падає з `CreateContainerConfigError` (kubelet перевіряє UID, не ім'я). Генеричне non-root-правило для Alpine-бекендів цей сценарій не охоплювало.

## Considered Options

* Окремий check-модуль `lib/docker-nginx-user.mjs` для stage на базі `nginx-unprivileged`
* Розширення генеричного `getNonRootRuntimeHint` (alpine-бекенди `USER app`)

## Decision Outcome

Chosen option: "Окремий check-модуль `lib/docker-nginx-user.mjs`", because `nginx-unprivileged` має специфічну семантику: UID 101 успадковується з базового образу, будь-яка явна `USER`-інструкція є або небезпечною або надлишковою; канон — жодного `USER`, `COPY`/`ADD` лише з `--chown=nginx:nginx`.

### Consequences

* Good, because антипатерн (`USER root` без switch-back) прапорцюється; канон проходить clean.
* Good, because 100 тестів docker-suite пройшли; e2e: exit 1 на антипатерні, exit 0 на каноні.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- `npm/rules/docker/lib/docker-nginx-user.mjs` — `getNginxUnprivilegedUserHint(content)`
- `npm/rules/docker/js/lint.mjs` — гілка `(nginx non-root)` в `checkDockerfile`
- Тести: `check-nginx-user.test.mjs` (16 тестів)
- `docker.mdc` v1.9 → v1.10, підрозділ «nginx-unprivileged — без USER, із --chown»
- Тригер: фінальний `FROM` містить `nginxinc/nginx-unprivileged` (з/без `mirror.gcr.io/`); build-stage не перевіряється
- Change-файл: `npm/.changes/1780293797694-679b5f.md` (minor / Added)
