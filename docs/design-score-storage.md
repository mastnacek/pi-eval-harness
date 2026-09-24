# Score Storage Design — Global vs Per-Project

## What the notebook says (Indie Dev Dan, "Self-optimizing agents")

- **Per-project isolation, no global DB.** Each run writes into the project
  (`specs/<agent>/`, `apps/<agent>/`); grading happens by inspecting those
  artifacts plus terminal stats (time, tokens, failures).
- **No cross-project score history** is kept in the source material.
- **"How You're Graded" is injected in the prompt** and is short: continuous
  score over DoD bullets, instant-failure rules, allowed-actions list.

## Our conclusion: two-layer split (both, different roles)

| Layer | Location | Content | Feeds |
|---|---|---|---|
| **Raw verdicts (ledger)** | `~/.pi/agent/eval-harness/scores.jsonl` (GLOBAL, append-only, one JSON line per run) | full verdict: timestamp, project, rubric, score/max, failed criteria, instant-failure ids | `/eval card`, trend computation, cross-project comparison |
| **Working rubric** | `.pi/eval-harness/RUBRIC.md` (PER-PROJECT) | criteria + instant failures for this repo | gate runs, prompt injection |

Rationale: the ledger must be global because motivation comes from *history*
("you did better last week"), but the rules that define *good work* differ per
project, so the rubric stays local. Notebook agrees: rules per project, but his
comparison table (time/tokens/failures) is effectively the global layer.

## Prompt injection: keep it tiny (context economy)

The model does NOT see raw scores, ledgers, or per-criterion breakdowns. It
sees a compact generated summary block, rebuilt from the global ledger at
`session_start`:

```
[eval-harness · You Are Monitored]
Your work is graded by a deterministic gate after every session (0–100).
The gate, not you, decides when work is done.
Your record (last N sessions, all projects): 82/100 avg — trend ↑.
Praised for: KISS/simple solutions; short comments explaining WHY.
Penalized for: runtime errors; overengineered code; claiming tests pass
without running them. Instant-failure rules void the whole run.
```

Rules:
- ≤ 6 lines, no numbers per criterion, no rubric JSON in context.
- Trend arrow (↑ → ↓) computed from ledger (last 5 vs previous 5).
- "Praised for / Penalized for" lists are generated from which criteria
  actually failed/won most often in the ledger, not hardcoded prose.

## Metric taxonomy (default rubric weights)

| Signal | Type | Weight |
|---|---|---|
| Functional KISS (no overengineering) | positive criterion | 20 |
| Concise comments explaining WHY | positive criterion | 20 |
| No runtime errors / verification passes | positive criterion | 40 |
| Overly complex code (layer/abstraction count) | negative (instant-fail only if severe) | — |
| Claiming done without verification | negative | instant fail |

## Data flow

1. `session_start` → read ledger → build 6-line summary → inject into system
   prompt (transient, never persisted into transcript).
2. Session runs → `tool_result` hook captures evidence silently.
3. `/eval run` (or `agent_end` auto-run) → gate verifies → verdict appended to
   global ledger → per-project rubric unchanged.
4. Next `session_start` → summary now reflects the new verdict → model sees its
   updated record. Loop closes.
