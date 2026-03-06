# MiniMart Multi-Surface Architecture

> **Status:** Design converged — ready for implementation planning
> **Author:** Opus (repo PM / systems architect)
> **Date:** 2026-03-05
> **Reviewers:** User, ChatGPT 5-4 (brainstorm + red team), Codex GPT 5-4 (repo-aware review)
> **Scope:** MiniMart overhaul — role-specific MCP surfaces + IP/PH project tracking

---

## 1. Executive Summary

MiniMart today exposes 64 tools on a single surface (port 6974), with a scoped Express instance (6975) for Ollama workers. Every agent — ops, dev, local AI — sees the same 64-tool menu. This works but creates two problems:

1. **Tool overload for dev agents.** A Sonnet session implementing a feature doesn't need `deploy`, `rollback`, `pm2_restart`, `mantis_toggle_rule`, or `batch_archive`. These tools are noise that burns context and invites misuse.

2. **No project-level tracking.** Large multi-phase work (like this overhaul) lives in ad-hoc markdown specs and tribal knowledge. The current TK/PA system tracks issues and improvements, but not planned implementation work. Opus writes big plans, Sonnet executes them in phases, and the only tracking is "did the PA get filed and closed?"

The fix: split MiniMart into three role-specific surfaces sharing one codebase and one truth store, and add a first-class IP/PH (Implementation Plan / Phase) object model for project-level work.

**The three surfaces:**

| Surface | Port | Role | Trust Level |
|---------|------|------|-------------|
| **MiniMart** | 6974 | Ops control plane — deploy, verify, archive, MANTIS | Highest (server authority) |
| **MiniMart Express** | 6975 | Ollama worker lane — read-only + OC CRUD | Constrained (local AI) |
| **MiniMart Electronics** | 6976 | Dev/build store — queue, claim, implement, plan, review | High (dev rig agents) |

**The new object model:**

| Object | Prefix | Purpose |
|--------|--------|---------|
| **IP** | `IP_{service}_{NNN}` | Implementation Plan — architect-written, tracks a major feature/overhaul |
| **PH** | `PH_{ip}_{NN}` | Phase — progress tracker inside an IP, executed by Sonnet |
| **TK** | `TK-NNN` | Ticket — something is broken (unchanged) |
| **PA** | `PA-NNN` | Patch — suggested improvement (unchanged) |
| **OC** | `OC-NNN` | Ollama Churn — AI worker job (unchanged) |

---

## 2. Proposed Architecture

```
                           +-----------------------+
                           |   Shared Truth Store   |
                           |   (filesystem on mini) |
                           |                        |
                           |  tickets/index.json    |
                           |  patches/index.json    |
                           |  plans/index.json (NEW)|
                           |  tasks/index.json (OC) |
                           |  *.jsonl archives      |
                           +-----------+-----------+
                                       |
                    +------------------+------------------+
                    |                  |                  |
          +---------+-------+ +-------+--------+ +------+---------+
          | MiniMart (6974) | | Express (6975) | | Electronics    |
          | Ops / Authority | | Ollama Worker  | | (6976)         |
          |                 | |                | | Dev / Build    |
          | OPS ALLOWLIST   | | EXPRESS ALLOW  | | ELEC ALLOWLIST |
          |                 | |                | |                |
          | - deploy/roll   | | - ollama_gen   | | - IP/PH CRUD   |
          | - verify/archive| | - OC CRUD      | | - queue/claim   |
          | - MANTIS proxy  | | - read-only    | | - source read   |
          | - PM2 control   | | - file_read/wr | | - git read      |
          | - health/disk   | |   (ollama wksp)| | - handoff       |
          | - TK/PA full    | |                | | - TK/PA limited |
          | - training exp  | |                | | - create_patch  |
          | - verify_plan   | |                | | - review support|
          +-----------------+ +----------------+ +----------------+
                    |                  |                  |
              Mini agents        OC Orchestrator     Dev rig agents
              (deploy/verify)    (MANTIS daemon)     (Opus/Sonnet)
```

**Key architectural decisions:**

1. **One codebase, three entry points.** Electronics is a third `index-electronics.ts` alongside `index.ts` and `index-express.ts`. Same `createServer()` with a different allowlist.

2. **All three surfaces have explicit allowlists.** MiniMart (6974) gets its own `MINIMART_ALLOWED_SET` — no more implicit "everything." Every surface declares what it exposes.

3. **IP/PH lives in its own index.** `plans/index.json` — separate from tickets/patches. Clean separation of the project lane from the issue lane.

4. **Transition guards live in `ServerConfig`.** The server factory accepts a `transitionGuards` config that enforces which status transitions are allowed per surface. Tool modules remain surface-agnostic.

