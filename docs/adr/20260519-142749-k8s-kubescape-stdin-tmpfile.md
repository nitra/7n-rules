# Заміна stdin-сканування kubescape на тимчасовий файл

**Status:** Accepted
**Date:** 2026-05-19

## Context and Problem Statement

`kubescape v4.0.8` не підтримує зчитування маніфесту зі stdin через аргумент `-`: CLI повертає `{"level":"fatal","msg":"no resources found to scan"}` і завершується з ненульовим кодом виходу. Функція `runKubescapeStdin` у `npm/rules/k8s/lint/lint.mjs` передавала зібраний `kubectl kustomize`-маніфест через stdin, що спричиняло падіння `bun run lint` на кроці `lint-k8s`.

## Considered Options

* Запис маніфесту у тимчасовий файл через `mkdtempSync` + `writeFileSync`, передача шляху до файлу в `kubescape scan <tmpfile>`, очищення після сканування (`unlinkSync` + `rmdirSync`).
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Запис маніфесту у тимчасовий файл", because це єдиний підхід, підтверджений у transcript як такий, що дає `exit 0` із `kubescape v4.0.8` (`kubectl kustomize <dir>` → tmpfile → `kubescape scan <tmpfile> --severity-threshold high` → `All controls passed`).

### Consequences

* Good, because `bun run lint` → `lint-k8s` завершується з кодом `0`; всі k8s-маніфести проходять kubescape — підтверджено виводом `[✓] … All controls passed (kubescape)` для кожного кореня.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Змінений файл: `npm/rules/k8s/lint/lint.mjs` (функція `runKubescapeStdin`, ≈рядки 196–209 після патчу).
- Додані імпорти: `mkdtempSync`, `writeFileSync`, `unlinkSync`, `rmdirSync` з `node:fs`; `tmpdir` з `node:os`.
- Версія пакету: `1.13.50` → `1.13.51`; запис у `npm/CHANGELOG.md`.
- Коміт виправлення: `6e79e10`.
- Команда для відтворення проблеми: `echo "apiVersion: v1..." | kubescape scan -` (kubescape v4.0.8) → `no resources found to scan`.
- Підтверджений робочий варіант: `kubectl kustomize <dir> > /tmp/built.yaml && kubescape scan /tmp/built.yaml --severity-threshold high`.
