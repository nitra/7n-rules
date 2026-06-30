---
type: JS Module
title: fix-manifests.mjs
resource: npm/rules/k8s/manifests/fix-manifests.mjs
docgen:
  crc: e82ee52e
---

## Огляд

T0-autofix для `k8s/manifests`: детерміновані правки Kubernetes-маніфестів без участі LLM,
що закривають механічні родини порушень k8s.mdc. Виконується у fix-фазі перед LLM-ладдером;
кожна правка керується structured fix-hint детектора (поле `data.kind` у violation). Семантичну
коректність гарантує повторний прогін детектора — правки незворотні (поза rollback), тому за
будь-якої непевності трансформер лишає файл незмінним.

## Поведінка

- **deployment-strategy** — у кожному документі `kind: Deployment` проставляє канонічний
  `spec.strategy`: тип RollingUpdate, `maxUnavailable: 0`, `maxSurge: 1`. Якщо стратегія вже
  канонічна — без змін.
- **networkpolicy-egress** — у кожному `kind: NetworkPolicy` замінює `spec.egress` на канонічний
  набір правил із того самого snippet, яким перевірка темплейтить очікування (kind workload-а —
  з анотації `nitra.dev/workload-kind`, типово Deployment). Спільне джерело гарантує точний збіг
  із повторною перевіркою.
- **schema-modeline-first** — переносить рядок `# yaml-language-server: $schema=…` у перший рядок
  файлу, без відступів перед `#`.
- **kustomization-patches-sort** — упорядковує масив `patches` Kustomization за тим самим ключем,
  що й детектор (kind → name → namespace → path).
- **gateway-httproute-v1beta1** — піднімає `apiVersion` HTTPRoute з `gateway.networking.k8s.io/v1beta1`
  до `v1` разом із відповідним `$schema`-modeline.

## Публічний API

- `patterns` — масив T0-патернів (`id` / `test` / `apply`), що його споживає центральний fix-pipeline.
- `moveSchemaModelineFirst`, `sortKustomizationPatches`, `ensureDeploymentStrategy`,
  `ensureNetworkPolicyEgress` — чисті трансформери вмісту файлу: повертають новий текст або
  `null`, якщо змін немає чи вхід непевний.

## Гарантії поведінки

- Ідемпотентність: трансформер не змінює файл, якщо потрібний стан уже досягнутий або YAML
  парситься з помилками.
- Структурні правки роблять через yaml Document (зберігають коментарі); виняток — перенос
  modeline, що працює з текстом порядково.
- Запис відбувається лише за фактичної зміни вмісту; перед записом реєструється pre-image
  через `recordWrite` (для central rollback rung-а).