5. **Electronics binds to `0.0.0.0:6976`** (not localhost) because dev rig agents connect via SSH tunnel. MiniMart (6974) also binds `0.0.0.0`. Express (6975) stays on `127.0.0.1`.

---

## 3. Surface-by-Surface Responsibility Split

### 3.1 MiniMart (6974) — Ops Control Plane

**Who uses it:** Mini-side agents, Opus (via tunnel) for oversight.

**Has its own explicit allowlist** — `MINIMART_ALLOWED_SET` in `minimart-allowlist.ts`. Even though it's the largest surface, the declaration makes the contract visible.

**Owns:**
- Full TK/PA lifecycle: create, update, status transitions, archive, assign
- Deploy / rollback / PM2 restart
- MANTIS proxy (events, rules, runner, health)
- Service health, disk, backup monitoring
- IP **verify + archive** via `verify_plan` — mini verifies the whole IP and archives it
- IP/PH **read access** (view, list)
- OC oversight (list, view, archive)
- Training data export
- Server overview, quick_status
- Memory read/write (set_context, get_context)
- Wrappers (ops scripts)
- Network quality
- Cron management
- Ollama helpers (ollama_summarize_logs, ollama_digest_service)
- batch_archive, batch_ticket_status

**Does NOT own:**
- IP/PH creation or phase execution (Electronics)
- Direct Ollama inference (Express)

### 3.2 MiniMart Express (6975) — Ollama Worker Lane

**No changes from current design.** The 30-tool allowlist is already well-scoped.

**One addition:** Express gets read-only `list_plans` and `view_plan` so Ollama workers can see active IPs when doing `code_review` or `gap_detect` tasks.

### 3.3 MiniMart Electronics (6976) — Dev/Build Store

**Who uses it:** Dev rig agents (Opus, Sonnet, Codex) via SSH tunnel.

**Owns:**
- **IP/PH full lifecycle** (except verify/archive):
  - `create_plan` — create an IP with all phases defined
  - `view_plan` — view IP + all phases, or a specific phase
  - `list_plans` — list IPs by status/service
  - `claim_plan` — Sonnet claims the IP for execution
  - `update_phase` — mark a phase done, add notes/commits
  - `complete_plan` — IP → `implemented` (requires handoff)
  - `review_plan` — Opus → `reviewed` (records docs updated)
- **Queue + claiming:**
  - `my_queue`, `peek`, `pick_up` (for TK/PA)
- **TK/PA read + limited write:**
  - `list_tickets`, `view_ticket`, `search_tickets` — read
  - `list_patches`, `view_patch`, `search_patches` — read
  - `update_ticket`, `update_patch` — add evidence/notes/commits
  - `update_ticket_status` — guarded: only `open → in-progress`, `in-progress → patched`
  - `update_patch_status` — guarded: only `open → in-review`, `in-review → applied`
  - `create_patch` — **yes**, with structural anti-self-cert (see section 7.3)
  - No `create_ticket` — dev agents don't declare incidents
  - No `archive_ticket`, `archive_patch` — mini's job
- **Source + git:** `read_source_file`, `git_log`, `git_diff`, `git_status`
- **Context + guides:** `get_project_info`, `get_ticketing_guide`, `get_checklist`, `service_registry`
- **Review:** `log_review`
- **Tags:** `lookup_tags`, `validate_failure_class`

**Status transition guardrails:**

Electronics enforces restricted transitions via `transitionGuards` in `ServerConfig`:

| Object | Allowed Transitions (Electronics) |
|--------|-----------------------------------|
| TK | `open → in-progress`, `in-progress → patched` |
| PA | `open → in-review`, `in-review → applied` |

Any other transition returns: `"This transition requires MiniMart (ops authority)."`

**Claiming triggers the initial status transition.** `pick_up` on Electronics auto-transitions based on current status:
- TK in `open` → claim + set `in-progress`
- PA in `open` → claim + set `in-review`
- Already `in-progress`/`in-review` → just claim (re-assignment case)

This eliminates the need for a separate `update_ticket_status` call after claiming. One call = claim + transition. The tool implementations in `tickets.ts` and `patches.ts` must support `in-progress` and `in-review` as valid statuses (currently they exist in the type definitions but may not be fully handled in transition logic).

---

## 4. IP/PH Object Model

### 4.1 Naming Convention

**IP:** `IP_{service}_{NNN}` — e.g., `IP_minimart_001`, `IP_mantis_003`, `IP_cross_002`

**PH:** `PH_{ip}_{NN}` — e.g., `PH_minimart_001_01`, `PH_minimart_001_02`

