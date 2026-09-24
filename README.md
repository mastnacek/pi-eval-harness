# pi-eval-harness

Evaluation, motivation, and self-compacting context harness for Pi coding agent (`@earendil-works/pi-coding-agent`).

## Features (Planned & In-Progress)

1. **Self-Compaction (`self_compact`)**:
   - Explicit agent self-awareness and control over its own context window.
   - Structured `note_to_self` handoff between compaction cycles.
   - 3-tier threshold system: Soft notice, stern warning, and hard tool cutoff before token price doublings.
   - Optional human confirmation in interactive sessions.
2. **Evaluation & Motivation Harness**:
   - In-context "How You're Graded" rubrics & Instant Failure rules (RLHF alignment).
   - Session evaluation and scoring via human reviewer or judge agent.
