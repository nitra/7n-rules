## PHP-гілка (`@7n/rules-lang-php`)

Екосистемна гілка PHP/Composer для taze — виконує кроки 1–8 скелета у PHP-варіанті.

### Детекція і передумови

```bash
test -f composer.json && echo composer.json
```

v1: лише кореневий `composer.json` (той самий root-only автодетект, що й `php.mdc` — без обходу вкладених workspaces). Потрібен установлений `composer` — без нього major-бампи неможливо застосувати детерміновано, гілка пропускається без блокування інших, а `composer.json` перелічується у звіті як такий, що потребує ручного прогону.

### Крок 1 — стартовий стан

```bash
cp composer.json composer.json.taze-bak
cp composer.lock composer.lock.taze-bak   # якщо є
```

### Крок 2 — оновлення

```bash
for pkg in $(<список прямих залежностей із require>); do
  composer require "$pkg" --with-all-dependencies --no-interaction
done
for pkg in $(<список прямих залежностей із require-dev>); do
  composer require --dev "$pkg" --with-all-dependencies --no-interaction
done
```

Composer, як і `uv`, **не має** єдиної команди "підняти все до latest, навіть через major": `composer update` (навіть із `--with-all-dependencies`) лишається в межах ІСНУЮЧОГО constraint-у в composer.json — `^7.4` ніколи не перескочить на `8.x` через `update`, це офіційно задокументована поведінка Composer, на відміну від `bunx taze -w -r latest`/`cargo upgrade --incompatible allow`. `composer require <pkg>` без версії, навіть коли пакет уже присутній, змушує Composer заново резолвити НАЙНОВІШУ версію, що задовольняє stability-налаштування, і переписати constraint у composer.json — паралель до `uv remove`+`uv add`, але без проміжного `remove`-кроку (сам `require` перезаписує constraint атомарно; якщо резолюція/встановлення провалиться, Composer не лишає composer.json у частково зміненому стані). Платформні псевдо-пакети (`php`, `ext-*`, `lib-*`, `composer-plugin-api`, `composer-runtime-api`) — без окремого дерева версій, виключені з циклу.

### Крок 3 — major-оновлення

`collectComposerDiff` (taze-провайдер плагіна) робить класифікацію детерміновано: парсить `composer.json.taze-bak`/`composer.json` як JSON, порівнює `require`/`require-dev` (матчинг за ключем-іменем пакета), бере ліву числову гілку constraint-у (`^`/`~`/`>=`/wildcard `.*`/OR-набір `||` — мінімально достатній розбір, не повний Composer-парсер) і класифікує за правилом caret-семантики. Ручний прогін поза оркестратором — той самий принцип: `diff composer.json.taze-bak composer.json` по записах `require`/`require-dev`.

### Крок 4 — breaking changes

Адресу репозиторію взяти зі сторінки `https://packagist.org/packages/<vendor>/<package>` (поле "Homepage"/"Repository"); CHANGELOG зазвичай у `CHANGELOG.md`/GitHub Releases репозиторію. Якщо немає — різниця по публічному API між закешованою старою версією (`~/.composer/cache/`) і новою (`vendor/<vendor>/<package>/`).

### Крок 5 — сумісність з кодом

```bash
rg -n "<use-шлях|функція|клас>" --type php
```

Та сама класифікація сумісно/несумісно, що й у інших гілках.

### Крок 6 — перевірки після правок

Залежно від того, що реально налаштовано в проєкті:

```bash
vendor/bin/phpcs
vendor/bin/phpstan analyse
vendor/bin/psalm
vendor/bin/phpunit
```

### Крок 7 — прибирання

```bash
rm composer.json.taze-bak composer.lock.taze-bak
```

### Крок 8 — звіт

Окрема секція **PHP-пакети (Composer)** (оновлено / major / зрефакторено / потребує ручного втручання), у **Стан перевірок** — окремо `phpcs` / `phpstan` / `psalm` / phpunit.

### Примітка

`composer require <pkg>` без явної версії — детермінована, ідемпотентна операція (щоразу резолвить найновішу дозволену версію), тому повторний прогін гілки без змін у коді не шкодить; але саме тому диференціювати "нічого не змінилось" від "оновлення до тієї самої останньої версії" можна лише за constraint-рядком у composer.json до/після (`collectComposerDiff` порівнює саме рядки, не резолвлені версії з lock-файлу).