PH naming includes the parent IP for standalone reference in handoff notes, commit messages, and cross-referencing. You can say "work on PH_minimart_001_02" without needing additional context.

### 4.2 IP (Implementation Plan) Entry

```typescript
interface IpEntry {
  // Identity
  service: string;              // target service, or "cross" for multi-service
  summary: string;              // one-line description
  description: string;          // full plan description
  why_now?: string;             // rationale for timing

  // Lifecycle — 5 states
  status: "open" | "claimed" | "implemented" | "reviewed" | "verified";
  created: string;              // YYYY-MM-DD
  created_by: string;           // "opus", "user"

  // Execution
  claimed_by?: string;          // Sonnet worker identity
  claimed_at?: string;          // ISO timestamp
  implemented_at?: string;      // when all phases done
  reviewed_by?: string;         // Opus
  reviewed_at?: string;
  verified_by?: string;         // Mini
  verified_at?: string;

  // Structure
  phases: Record<string, PhEntry>;  // "01" → PhEntry, "02" → PhEntry
  phase_order: string[];        // ["01", "02", "03"] — execution order

  // Handoff (populated on complete_plan)
  handoff?: IpHandoff;

  // Review (populated on review_plan)
  review?: IpReview;

  // Verification (populated on verify_plan)
  verification?: IpVerification;

  // Relationships
  related_pa?: string[];        // PA IDs filed as follow-ups
  related_tk?: string[];        // TK IDs filed as follow-ups
  spec_path?: string;           // path to design doc (e.g., "docs_archived/SPEC.md")

  // Metadata
  tags: string[];
  assigned_to?: string;         // team queue
  updated_at?: string;
}

// New field on TicketEntry and PatchEntry (not IP — IP uses related_pa/related_tk)
// context_links: string[]  — cross-lane references like "IP_minimart_001"
// Separate from `related` which is TK/PA-only and used by archive lookup

```

### 4.3 PH (Phase) Entry

Phases are progress trackers inside an IP. They have 3 states, not their own full lifecycle. Review and verification happen at the IP level.

```typescript
interface PhEntry {
  // Identity (phase number is the key in parent IP's phases map)
  summary: string;              // what this phase does
  description?: string;         // detailed instructions for implementing agent

  // Lifecycle — 3 states
  status: "pending" | "in_progress" | "done";

  // Dependencies
  depends_on?: string[];        // other phase numbers that must complete first

  // Execution tracking
  started_at?: string;
  completed_at?: string;
  commits?: string[];           // commit hashes produced
  files_changed?: string[];     // key files touched
  notes?: string;               // what was actually done
}
```

### 4.4 Handoff Contract — `what_mini_should_verify`

Populated on `complete_plan`. **Required** before IP can transition to `implemented`.

```typescript
interface IpHandoff {
  // What changed
  changes_summary: string;
  commits: string[];
  services_affected: string[];

  // What to verify
  verify_checklist: string[];
  // Example:
  // - "PM2 process 'minimart_electronics' starts and stays online"
  // - "Port 6976 responds to POST /mcp"

  // Expected behavior
  expected_visible: string[];
  expected_non_visible: string[];

  // Risk
  risk_notes?: string;

  // Non-goals
  not_in_scope?: string[];

  // Docs
  docs_updated?: string[];
  docs_to_update?: string[];    // for Opus to handle in review step
}
```

**Enforcement:** `complete_plan` validates:
1. `handoff` exists
2. `changes_summary` is non-empty
3. `commits` has at least one entry
4. `services_affected` is non-empty
5. `verify_checklist` has at least one item
6. `expected_visible` has at least one item

Rejection message: `"Cannot complete plan: handoff.verify_checklist is required — tell mini what to verify."`

### 4.5 Review Record

Populated by Opus on `review_plan`. Records which of the 4 canonical docs were updated.

```typescript
interface IpReview {
  reviewed_by: string;
  reviewed_at: string;
  review_notes?: string;

  // Canonical doc sync — concrete targets, not vague booleans
  docs_synced: {
    agents_md: boolean;
    readme_md: boolean;
    code_review_checklist: boolean;
    code_audit_checklist: boolean;
  };

  // Additional docs updated beyond the canonical 4
  additional_docs?: string[];
}
```

### 4.6 Verification Record

Populated by mini on `verify_plan`. Archives the IP + all phases.

```typescript
interface IpVerification {
  verified_by: string;
  verified_at: string;
  deployed: boolean;
  deploy_method?: string;

  checklist_results: Array<{
    item: string;
    passed: boolean;
    notes?: string;
  }>;

  health_check: string;
  outcome: "verified" | "failed" | "partial";
  failure_notes?: string;

  // Follow-ups filed as result of verification
  follow_up_tk?: string[];
  follow_up_pa?: string[];
}
```

