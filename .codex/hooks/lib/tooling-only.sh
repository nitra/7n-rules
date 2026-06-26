#!/usr/bin/env bash
# Спільний helper для ADR Stop-hook'ів: розпізнавання "tooling-only" сесій.
# Source'ається з capture-decisions.sh і normalize-decisions.sh — функції стають
# видимими caller'у, який успадковує `set` опції.
# Bash 3.2 (macOS /bin/bash) сумісний: без mapfile, без асоц. масивів,
# без process substitution.

# Структурний скіп ADR-генерації для "tooling-only" сесій.
# Вхід: рядки-шляхи у stdin (один шлях на лінію), відносні до $PROJECT_ROOT
# або абсолютні з префіксом $PROJECT_ROOT (нормалізуємо тут).
# Вихід: 0 — усі шляхи в allowlist; 1 — є хоч один змістовний шлях.
is_tooling_only_change() {
  local proj="$1"
  local had_file=0
  local f rel
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    had_file=1
    case "$f" in
      "$proj"/*) rel="${f#"$proj"/}" ;;
      /*) return 1 ;;
      *)  rel="$f" ;;
    esac
    case "$rel" in
      .cspell.json) ;;
      docs/adr/*.md) ;;
      AGENTS.md|CLAUDE.md) ;;
      CHANGELOG.md) ;;
      */CHANGELOG.md) ;;
      package.json|*/package.json)
        if ! git_diff_only_version_field "$proj" "$rel"; then
          return 1
        fi
        ;;
      *) return 1 ;;
    esac
  done
  [ "$had_file" = "1" ] && return 0
  return 1
}

# Cross-project guard: чи серед змінених файлів є хоч один під $proj.
# Вхід: рядки-шляхи у stdin (абсолютні file_path із tool_use).
# Вихід: 0 — є хоч один файл під $proj; 1 — жодного (сесія цілком в інших проєктах).
# Призначення: відсікти ADR-чернетки від паралельної роботи в чужих репозиторіях.
has_in_project_change() {
  local proj="$1"
  local f
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in
      "$proj"/*) return 0 ;;
    esac
  done
  return 1
}

# Допоміжна: чи git-diff для файлу торкається ЛИШЕ рядків з `"version":`.
# Поза git-репо або при помилці — вертаємо 1 (не tooling).
git_diff_only_version_field() {
  local proj="$1" path="$2"
  [ -d "$proj/.git" ] || return 1
  local diff
  diff=$(cd "$proj" && git diff HEAD --unified=0 -- "$path" 2>/dev/null) || return 1
  [ -z "$diff" ] && return 1
  local line
  while IFS= read -r line; do
    case "$line" in
      '+++ '*|'--- '*|'@@ '*|'') continue ;;
      [+-]*'"version":'*) continue ;;
      [+-]*) return 1 ;;
    esac
  done <<EOF
$diff
EOF
  return 0
}
