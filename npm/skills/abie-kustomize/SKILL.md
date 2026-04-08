---
name: n-abie-kustomize
description: >-
  Трансформація дерев k8s у структуру Kustomize (base + overlays): dev → base, без окремої dev/
version: '1.0'
---

Трансформуй директорії, щоб виділити спільне за допомогою kustomize. За основу беремо все, що в середовищі dev, і саме в такому вигляді з dev воно має стати **base**; якщо вже є base і немає dev — це нормально, рухайся далі.

У інших середовищах має бути лише `kustomization.yaml` і зміни через оверрайди.

У **base** у всіх ресурсів (окрім `base/kustomization.yaml`) має бути namespace **dev**.

Окремої директорії **dev** не має бути — за середовище dev відповідає **base**.

README має бути в директорії **k8s**.

Рядки в маніфестах у **base**, які змінюватимуться в інших середовищах, позначай коментарем на тому самому рядку: `# буде замінено через kustomize`.

Патчів лише на namespace не роби — namespace задається в `kustomization.yaml`.

Застарілі файли прибирай.

У всіх Deployment має бути `imagePullPolicy: Always`.

Для overlays **ru** та **ua** `namespace` задавай у `kustomization.yaml` (без окремих patch лише на зміну namespace). Деталі — **n-k8s** / **abie** у `.cursor/rules/`, якщо ці правила увімкнені в проєкті.
