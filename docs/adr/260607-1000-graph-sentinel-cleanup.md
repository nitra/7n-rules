## ADR Очищення sentinel-файлу після аварійного завершення вузла

**Status:** Accepted
**Date:** 2026-06-07

## Context and Problem Statement

`graph run` пише `running_<pid>_until_<ts>` у `tasks/<node>/` при старті worktree і видаляє його при нормальному завершенні. При аварійному завершенні процесу (`kill -9`, OOM, crash хоста) wrapper не отримує шанс виконати cleanup — sentinel залишається назавжди, вузол застряє у стані `stalled` і нова спроба запуску через `mkdir lock` не може стартувати.

## Considered Options

* Варіант A — cleanup як перший крок нового `graph run`: перевірити `kill -0 <pid>` перед стартом, якщо мертвий — прибрати sentinel і worktree
* Варіант B — PID у назві sentinel файлу (`running_<pid>_until_<ts>`), щоб `n-cursor watch` міг перевіряти живість процесу без читання вмісту
* Гібрид A+B — обидва механізми паралельно

## Decision Outcome

Chosen option: "Гібрид A+B", because PID у filename дає `n-cursor watch` та `graph run` спільний інструмент детекції через `kill -0` без читання вмісту; cleanup-on-startup гарантує відновлення навіть якщо watch тік пропустив.

### Consequences

* Good, because sentinel `stalled` з мертвим PID автоматично очищається в двох точках: при `graph run` (наступна спроба) і при `n-cursor watch` (кожні 5 хв).
* Bad, because `kill -0 <pid>` коректний лише на тому ж хості — у розподіленому сценарії (NFS worktree + декілька машин) детекція мертвих процесів потребує іншого механізму (наприклад, heartbeat-файл).

## More Information

Фінальний формат sentinel: `running_<pid>_until_<ts>` у `tasks/<node>/`.

Watch-логіка при скані:
```
якщо running_<pid>_until_<ts> існує:
  якщо ts ≤ now()  →  stalled:
    kill -0 <pid>; якщо ESRCH (мертвий) → cleanup → run_NNN.md(result: timeout-or-crash) → стан: failed
  якщо ts > now()  →  running:
    kill -0 <pid>; якщо ESRCH → cleanup → run_NNN.md(result: crash) → стан: failed
```

Cleanup-on-startup у `graph run <path>`:
```
якщо є running_<pid>_until_<ts>:
  kill -0 <pid>; якщо ESRCH → rm sentinel + worktree → продовжити старт
  якщо живий та ts > now() → EBUSY, skip (вузол справді running)
  якщо живий та ts ≤ now() → kill <pid> → cleanup → продовжити
```

Spec: `docs/думка.MD`, секція "Wrapper-скрипт" і "Watch".