### 4.7 IP Index

```typescript
interface IpIndex {
  next_id: Record<string, number>;  // per-service: { "minimart": 2, "mantis": 4 }
  plans: Record<string, IpEntry>;   // "IP_minimart_001" → IpEntry
}
```

**Storage:** `agent/workspace/plans/index.json`
**Archive:** `agent/workspace/plans/archive.jsonl` — phase-level rows for training data.

---

## 5. Lifecycle / State Machine Design

### 5.1 IP Lifecycle — 5 States

```
open → claimed → implemented → reviewed → verified
```

| Transition | Who | Surface | What Happens |
|-----------|-----|---------|--------------|
| `open → claimed` | Sonnet | Electronics | `claim_plan` — atomic claim |
| `claimed → implemented` | Sonnet | Electronics | `complete_plan` — requires handoff |
| `implemented → reviewed` | Opus | Electronics | `review_plan` — records docs synced |
| `reviewed → verified` | Mini | MiniMart | `verify_plan` — deploys, verifies, archives IP + all phases |

**No draft state.** By the time an IP enters the system, the plan is already approved through the brainstorm → Opus refinement process. This matches TK/PA which start `open`, not `pending`.

**IP is not a queue item.** Unlike TK/PA, IPs don't sit in a backlog waiting for someone to claim them. The workflow is: user brings a brainstormed plan → Opus refines it → `create_plan` → Sonnet starts immediately. IP creation and claiming typically happen in the same conversation flow. `my_queue`, `peek`, and `pick_up` remain TK/PA-only — they don't need IP awareness. Agents working an IP use `view_plan` to check state, not `my_queue`.

### 5.2 PH Lifecycle — 3 States

```
pending → in_progress → done
```

Phases are progress trackers during implementation. They don't independently go through review/verified/archived — the IP does that as a unit.

**Dependency resolution:** Phases with `depends_on` entries are checked at query time. A phase with unmet dependencies shows as `pending` with a `blocked_by` annotation in `view_plan` output. When dependencies are met (those phases are `done`), the phase is eligible for work. This is computed, not stored — no separate `blocked` state.

### 5.3 Call Pattern for an N-Phase IP

```
create_plan          →  1 call  (IP + all phases, status=open)
claim_plan           →  1 call  (Sonnet claims IP)
update_phase × N     →  N calls (Sonnet marks each phase done as it goes)
complete_plan        →  1 call  (IP → implemented, validates handoff)
review_plan          →  1 call  (Opus → reviewed, records docs)
verify_plan          →  1 call  (Mini → verified, archives everything)
```

**Total: N + 5 calls** for an N-phase plan. An 8-phase IP is 13 calls.

---

## 6. Relationship Between IP/PH and TK/PA

**These are deliberately separate systems.** IP/PH is the project/implementation lane. TK/PA is the issue/improvement lane.

### 6.1 How They Connect

- **PH replaces PA for planned work.** If you have an IP, the PH is the work unit. You don't need PA as a proxy for planned implementation.
- **TK/PA are reactive/organic artifacts.** Mini files TK when verification reveals a bug. Dev agents file PA when implementation reveals an adjacent improvement opportunity.
- **IP entries track follow-ups.** `related_pa` and `related_tk` on the IP record which TK/PA were filed as a result of this plan's work.
- **TK/PA reference IPs via `context_links`, not `related`.** The existing `related` field on TK/PA is TK/PA-only — `archive.ts` lookup, `batch_ticket_status`, and `overview.ts` all assume TK/PA prefixes. A new `context_links: string[]` field on TK/PA entries holds cross-lane references like `"IP_minimart_001"` without breaking existing resolution logic.

### 6.2 When Mini Should File TK/PA After Verification

| Situation | Action |
|-----------|--------|
| Verified, everything works | No TK/PA needed |
| Verified, minor non-blocking issue | File PA |
| Verified, something broke in prod | File TK |
| Verification failed, needs rework | Don't file — send back for rework |
| Verified, but reveals gap in another service | File PA against that service |

---

## 7. Governance Rules

### 7.1 Transition Guards in ServerConfig

```typescript
export interface ServerConfig {
  name?: string;
  allowedTools?: Set<string>;
  transitionGuards?: TransitionGuardConfig;
}

interface TransitionGuardConfig {
  ticket_transitions?: Array<[string, string]>;  // allowed [from, to] pairs
  patch_transitions?: Array<[string, string]>;
}
```

`dispatchTool` checks the guard before forwarding to the tool handler. Tool modules remain surface-agnostic. Guard config is per-surface.

