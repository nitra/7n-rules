---
session: 67092753-dd58-41fc-95cc-62403acd1407
captured: 2026-05-25T20:04:26+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/67092753-dd58-41fc-95cc-62403acd1407.jsonl
---

No response requested.

---

TRANSCRIPT END

OUTPUT NONE ONLY IF the session is genuinely trivial (typo/comment fix, pure Q&A, aborted session). Otherwise emit the ADR block(s). No preamble.

## ADR Egress DNS через NodeLocal DNSCache у NetworkPolicy (GKE)

## Context and Problem Statement
У GKE-кластерах з увімкненим NodeLocal DNSCache kubelet прописує у `/etc/resolv.conf` подів не ClusterIP kube-dns, а link-local-адресу локального DNS-агента ноди (діапазон `169.254.0.0/16`, RFC 3927). Через це NetworkPolicy з `policyTypes: [Egress]`, що дозволяє egress лише на `kube-system` (namespaceSelector), блокує DNS-запити до `169.254.x.x:53` — і весь резолвінг в поді падає ще до того, як трафік доходить до kube-dns.

## Considered Options
* Дозволяти egress лише на kube-dns ClusterIP через `namespaceSelector: kubernetes.io/metadata.name: kube-system`
* Додатково дозволяти egress на `ipBlock: cidr: 169.254.0.0/16`, порти 53/UDP і 53/TCP (link-local, NodeLocal DNSCache)

## Decision Outcome
Chosen option: "Додатково дозволяти egress на `ipBlock: 169.254.0.0/16`, порти 53/UDP і 53/TCP", because на GKE з NodeLocal DNSCache DNS-трафік з поду йде саме на link-local-адресу ноди, а не безпосередньо на ClusterIP kube-dns; правило на `kube-system` alone не покриває цей шлях.

### Consequences
* Good, because DNS-резолвінг у подів із Egress-policy на GKE з NodeLocal DNSCache працює коректно; без цього правила cluster-internal DNS (наприклад `cluster-hasura-rw.gt-main.svc.n.internal`) не резолвиться.
* Bad, because у не-GKE-кластерах без NodeLocal DNSCache правило нешкідливе (на `169.254.x.x:53` ніхто не слухає), але створює зайвий рядок у policy; transcript не містить підтверджених негативних наслідків.

## More Information
- Змінений файл: `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml` — блок додано у розділ `egress` між правилом на `kube-system` і правилом `0.0.0.0/0` (80/443).
- Правило:
```yaml
- to:
- ipBlock:
cidr: 169.254.0.0/16
ports:
- protocol: UDP
port: 53
- protocol: TCP
port: 53
```
- Посилання на стандарт: RFC 3927 (link-local, `169.254.0.0/16` — адреси «на цій же машині/лінку», не маршрутизуються в інтернет).
- Відкриті питання зі сесії: чи є супутній `.mdc` або `check-*.mjs` для валідації NetworkPolicy зі snippet'ом — у transcript не перевірялося.
