# AGENTS.md

Guidance for AI agents working in this repository.

## Purpose

This file should describe durable engineering values, not technical specifications. Keep it general enough to remain useful as the codebase evolves.

## Principles

- Understand the current design before changing it. Read the surrounding code, identify existing patterns, and avoid inventing a parallel style without a strong reason.
- Prefer the smallest correct change. Solve the problem directly, preserve working behavior, and avoid broad rewrites when a focused improvement is enough.
- Keep the codebase coherent. New code should fit the existing structure, naming language, error model, and operational expectations.
- Optimize for future maintainers. Choose clear names, explicit boundaries, and simple control flow so the next person can reason about the change without reconstructing hidden assumptions.
- Treat errors as part of the design. Failures should be contained, observable, and actionable rather than surprising or silent.
- Preserve user trust. Do not introduce secrets, unnecessary data exposure, or behavior that is hard to inspect or reverse.
- Verify meaningful changes. Use the most relevant available checks for the kind of change being made, and be clear about what was and was not verified.
- Keep documentation honest. Update durable guidance when behavior, constraints, or maintenance expectations actually change; avoid duplicating details that belong in code, tests, or release notes.
- Respect existing work. Do not overwrite, revert, or reinterpret unrelated changes unless explicitly asked.
- Prefer durable quality over procedural compliance. Use judgment, explain tradeoffs when they matter, and leave the codebase healthier than you found it.
- Keep source files under 500 lines; decompose into focused sub-modules behind a barrel re-export when a file grows past that limit.
