## npm/bun-гілка (`@7n/rules-lang-js`)

Екосистемна гілка JavaScript/npm/bun для taze — виконує кроки 1–8 скелета.

### Детекція і передумови

Кореневий `package.json`. Потрібні `bun` і `bunx`; чисте робоче дерево (без незакомічених змін у `package.json` / `bun.lock` / `node_modules`).

### Крок 1 — стартовий стан

```bash
cp package.json package.json.taze-bak
cp bun.lock bun.lock.taze-bak
```

(У monorepo — також усі `*/package.json` воркспейсів. Файли тимчасові, видаляються в кінці.)

### Крок 2 — оновлення

```bash
bunx taze -w -r latest
bun install
```

- `-w` — записати нові версії у `package.json`.
- `-r` — рекурсивно по всіх воркспейсах.
- `latest` — піднімати навіть major.

### Крок 3 — major-оновлення

> **Не порівнюй `package.json` вручну.** Класифікацію semver несе CLI — детерміновано, по всіх воркспейсах.

```bash
n-rules taze diff
```

Друкує компактний JSON: `{ "major": [{workspace, pkg, from, to}], "minorPatch": <N>, "totalChanged": <N> }`. `major` — залежності зі зміною найлівішої ненульової компоненти semver (`1.x→2.x`, `0.4.x→0.5.x`, `0.0.3→0.0.4`); саме вони йдуть у кроки 4–6. Покриває **прямі** залежності `package.json` (root + воркспейси); транзитивні (`bun.lock`) — за потреби окремо.

### Крок 4 — breaking changes

CHANGELOG/Releases репозиторію модуля (поле `repository` у `node_modules/<name>/package.json`); якщо неінформативно — `diff -r` між кешованою старою версією (`~/.bun/install/cache/<name>@<old-version>/`) і новою (`node_modules/<name>/`) по `dist/` / `*.d.ts` / entry-points з `exports`.

### Крок 5 — сумісність з кодом

```bash
rg -n "<імпорт|функція|опція>" --type ts --type js --type vue
```

### Крок 6 — перевірки після правок

```bash
npx @7n/rules lint
bun run typecheck   # якщо є
bun test            # якщо є
```

### Крок 7 — прибирання

```bash
rm package.json.taze-bak bun.lock.taze-bak
```

(І решту бекапів воркспейсів, якщо створювались.)

### Крок 8 — звіт

Окрема секція **npm/bun-пакети** (оновлено / major / зрефакторено / потребує ручного втручання), у **Стан перевірок** — `lint` / `typecheck` / `test`.
