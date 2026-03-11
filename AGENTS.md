# AGENTS.md

These instructions capture the preferred working style for this repository.
They are workflow preferences for contributors and coding agents. If they ever
conflict with system, developer, or direct user instructions, those higher
priority instructions win.

## 1. Plan First for Non-Trivial Work

- Enter planning mode for any non-trivial task:
  - 3 or more implementation steps
  - architectural decisions
  - migrations, integrations, or behavior changes across multiple modules
- If something goes sideways, stop and re-plan instead of pushing through with a broken approach.
- Use planning for verification too, not only for implementation.
- Write a concrete spec up front to reduce ambiguity.

## 2. Use Focused Parallelism

- Keep the main context clean by splitting research, exploration, and parallel analysis into focused tracks when possible.
- For complex problems, use more parallel investigation instead of overloading one execution path.
- Keep one task per parallel work item so results stay easy to evaluate.

## 3. Self-Improvement Loop

- After any correction from the user, capture the lesson in `tasks/lessons.md`.
- Write rules that prevent the same mistake from recurring.
- Refine those lessons until the same class of mistake stops repeating.
- Review relevant lessons at session start for this project.

## 4. Verify Before Calling Work Done

- Never mark a task complete without proving it works.
- Compare behavior between `main` and the current changes when that comparison matters.
- Ask: "Would a staff engineer approve this?"
- Run tests, inspect logs, and demonstrate correctness.

## 5. Demand Elegance, But Stay Practical

- For non-trivial changes, pause and ask whether there is a more elegant solution.
- If the current fix feels hacky, reframe the problem and implement the cleaner solution.
- Do not over-engineer simple or obvious fixes.
- Challenge your own solution before presenting it.

## 6. Autonomous Bug Fixing

- When given a bug report, fix it directly.
- Start from logs, errors, failing tests, and concrete symptoms.
- Minimize back-and-forth and unnecessary context switching for the user.
- If CI or tests are failing, investigate and resolve them without waiting for extra prompting.

## Task Management

1. **Plan First**: write the task plan to `tasks/todo.md` with checkable items.
2. **Verify Plan**: check in before implementation starts.
3. **Track Progress**: mark items complete as you go.
4. **Explain Changes**: provide a high-level summary at each major step.
5. **Document Results**: add a review/results section to `tasks/todo.md`.
6. **Capture Lessons**: update `tasks/lessons.md` after corrections.

If `tasks/todo.md` or `tasks/lessons.md` do not exist yet, create them when the task warrants it.

## Core Principles

- **Simplicity First**: make every change as simple as possible and keep impact minimal.
- **No Laziness**: find root causes, avoid temporary fixes, and hold the work to senior-engineer standards.