### 7.2 Explicit Allowlists for All Three Surfaces

Every surface declares what it exposes. No implicit "everything" surface.

- `minimart-allowlist.ts` — ops tools (largest set, but still explicit)
- `express-allowlist.ts` — Ollama tools (unchanged)
- `electronics-allowlist.ts` — dev tools

### 7.3 Electronics `create_patch` — Provenance + SOP

PA created from Electronics includes provenance metadata for audit trail:

```typescript
// Optional provenance fields on PatchEntry when created from Electronics
origin_ip?: string;         // e.g., "IP_minimart_001"
origin_phase?: string;      // e.g., "03"
origin_flag?: "follow-up" | "out-of-scope";
```

**Routing rule:** `create_patch` on Electronics auto-sets `assigned_to: "dev.{service}"` and `claimed_by: null`. The PA enters the team queue, not the creating worker's queue.

**SOP (enforced by `TICKETING_DEV.md`, not by code guards):** "PAs filed during IP work are backlog items. Do not claim your own follow-up PAs in the same session." The natural workflow already prevents this — the IP session ends, the PA sits in backlog, the next session claims it through normal `pick_up`. If an agent violates this, the Opus review step catches it.

---

## 8. Tool Split Proposal

### 8.1 IP/PH Tools — 8 Total

| Tool | Level | Surface | Who |
|------|-------|---------|-----|
| `create_plan` | IP | Electronics | Opus |
| `list_plans` | IP | All three | Any |
| `view_plan` | IP+PH | All three | Any |
| `claim_plan` | IP | Electronics | Sonnet |
| `update_phase` | PH | Electronics | Sonnet |
| `complete_plan` | IP | Electronics | Sonnet |
| `review_plan` | IP | Electronics + MiniMart | Opus |
| `verify_plan` | IP | MiniMart | Mini |

### 8.2 Electronics Allowlist (~35 tools)

**IP/PH tools:** `create_plan`, `list_plans`, `view_plan`, `claim_plan`, `update_phase`, `complete_plan`, `review_plan` (7)

**TK/PA read + limited write:** `list_tickets`, `view_ticket`, `search_tickets`, `list_patches`, `view_patch`, `search_patches`, `update_ticket`, `update_patch`, `update_ticket_status`, `update_patch_status`, `create_patch` (11)

**Queue:** `my_queue`, `peek`, `pick_up` (3)

**Source + git:** `read_source_file`, `git_log`, `git_diff`, `git_status` (4)

**Context:** `get_project_info`, `get_ticketing_guide`, `get_checklist`, `service_registry` (4)

**Review:** `log_review` (1)

**Tags:** `lookup_tags`, `validate_failure_class` (2)

**Batch:** `batch_ticket_status` (1)

**Ollama helpers:** `ollama_summarize_logs`, `ollama_digest_service` (2)

**Total: ~35 tools** (down from 64 on current MiniMart)

### 8.3 MiniMart Allowlist (~61 tools)

Current 64 tools minus tools that move exclusively to Electronics, plus new IP/PH read + verify tools. MiniMart retains the broadest surface as ops authority, but now explicitly declared.

### 8.4 Express Allowlist (~32 tools)

Current 30 tools + `list_plans` + `view_plan` (read-only).

### 8.5 Tools Blocked Per Surface

| Tool | Blocked From | Reason |
|------|-------------|--------|
| `deploy`, `rollback` | Express, Electronics | Ops authority only |
| `pm2_restart` | Express, Electronics | Ops authority only |
| `archive_ticket`, `archive_patch` | Express, Electronics | Mini verification authority |
| `create_ticket` | Electronics, Express | Incident declaration is ops-only |
| `assign_ticket`, `assign_patch` | Express, Electronics | Routing authority is ops |
| `batch_archive` | Express, Electronics | Ops authority |
| `mantis_*` | Express, Electronics | MANTIS is ops-only |
| `set_context` | Express, Electronics | Memory writes are ops-only |
| `create_plan`, `claim_plan`, etc. | Express | Ollama doesn't create plans |
| `verify_plan` | Electronics | Mini verification authority |

---

## 9. Third-Party MCP Integration

### 9.1 The Token Problem with Direct Connections

Every MCP connection injects its full tool manifest into agent context at session start. Agents can't lazy-load tools — the entire schema is paid upfront. Direct connections to third-party MCPs add significant token overhead:

| MCP | Tools | ~Tokens for manifest |
|-----|-------|---------------------|
| Context7 | 2 | ~300 |
| GitHub | 39 | ~6K |
| Playwright | 27 | ~4K |
| DuckDB | 9 | ~1.5K |
| 21st.dev Magic | 4 | ~600 |
| **Total** | **81** | **~12K** |

