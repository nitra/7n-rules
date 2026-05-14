---
name: n-abie-kustomize
description: >-
  Трансформація дерев k8s у Kustomize (base + overlays): dev → base, без окремої dev/; директорія
  users/ у середовищах не входить у kustomization (окремі маніфести між середовищами); дерево з
  CNPG Cluster (postgresql.cnpg.io/v1) не трансформувати
version: '1.2'
---

Спочатку знайди всі директорії `k8s/` у проєкті. Виконуй трансформацію лише для тих, у яких **немає** директорії `base/`. Якщо `base/` вже існує — пропускай цю директорію і рухайся далі.

Якщо в дереві тієї директорії `k8s/`, яку збираєшся трансформувати (рекурсивно по `*.yaml`), є маніфест з **`apiVersion: postgresql.cnpg.io/v1`** і **`kind: Cluster`** (CloudNativePG) — **не застосовуй** до цього дерева описану трансформацію base/overlays: залиш структуру як є і переходь до наступної директорії `k8s/`.

Трансформуй директорії, щоб виділити спільне за допомогою kustomize. За основу беремо все, що в середовищі dev, і саме в такому вигляді з dev воно має стати **base**; якщо вже є base і немає dev — це нормально, рухайся далі.

У інших середовищах має бути лише `kustomization.yaml` і зміни через оверрайди.

У **base** у всіх ресурсів (окрім `base/kustomization.yaml`) має бути namespace **dev**.

Окремої директорії **dev** не має бути — за середовище dev відповідає **base**.

README має бути в директорії **k8s**.

Рядки в маніфестах у **base**, які змінюватимуться в інших середовищах, позначай коментарем на тому самому рядку: `# буде замінено через kustomize`.

Патчів лише на namespace не роби — namespace задається в `kustomization.yaml`.

Застарілі файли прибирай.

Для overlay **ua** `namespace` задавай у `kustomization.yaml` (без окремих patch лише на зміну namespace). Деталі — **n-k8s** / **abie** у `.cursor/rules/`, якщо ці правила увімкнені в проєкті.

## Виключення: CNPG `Cluster`

Ресурс **`Cluster`** оператора CloudNativePG (`postgresql.cnpg.io/v1`) має власні правила життєвого циклу та іменування; шаблон «dev → base + overlays» для нього не застосовується.

## Виключення: директорії `users/`

Директорія `users/` у кожному середовищі — **окремий шар маніфестів**, який **не входить у Kustomize**. Так зроблено навмисно: вміст часто **різний між середовищами**, тож немає сенсу виносити його в `base` чи патчити через overlays.

Правила:

- Файли з `users/` **не додавай** до жодного `kustomization.yaml` (ні `base`, ні overlay) — вони **не підключаються** до kustomize.
- Директорію `users/` **не переміщуй** у `base` — вона **залишається** в своєму середовищі (`dev`, `ua`, інше overlay тощо), поруч з `kustomization.yaml` цього середовища (або після рефакторингу — поруч з overlay, де вона була логічно прив’язана).
- У файлах у `users/` **може не бути** `metadata.namespace` — це нормально, **не нав’язуй** namespace лише заради kustomize.
- Якщо `users/` є в кількох середовищах з різним набором файлів (наприклад, 29 yaml у одному й інша кількість в іншому) — **залишай незалежними**, не намагайся уніфікувати через base.

Приклад **до** трансформації (фрагмент):

```
k8s/db/
├── dev/                         # namespace: dev
│   ├── kustomization.yaml
│   ├── cluster-db.yaml          # instances: 1, поля з # буде замінено через kustomize
│   ├── secret-auth.yaml
│   └── secret-source-db.yaml
└── ua/                          # або інше середовище
    ├── kustomization.yaml
    └── users/
        └── *.yaml               # без metadata.namespace; не в kustomization.resources
```

Приклад **після** трансформації (той самий принцип для `users/`):

```
k8s/db/
├── base/
│   ├── kustomization.yaml
│   ├── cluster-db.yaml          # namespace: dev, поля з # буде замінено через kustomize
│   ├── secret-auth.yaml
│   └── secret-source-db.yaml
└── ua/
    ├── kustomization.yaml       # namespace, patches — без users/
    └── users/                   # лишається тут; kustomize їх не бачить
        └── *.yaml
```
