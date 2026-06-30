---
bump: patch
section: Fixed
---

changelog/consistency: detector пропускає merge-коміти (HEAD з 2-м предком) — merge інтегрує вже задокументовану роботу, тож autofix більше не створює шумний «Merge…» changeset, який CI commit-back каскадив у зайвий patch-реліз.