Since MiniMart has **no human users** — every token is agent context — 12K tokens of tool descriptions per session is a real cost. And agents eat this whether they use the tools or not.

### 9.2 Strategy: Embed the Picks, Skip the Rest

Instead of connecting to third-party MCPs directly (and eating their entire manifest), **embed only the operations we actually use as native minimart tools.** Cherry-pick 3-6 tools per MCP, write thin wrappers, and the agent never sees the 30+ tools it doesn't need.

**Benefits:**
- Token savings: ~20 embedded tools vs ~81 direct = ~9K tokens saved per session
- Control response shapes — trim payloads before they hit agent context
- One-liner descriptions — workflow docs stay in `get_ticketing_guide` / `get_task_config`
- No surprise tool additions when third-party MCPs update

**Tradeoff:** We maintain thin wrappers (HTTP calls to APIs or local CLIs). We lose auto-updates when third-party MCPs add features — but we probably don't want surprise new tools in agent context anyway.

### 9.3 Embedded Tool Picks by Surface

#### Electronics (6976) — Dev Rig Agents (~14 embedded tools)

**Context7 (2 of 2)** — embed both, it's only 2 tools:
| Embedded Tool | Wraps | Purpose |
|--------------|-------|---------|
| `ctx7_resolve_library` | `resolve-library-id` | Resolve library name to Context7 ID |
| `ctx7_get_docs` | `get-library-docs` | Fetch version-specific docs by topic |

Used by: all 4 Next.js projects (Sillage, MAGGOTS, MANTIS, Alpha Lab) for Drizzle, tRPC, Tailwind v4, Next.js 15 docs.

**GitHub (6 of 39)** — PR workflow + code search only:
| Embedded Tool | Wraps | Purpose |
|--------------|-------|---------|
| `gh_get_file` | `get_file_contents` | Read a file from a repo |
| `gh_create_pr` | `create_pull_request` | Open a PR after implementation |
| `gh_get_pr_diff` | `get_pull_request_diff` | Review PR changes |
| `gh_list_commits` | `list_commits` | Check recent commit history |
| `gh_search_code` | `search_code` | Find code across repos |
| `gh_create_issue` | `create_issue` | File issues from review findings |

Skipped: releases, scanning, notifications, actions, fork, branch management, user search — agents don't need these.

**Playwright (6 of 27)** — frontend verification during implementation:
| Embedded Tool | Wraps | Purpose |
|--------------|-------|---------|
| `pw_navigate` | `browser_navigate` | Load dev server URL |
| `pw_snapshot` | `browser_snapshot` | Get page accessibility tree |
| `pw_click` | `browser_click` | Interact with UI elements |
| `pw_type` | `browser_type` | Fill forms/inputs |
| `pw_screenshot` | `browser_screen_capture` | Visual verification |
| `pw_console` | `browser_console_messages` | Catch React errors, hydration issues |

Used by: 4 frontend projects (Alpha Lab, MAGGOTS, Sillage, MANTIS — all Next.js 15).

#### MiniMart (6974) — Mini Agents (~6 embedded tools)

**Playwright (3 of 27)** — prod smoke verification:
| Embedded Tool | Wraps | Purpose |
|--------------|-------|---------|
| `pw_navigate` | `browser_navigate` | Load prod URL |
| `pw_snapshot` | `browser_snapshot` | Check page structure |
| `pw_screenshot` | `browser_screen_capture` | Screenshot for verification record |

**DuckDB (3 of 9)** — archive/training data analysis:
| Embedded Tool | Wraps | Purpose |
|--------------|-------|---------|
| `duckdb_query` | `query` | Run SQL over JSONL archives, Parquet files |
| `duckdb_list_tables` | `list_tables` | Schema discovery |
| `duckdb_describe_table` | `describe_table` | Column inspection |

Skipped: `create_table`, `drop_table`, `insert_data`, `cancel_query` — agents query, not mutate.

#### Express (6975) — No Third-Party Tools

Ollama workers don't need library docs, GitHub, or browser automation.

### 9.4 Dev Rig Direct Connections (Interim)

While the embedded tools are being built, the following direct MCP connections are configured globally on the dev rig (`~/.claude.json` user scope) for immediate use:

| MCP | Type | Config |
|-----|------|--------|
| **21st.dev Magic** | stdio | `npx -y @21st-dev/magic@latest` (API key in env) |
| **Context7** | stdio | `npx -y @upstash/context7-mcp` |
| **Playwright** | stdio | `npx @playwright/mcp@latest` |
| **GitHub** | http | `https://api.githubcopilot.com/mcp/` |

