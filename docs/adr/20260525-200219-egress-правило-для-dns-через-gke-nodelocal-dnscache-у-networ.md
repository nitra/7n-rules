---
session: 67092753-dd58-41fc-95cc-62403acd1407
captured: 2026-05-25T20:02:19+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/67092753-dd58-41fc-95cc-62403acd1407.jsonl
---

## ADR Egress-правило для DNS через GKE NodeLocal DNSCache у NetworkPolicy

## Context and Problem Statement
У GKE-кластерах з увімкненим NodeLocal DNSCache kubelet прописує у `/etc/resolv.conf` подів не ClusterIP kube-dns (наприклад `10.40.0.10`), а link-local адресу локального DNS-агента ноди (у діапазоні `169.254.0.0/16`). Якщо NetworkPolicy має `policyTypes: [Egress]`, але не містить дозволу на цей діапазон за портами 53/UDP і 53/TCP, DNS-запит блокується ще до того, як трафік доходить до kube-system, і под втрачає DNS-резолвінг повністю.

## Considered Options
* Дозволяти egress тільки на kube-dns у `kube-system` через `namespaceSelector` + `podSelector`
* Додавати `ipBlock: cidr: 169.254.0.0/16` з портами 53/UDP+TCP у кожну NetworkPolicy з Egress

## Decision Outcome
Chosen option: "Додавати `ipBlock: cidr: 169.254.0.0/16` з портами 53/UDP+TCP", because правило `namespaceSelector: kube-system → kube-dns` не допомагає на GKE з NodeLocal DNSCache: трафік іде на link-local адресу ноди, а не безпосередньо на ClusterIP kube-dns. Правило на `169.254.0.0/16` безпечне і в не-GKE-кластерах (на цій адресі ніхто не слухає — нічого не пропускає).

### Consequences
* Good, because DNS-резолвінг у подах (звернення до internal Service, реплікація StatefulSet, зовнішні ендпоінти) залишається робочим після ввімкнення Egress NetworkPolicy у GKE.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Фрагмент, який було узгоджено для додавання до `/Users/vitaliytv/www/nitra/.cursor/rules/n-k8s.mdc`:

```yaml
egress:
- to:
- ipBlock:
cidr: 169.254.0.0/16
ports:
- protocol: UDP
port: 53
- protocol: TCP
port: 53
```

Стандарт: RFC 3927 (link-local `169.254.0.0/16`). Технологія: GKE NodeLocal DNSCache. Файл правил: `.cursor/rules/n-k8s.mdc`. На момент завершення transcript редагування файлу ще не відбулося — асистент поставив уточнювальні запитання щодо місця в документі та наявності авто-чека в `check-k8s.mjs`.
