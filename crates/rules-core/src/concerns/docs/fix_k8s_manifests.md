---
type: Rust Module
title: fix_k8s_manifests.rs
resource: crates/rules-core/src/concerns/fix_k8s_manifests.rs
docgen:
  crc: 91285131
  model: local-openai/gemma-4-26b-a4b-it
  tier: local-min
  score: 60
---

## Огляд

Native fix-поверхня концерну `k8s/manifests` — Rust-порт T0-патернів `fix-manifests.mjs`.  # Чим редагується YAML і чому саме ним  Фікси мусять зберігати коментарі: маніфести під `k8s/` їх несуть (`# yaml-language-server:`-модлайни, пояснення біля ресурсних лімітів), і serde-серіалізація знищила б їх мовчки. Доккоментар [`super::fix`] фіксував, що Rust не має format-preserving YAML-редактора рівня `toml_edit`, — станом на цей зріз має.  Обрано **`yamlpatch`** (той самий крейт, на якому стоїть zizmor). Його операції (`Add`, `Replace`, `MergeInto`) лягають на JS-`setIn` майже дослівно, а `MergeInto` сам створює вкладену мапу, якої ще немає.  **`yaml-edit` перевірено й відхилено.** Він побудований на rowan (тобто НЕ додав би нового дерева залежностей — `rowan` уже в графі через `apollo-parser`) і бездоганний на round-trip. Але додавання ключа у ВКЛАДЕНУ блокову мапу (`Mapping::set` і навіть цільовий `modify_mapping`) кладе його на нульову колонку:  ```yaml spec: ports: - port: 80 type: ClusterIP   # ← мало бути всередині spec ```  Тобто мовчки інший маніфест. Для фікс-поверхні це найгірший можливий режим відмови, тож ціна важчого дерева залежностей прийнята свідомо.  # Мультидок  `yamlpath::Document` бачить потік цілком, але маршрут застосовується лише до ПЕРШОГО збігу, а JS править КОЖЕН документ. Тому потік ріжеться по рядках-роздільниках самотужки, кожен шматок патчиться окремо, і роздільники повертаються на місце дослівно.  Це водночас точніше за JS: там мультидок перезбирається через `join('\n---\n')`, що з'їдає провідний `---` і нормалізує хвіст. Порт зберігає файл як є — семантику це не міняє, а diff робить чесним.

## Публічний API

- move_schema_modeline_first — Переміщує модлайн у перший рядок файла — порт `moveSchemaModelineFirst`.  `None`, якщо модлайна немає або він УЖЕ перший: обидва випадки — штатний no-op, а не помилка.
- replace_gateway_httproute_v1beta1 — `apiVersion: gateway.networking.k8s.io/v1beta1` → `/v1` разом із `$schema`-модлайном — порт `replaceGatewayHttpRouteV1beta1ApiVersionInYamlText`.  Модлайн переписується В ТОМУ Ж проході: інакше маніфест лишився б із схемою, яка описує вже неіснуючу версію.
- replace_batch_v1beta1 — `apiVersion: batch/v1beta1` → `batch/v1` — порт `replaceBatchV1beta1ApiVersionInYamlText`.
- ensure_svc_cluster_ip_type — Проставляє `spec.type: ClusterIP` у кожен `kind: Service` — порт `ensureSvcClusterIpType`.
- ensure_svc_hl_cluster_ip — Проставляє `spec.clusterIP: None` у кожен `kind: Service` — порт `ensureSvcHlClusterIp`.  `metadata.name` НЕ чіпається: суфікс `-hl` — це перейменування ресурсу, на яке посилаються інші файли, тобто не T0.
- ensure_deployment_strategy — Проставляє канонічний `spec.strategy` у кожен `kind: Deployment` — порт `ensureDeploymentStrategy`.  Ідемпотентність перевіряється за ТРЬОМА листками, а не за рівністю всього обʼєкта, як у JS. Різниці у наслідку немає: коли листки збігаються, а під `strategy` є ще щось, JS теж переписує файл тими самими значеннями й отримує байт-у-байт той самий текст, тобто запису не робить.
- k8s_manifests_fix — Будує [`FixPlan`] для `k8s/manifests` — порт `patterns` із `fix-manifests.mjs`.  Родина порушення береться з `data.kind` детектора (#3 fix-hints), як і в JS. Незнайома родина просто не має трансформера — це не помилка, а «цей зріз її ще не лагодить».  Порядок правок стабільний за шляхом: план — детермінований артефакт, який іде в JSON, і нестабільний порядок робив би diff шумним.

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
