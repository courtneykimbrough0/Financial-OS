# GEMINI.md — instructions for Gemini (including Google AI Studio)

Before doing any work in this repository, read AGENTS.md in full. It is the canonical source of shared project rules. Then read BUILD_AND_TEST_ROADMAP.md and the relevant project documentation. Inspect the current implementation, follow the roadmap, make only the specifically authorized change, add tests alongside the implementation, and report only checks actually run. Do not treat testing phases as feature boundaries. Do not add direct bank aggregation integrations.

**This file is not the complete instructions.** [AGENTS.md](AGENTS.md) is. If this file and AGENTS.md ever differ, AGENTS.md wins.

In practice:

1. Read [AGENTS.md](AGENTS.md), then [BUILD_AND_TEST_ROADMAP.md](BUILD_AND_TEST_ROADMAP.md), then the relevant docs: [README.md](README.md), [DESIGN.md](DESIGN.md), [security_spec.md](security_spec.md), [AI_STUDIO_TASKS.md](AI_STUDIO_TASKS.md).
2. Inspect the current code; don't rely on earlier descriptions without checking.
3. Make only the change the product owner authorized, with its tests in the same change.
4. Run the checks in AGENTS.md section H and report real results in the format of section I.
5. Stop and wait for the next instruction instead of continuing to later roadmap steps.

Do not add Plaid or any other direct bank-aggregation integration.

For AI Studio specifically: pull the latest from GitHub (branch `ccr-12ec4965-6tzwgr`) before changing anything, push your commits there when done, and keep the Firebase and Cloud Run setup steps in [AI_STUDIO_TASKS.md](AI_STUDIO_TASKS.md) up to date.