These are **temporary** — once the embedded tools are implemented in minimart, the direct connections can be removed to reclaim token budget. The exception is **21st.dev Magic** which stays as a direct connection (it's a creative/generative tool, not an ops tool — doesn't belong embedded in minimart).

### 9.5 Token Budget Comparison

| Approach | Tool manifest tokens |
|----------|---------------------|
| **Direct connections** (all 5 MCPs) | ~12K extra per session |
| **Embedded picks** (20 tools across surfaces) | ~3K extra per session |
| **Savings** | **~9K tokens/session** |

At ~82 OC sessions/day (Express) + ~10 dev sessions/day (Electronics) + ~5 ops sessions/day (MiniMart), the daily token savings from embedding vs direct connections is significant.

### 9.6 21st.dev Magic — Direct Connection Only

**Not embedded in minimart.** Magic is a creative UI component generator — it produces React/TSX components from natural language. This is a dev-time creative tool, not an ops or worker tool.

- Only 4 tools, so manifest cost is minimal (~600 tokens)
- Cloud API (calls 21st.dev) — needs internet, not suitable for mini-side
- Components are generic shadcn/Tailwind — agents adapt them to each project's design system
- Stays as global dev rig direct connection for all frontend work

### 9.7 Principles

1. **Embed what agents use daily, connect what's occasional.** High-frequency ops (GitHub PRs, Playwright checks, Context7 docs) are embedded. Creative tools (Magic) stay direct.
2. **No human users means every tool description is agent cost.** 81 third-party tools × ~150 tokens each = real context pressure. Embed the 20 you need, skip the 61 you don't.
3. **Thin wrappers, not deep integrations.** Each embedded tool is an HTTP call to the upstream API or a local CLI invocation. No state, no caching, no abstraction beyond what's needed.
4. **Response trimming via Ollama.** For verbose tool responses (e.g., `server_overview`, `search_logs`), OC workers can pipe output through `ollama_summarize_logs` to extract what they need before consuming context. The raw payload stays big but the agent only ingests the digest.

---

## 10. Migration / Rollout Plan

### Phase 0: Foundation

1. Create `minimart-allowlist.ts` — explicit ops allowlist for MiniMart (6974)
2. Create `electronics-allowlist.ts` — Electronics tool set
3. Create `index-electronics.ts` — third entry point, port 6976
4. Add `transitionGuards` to `ServerConfig` in `server.ts`
5. Add PM2 config for `minimart_electronics`
6. Add `ELECTRONICS_MCP_PORT = 6976` to `paths.ts`
7. Test: all three surfaces boot, MiniMart and Express unchanged

### Phase 1: IP/PH Object Model

1. Add IP/PH types to `types.ts`
2. Create `src/tools/plans.ts` — `create_plan`, `list_plans`, `view_plan`, `claim_plan`, `update_phase`, `complete_plan`, `review_plan`
3. Create `src/tools/plans-ops.ts` — `verify_plan` (ops-only)
4. Add plan paths to `paths.ts`
5. Extend `index-manager.ts` for `IpIndex`
6. Extend `archive.ts` for plan archive (phase-level rows)
7. Extend `export_training_data` to support `types` filter including `"plan"`
8. Update `pick_up` to auto-transition status on claim (TK: open→in-progress, PA: open→in-review)
9. Register tool modules, update allowlists

### Phase 2: Electronics Goes Live

1. Deploy `minimart_electronics` on mini
2. Update SSH tunnel config for dev rig
3. Update CLAUDE.md — dev rig sessions connect to Electronics
4. **First real IP:** Track a real feature through the full lifecycle
5. Burn-in: 1-2 weeks alongside MiniMart

### Phase 3: Third-Party MCP Integration

1. Context7 — add to dev rig MCP config
2. GitHub MCP — add to dev rig MCP config
3. DuckDB MCP — add to mini-side config
4. Playwright MCP — add to mini-side config

---

## 11. Risks / Tradeoffs / Alternatives Considered

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Three PM2 processes = more RAM | Low | Each <128MB, mini has 16GB |
| Index contention — three surfaces writing same files | Medium | `writeIndex` is already atomic. IP writes are human-paced |
| IP/PH becoming a second ticketing system | Medium | Only 5+3 states. PH is just a progress tracker, not a mini-ticket |
| Agents learn the wrong surface | High | Correct CLAUDE.md, allowlist enforcement gives clear errors |
| Handoff enforcement too strict | Low | Can relax later. Starting strict is correct |

### Alternatives Rejected

