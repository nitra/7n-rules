---
type: ADR
title: "K8s `$schema` Modeline: опційна для невідомих kind, `file:` — заборонений fallback"
---

# K8s `$schema` Modeline: опційна для невідомих kind, `file:` — заборонений fallback

**Status:** Accepted
**Date:** 2026-05-11

## Контекст

Механізм авто-виправлення у `check-k8s.mjs` додавав рядок `# yaml-language-server: $schema=file:.` до K8s YAML-файлів, для яких не існує публічної JSON-схеми. Такий fallback не давав жодної реальної валідації й вводив в оману редактор і розробника.

## Рішення/Процедура/Факт

Логіку перевірки першого рядка у `check-k8s.mjs` змінено: modeline `# yaml-language-server: $schema=…` є обов'язковою лише для тих `apiVersion`/`kind`, для яких існує надійний публічний URL (kustomization, yannh/kubernetes-json-schema, datree CRDs-catalog тощо). Якщо URL не знайдено — файл без modeline вважається коректним (pass, не fail). Будь-яке значення `$schema=file:…` тепер є помилкою незалежно від шляху. Правило `k8s.mdc` оновлено пунктом «Немає надійного публічного URL — не вигадуй URL і не використовуй `$schema=file:…`». Версію пакету піднято до `1.9.2`, changelog оновлено.

## Обґрунтування

`file:` заглушка не валідує маніфест, але створює хибне відчуття покриття схемою. Відсутня modeline краща за непрацюючу. Валідацію без modeline забезпечує `lint-k8s` (kubeconform з `--ignore-missing-schemas`), тому відсутність modeline не означає відсутність перевірки.

## Розглянуті альтернативи

- Залишити поточну поведінку з `file:.` — відхилено, бо не дає жодної практичної користі і дезорієнтує розробника.
- Генерація локальних схем (CRD → JSON Schema) — не обговорювалася.

## Зачіпає

`npm/scripts/check-k8s.mjs`, `npm/mdc/k8s.mdc`, `npm/package.json`, `npm/CHANGELOG.md`
