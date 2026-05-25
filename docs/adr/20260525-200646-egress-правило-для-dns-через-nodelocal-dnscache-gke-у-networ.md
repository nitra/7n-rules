---
session: 67092753-dd58-41fc-95cc-62403acd1407
captured: 2026-05-25T20:06:46+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/67092753-dd58-41fc-95cc-62403acd1407.jsonl
---

Processing ADR for the current session.

---

## ADR Egress-правило для DNS через NodeLocal DNSCache (GKE) у NetworkPolicy

## Context and Problem Statement
У GKE-кластерах із увімкненим NodeLocal DNSCache kubelet прописує у `/etc/resolv.conf` подів не ClusterIP kube-dns, а link-local адресу локального DNS-агента ноди (діапазон `169.254.0.0/16`, RFC 3927). Існуючий канонічний шаблон `networkpolicy.snippet.yaml` мав egress-правило тільки на kube-dns у `kube-system` — без link-local-блоку — тому DNS у подів із `policyTypes: [Egress]` блокується до того, як трафік взагалі досягає CoreDNS.

## Considered Options
* Додати `ipBlock: cidr: 169.254.0.0/16` (порти 53 UDP+TCP) в egress-правила NetworkPolicy шаблону
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `ipBlock: cidr: 169.254.0.0/16`", because без цього правила NetworkPolicy блокує DNS-запити на link-local-адресу DNS-агента ноди — і весь DNS у pod'ах лягає; правило на `kube-system` / kube-dns ClusterIP окремо тут не допомагає.

### Consequences
* Good, because transcript фіксує очікувану користь: DNS-резолвінг (`cluster-hasura-rw.gt-main.svc.n.internal`) у подів з Egress-policy починає працювати на GKE з NodeLocal DNSCache.
* Bad, because зміна зроблена тільки у `networkpolicy.snippet.yaml`; transcript фіксує, що `buildNetworkPolicyYaml` (програмний генератор у `npm/rules/k8s/js/manifests.mjs`), `network_policy.rego`, `network_policy_test.rego` і `k8s.mdc` — не оновлені, тобто snapshot (snippet) розійшовся з runtime-генератором і валідаторами.

## More Information
- Змінений файл: `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml` (egress-секція)
- Програмний генератор канону (не оновлено): `npm/rules/k8s/js/manifests.mjs` — функції `buildNetworkPolicyYaml` та `networkPolicyManifestViolations`
- OPA-правила (не оновлено): `npm/rules/k8s/policy/network_policy/network_policy.rego`, `network_policy_test.rego`
- Документація канону (не оновлено): `npm/rules/k8s/k8s.mdc`
- Специфіка GKE NodeLocal DNSCache: link-local `169.254.0.0/16` (RFC 3927) — не маршрутизується в інтернет, тому правило нешкідливе у не-GKE-кластерах
