---
session: 36997c0b-1771-4ca7-94a0-cc0890ca1296
captured: 2026-06-18T15:37:40+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/36997c0b-1771-4ca7-94a0-cc0890ca1296.jsonl
---

Done. Fix changelog підтверджено (exit 0).

**Що змінено:**
- `manifest.rego` — `allowed_hasura_images` тепер містить `v2.49.2.ubuntu.amd64` замість `v2.49.0`
- `manifest_test.rego` — canonical image та digest-image тест-кейси оновлено до `v2.49.2`
- `npm/.changes/260618-1537.md` — change-file зафіксував bump patch
- Rego тести: 20/20 passed

The `check-schema.test.mjs` reference (`v2.49.0` without suffix) — залишено без змін: воно слугує generic-маркером для HTTPRoute-перевірки, не частиною whitelist.

---

## ADR Мінімальна версія `hasura/graphql-engine` в policy-whitelist

## Context and Problem Statement
Kubernetes-policy `manifest.rego` містить явний whitelist дозволених образів `hasura/graphql-engine` (масив `allowed_hasura_images`). Попередня мінімальна версія `v2.49.0.ubuntu.amd64` більше не задовольняє вимоги — треба підняти поріг до `v2.49.2`.

## Considered Options
* Оновити `allowed_hasura_images` у `manifest.rego` до `v2.49.2.ubuntu.amd64`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Оновити `allowed_hasura_images` у `manifest.rego` до `v2.49.2.ubuntu.amd64`", because користувач прямо вказав нову мінімальну версію, а `manifest.rego` — єдине джерело правди для whitelist.

### Consequences
* Good, because Rego-тести підтвердили коректність (20/20 passed після зміни).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/k8s/policy/manifest/manifest.rego` — масив `allowed_hasura_images`, рядки `hasura/graphql-engine:v2.49.2.ubuntu.amd64` та `docker.io/hasura/graphql-engine:v2.49.2.ubuntu.amd64`
- `npm/rules/k8s/policy/manifest/manifest_test.rego` — canonical-image і digest-image тест-кейси оновлені до `v2.49.2`
- `npm/rules/k8s/js/tests/manifests/tests/check-schema.test.mjs` — посилання на `v2.49.0` (без суфікса) залишено: є generic-маркером HTTPRoute, не частиною whitelist
- Команда верифікації: `conftest verify -p npm/rules/k8s/policy/manifest` → 20 passed
- Change-file: `npm/.changes/260618-1537.md` (patch bump, розділ Changed)
