---
name: implement-spec
description: "Implement the result of /to-spec and /to-tickets in code."
disable-model-invocation: true
---

You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

The issue tracker should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`.

The goal is the entire spec implemented on a single **integration branch**, with every ticket resolved the way the issue tracker closes work.

The tickets are not a list of steps. They are a **task graph** with blocking relationships between them. This means there is always a **frontier** of tickets which are ready to be grabbed.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers**: to the spec, tickets, research notes, and previous commits. Don't duplicate information already available via pointers.

**Implementer subagents** should be run in the background where possible for maximum concurrency.

## Steps

1. Read the spec and tickets to understand the task graph.

2. (optional) Use an **exploration subagent** to conduct any exploration required by the tickets - relevant codebase files or external documentation. Ensure the exploration subagent can save files - it should save its markdown notes in a directory outside the repo, accessible by all future subagents. This lets **implementer subagents** focus on implementation rather than exploration.

3. Create the integration branch. Record its full starting commit SHA before implementation and keep it as the anchor for the final `agent-review`. If the issue tracker closes work through PRs, or the user asks for one, open a draft PR after the first merge in step 5 (a branch with no commits ahead of main can't open one), marked as closing the spec and tickets.

4. Use **implementer subagents** to implement each ticket, each in its own worktree on its own branch. Each implementer subagent:
   - confirms its worktree is based on the integration branch before starting, and resets onto it if not;
   - records its full starting commit SHA in the ticket or task before the first change, then calls the Skill tool with `tdd` to build the ticket;
   - merges the integration branch tip into its own branch before reporting done

5. Once an **implementer subagent** completes, merge its work to the integration branch with a **merger subagent**.

6. If the merge completes the **foundation**, hold the frontier and run an **interim review** first. The foundation is the set of tickets most of the remaining graph is blocked by: typically the first slices of a first version, which fix the data model, the core interfaces and the conventions every later ticket copies. Call the global `agent-review` as Structured Review with the recorded integration-branch anchor, the current integration-branch tip as end state, and the spec, scoped to the foundation tickets. Fix the substantiated findings in a single **implementer subagent** and merge them before any ticket that builds on the foundation starts. Errors found here are fixed once; found at the end, they are fixed in every ticket that copied them.

7. If this changes the **frontier** of available tickets, kick off more **implementer subagents** to work on the new tickets. This allows for maximum concurrency.

8. Once all tickets are complete, call the global `agent-review` skill on the integration branch. Use Structured Review and pass the recorded integration-branch anchor, the fixed review end state, and the spec. It reviews conformance and code logic in separate subagents; for a first version or a large scope it adds the extra reviewers its own rules define. Fix the substantiated findings in a single **implementer subagent**.

9. If a draft PR exists, mark it ready for review. Otherwise, resolve each ticket the way the issue tracker closes work, and report the integration branch.

10. Clean up all **implementer subagent** worktrees.