| Alternative | Why Rejected |
|-------------|-------------|
| Merge IP/PH into TK/PA | Different lifecycles, would require nullable fields everywhere |
| IP/PH as markdown files | Markdown-as-database killed for tickets. Index is proven |
| Separate codebase for Electronics | User doesn't want separate codebases. Allowlist pattern proven |
| Keep one surface, add IP/PH tools | 64 tools already too large. Surface split independently valuable |
| PH as child objects of PA | PA is improvement suggestion, IP is architect-level. Different scale |
| 10-state PH lifecycle | Overengineered. PH is a progress tracker (3 states), governance lives at IP level |

---

## 12. Design Convergence Notes

This design went through four rounds of review:

1. **Opus initial design** — full architecture proposal
2. **User corrections** — IP starts `open` (no draft), PH is just a progress tracker (3 states not 10), review/verify at IP level not per-phase
3. **GPT 5-4 repo-aware review** — MiniMart needs explicit allowlist, Electronics `create_patch` needs structural anti-self-cert, transition guards belong in ServerConfig, phase-level archive rows for training data
4. **Codex GPT 5-4 contract review + user corrections** — 5 implementation gaps identified and resolved:
   - `related` field must not hold IP refs (breaks archive lookup) → new `context_links` field
   - `pick_up` should auto-transition status on claim (open→in-progress / open→in-review)
   - Anti-self-cert for `create_patch` is SOP + routing, not code guards (over-engineering)
   - `export_training_data` needs `types` filter to include plan archives
   - IP is not a queue item — `my_queue`/`peek`/`pick_up` stay TK/PA-only

Key decisions made during convergence:
- IP lifecycle: `open → claimed → implemented → reviewed → verified` (5 states)
- PH lifecycle: `pending → in_progress → done` (3 states)
- Electronics gets `create_patch` (provenance metadata + SOP), not `create_ticket`
- All three surfaces get explicit allowlists
- Transition guards in `ServerConfig`, not entrypoint-level
- `pick_up` auto-transitions status based on current state (claim = transition)
- Phase-level JSONL archival for training data
- `context_links` field for cross-lane references (separate from `related`)
- 4 canonical doc targets in review step (AGENTS.md, README.md, review checklist, audit checklist)
- Call pattern: N + 5 calls for N-phase IP (not N × 5)
- IP doesn't participate in queue workflows — created and claimed in the same conversation flow

---

## Appendix A: New Filesystem Layout

```
agent/workspace/
├── tickets/
│   ├── index.json          (unchanged)
│   └── archive.jsonl       (unchanged)
├── patches/
│   ├── index.json          (unchanged)
│   └── archive.jsonl       (unchanged)
├── plans/                  (NEW)
│   ├── index.json          (IP index — IpIndex type)
│   └── archive.jsonl       (archived IPs + phases as JSONL)
├── memory/                 (unchanged)
└── metrics/                (unchanged)
```

## Appendix B: Tool Count Summary

| Surface | Current | Proposed (native) | Embedded 3rd-party | Total | Delta |
|---------|---------|-------------------|-------------------|-------|-------|
| MiniMart (6974) | 64 (implicit all) | ~61 | +6 (3 Playwright, 3 DuckDB) | ~67 | Now declared |
| Express (6975) | 30 | ~32 | 0 | ~32 | +2 (plan read-only) |
| Electronics (6976) | — | ~35 | +14 (2 Context7, 6 GitHub, 6 Playwright) | ~49 | New |
| **Dev agent sees** | 64 | 35 + 14 = 49 | — | **49** | **23% fewer tools** |

Note: without embedding, dev agents connecting to Electronics + GitHub + Playwright + Context7 directly would see 35 + 39 + 27 + 2 = **103 tool descriptions**. Embedding cuts this to 49 — a **52% reduction** in third-party manifest tokens.

## Appendix C: Dev Rig MCP Configuration (Interim)

Active global MCP connections in `~/.claude.json` (user scope):

```json
{
  "mcpServers": {
    "MCP_DOCKER": { "command": "docker", "args": ["mcp", "gateway", "run"] },
    "minimart":   { "type": "http", "url": "http://localhost:6974/mcp" },
    "magic":      { "type": "stdio", "command": "npx", "args": ["-y", "@21st-dev/magic@latest"], "env": { "API_KEY": "..." } },
    "context7":   { "type": "stdio", "command": "npx", "args": ["-y", "@upstash/context7-mcp"] },
    "playwright": { "type": "stdio", "command": "npx", "args": ["@playwright/mcp@latest"] },
    "github":     { "type": "http", "url": "https://api.githubcopilot.com/mcp/" }
  }
}
```

**Post-embedding migration:** Once Electronics embeds Context7, GitHub, and Playwright tools natively, remove those three direct connections. Magic stays as a direct connection permanently. The `minimart` entry changes to `electronics` (port 6976) for dev rig sessions.
