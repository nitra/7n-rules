## Python-гілка (`@7n/rules-lang-python`)

Екосистемна гілка Python/uv для taze — виконує кроки 1–8 скелета у Python-варіанті.

### Детекція і передумови

```bash
test -f pyproject.toml && echo pyproject.toml
```

v1: лише кореневий `pyproject.toml` (uv-конвенція single-project, без обходу workspace-членів, на відміну від Cargo). Потрібен установлений `uv` — без нього major-бампи неможливо застосувати детерміновано, гілка пропускається без блокування інших, а `pyproject.toml` перелічується у звіті як такий, що потребує ручного прогону.

### Крок 1 — стартовий стан

```bash
cp pyproject.toml pyproject.toml.taze-bak
cp uv.lock uv.lock.taze-bak   # якщо є
```

### Крок 2 — оновлення

```bash
for pkg in $(<список прямих залежностей із [project].dependencies>); do
  uv remove "$pkg"
  uv add "$pkg" --bounds lower
done
```

`uv` **не має** єдиної команди "підняти все до latest, навіть через major" (на відміну від `bunx taze -w -r latest`/`cargo upgrade --incompatible allow`) — підтверджено емпірично: `uv add <pkg>` на вже присутній залежності НЕ переписує specifier без попереднього `uv remove`. `--bounds lower` записує нижню межу без верхньої (`>=<latest>`), коректно зберігає `[extras]`. Провал одного пакета (мережа/резолюція) не втрачає прогрес по інших — провайдер best-effort відновлює оригінальний рядок, якщо `uv add` не вдався після `uv remove`.

### Крок 3 — major-оновлення

`collectUvDiff` (taze-провайдер плагіна) робить класифікацію детерміновано: парсить `pyproject.toml.taze-bak`/`pyproject.toml` через `smol-toml`, порівнює `[project].dependencies` (масив PEP 508-рядків, матчинг за іменем пакета — не за позицією), дістає нижню межу PEP 440-специфікатора і класифікує за правилом caret-семантики. Ручний прогін поза оркестратором — той самий принцип: `diff pyproject.toml.taze-bak pyproject.toml` по записах `[project].dependencies`.

### Крок 4 — breaking changes

Адресу репозиторію взяти зі сторінки `https://pypi.org/project/<name>/` (поле "Homepage"/"Source"); CHANGELOG зазвичай у `CHANGELOG.md`/`HISTORY.md` репозиторію або в GitHub Releases. Якщо немає — різниця по публічному API між закешованою старою версією (`~/.cache/uv/`) і новою (`.venv/lib/python*/site-packages/<name>/`).

### Крок 5 — сумісність з кодом

```bash
rg -n "<імпорт|функція|клас>" --type py
```

Та сама класифікація сумісно/несумісно, що й у npm-гілці.

### Крок 6 — перевірки після правок

Залежно від того, що реально налаштовано в проєкті:

```bash
ruff check .
mypy .
pytest
```

### Крок 7 — прибирання

```bash
rm pyproject.toml.taze-bak uv.lock.taze-bak
```

### Крок 8 — звіт

Окрема секція **Python-пакети (uv)** (оновлено / major / зрефакторено / потребує ручного втручання), у **Стан перевірок** — окремо `ruff` / `mypy` / `pytest`.

### Примітка

`uv add <pkg>` на вже присутній залежності — no-op (specifier НЕ переписується); детерміновану гілку це не блокує (провайдер робить `uv remove` спершу), але при ручному прогоні кроків 2–8 легко про це забути.
