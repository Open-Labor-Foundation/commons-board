# commons-board — Concept

## What It Is

commons-board is an AI-powered organizational platform that gives any group running a real operation — a worker collective, a small business, a cooperative, a nonprofit, a sole proprietor — a full executive structure with agents at every level and human oversight at every meaningful decision point.

The hierarchy runs from the top of the organization all the way to the workers executing tasks:

```
Board
  └── Executive Chairs (Finance, Ops, Growth, Legal, HR, Product, ...)
        └── Orchestrating Agents (multi-step workflow coordination)
              └── Worker Agents (specific task execution)
```

Every level of that hierarchy is backed by specialists from [labor-commons](https://github.com/Open-Labor-Foundation/labor-commons) — the canonical catalog of specialist definitions. When you form a finance chair, it isn't a generic AI finance persona. It is a payroll compliance specialist, a bookkeeping specialist, a tax preparation specialist — the actual domain expertise needed to run that function, sourced from the catalog.

---

## Two Modes, One Platform

commons-board operates in two governance modes. The underlying engine is identical. What changes is who holds authority at the top.

### Business Mode

A small business owner, sole proprietor, or founding team runs the organization. Authority is hierarchical. The owner is the operator. Executive chairs report to the owner. Approvals flow up to the owner.

This is the original mother-board vision: a single person gets the executive bench their business needs — finance, legal, operations, marketing, product, growth — without the overhead of actually hiring those people. The platform handles the cadence: daily pulse, weekly executive brief, monthly review. Routine work executes within policy. Significant decisions surface for owner approval.

Business mode is fully commercial. The owner runs a real revenue-generating venture, and commons-board gives them the complete commercial stack to do it: define product plans, charge customers, run subscriptions and per-seat pricing, gate entitlements, bill recurring revenue, and send invoices. A business owner can launch and operate a SaaS, a service business, or a product company end to end. This commercial capability is the business-mode counterpart to the collective treasury — both are first-class.

For a small business owner, commons-board is the team they couldn't afford *and* the commercial infrastructure to monetize what that team builds.

### Collective Mode

A worker collective, cooperative, or community organization runs the organization. Authority is distributed. Executive chairs report to the collective membership. Decisions above a defined threshold require member vote. Policy changes require consensus. Governance document amendments follow amendment protocols.

For a collective, commons-board adds the organizational layer that makes self-governance workable — not theoretically workable, but actually workable day to day. On the economic side, the collective gets a pooled treasury and governed distribution (equal-share, contribution-weighted, or hybrid) — the cooperative counterpart to business-mode monetization.

### Economic Symmetry

The two modes are mirror images economically, and both are first-class:

| | Business mode | Collective mode |
|---|---|---|
| Economic engine | Commercial monetization — the org bills its own customers (subscriptions, per-seat, tiers, entitlements, recurring billing, invoicing) | Collective treasury — pooled revenue and governed distribution to members |
| Governed by | Owner approval | Member vote |
| Audit | Every charge and change in the decision log | Every distribution in the decision log |

The only thing commons-board never does is charge *you* to use commons-board. OLF is AGPL and self-hosted; the platform does not meter, gate, or bill your use of it. Every commercial capability points outward — at your customers — never inward at you.

### Why One Platform Serves Both

The questions both need answered are identical:
- Who are we and what are we trying to accomplish?
- Which functions need to run and how much can run automatically?
- What triggers a decision that requires human input?
- How do we record what was decided, by whom, and why?
- What does each chair own and what falls outside its scope?

The governance mode determines who answers the human-input question. Everything else is the same engine.

---

## How Labor-Commons Changes Everything

In the original mother-board design, executive chairs were defined by role type (CIO, CFO, COO, etc.). That model works but it limits the depth of expertise any chair can bring. A generic finance chair knows finance in general. A labor-commons bookkeeping specialist knows bookkeeping specifically — the tasks it owns, the tasks it refuses, the authoritative sources it draws from, what a correct output looks like.

When commons-board instantiates a chair, it consults labor-commons:

- **For a plumbing collective:** ops chair is backed by a construction operations specialist, a materials procurement specialist, a job scheduling specialist.
- **For a nonprofit:** finance chair is backed by a grant reporting specialist, a nonprofit compliance specialist, a donor records specialist.
- **For a two-person consulting firm:** growth chair is backed by a client relationship specialist, a proposal writing specialist, a contract review specialist.

Neither the collective nor the small business owner needs to know which specialists are running beneath their chairs. They experience one coherent executive function. The catalog makes that function deep and domain-specific rather than generic.

Every specialist contributed to labor-commons by a domain expert — every electrician, accountant, paralegal, or nurse who runs a commons-idea session and submits their knowledge — makes commons-board better for every organization in that field. That is the compounding flywheel the OLF stack is built for.

---

## Interface: Self-Contained, With an Optional Bridge

commons-board is a complete, standalone platform. It carries its own human interface from mother-board: a chat interpreter that turns plain language into structured board intent, a board chat surface, and a web UI for oversight and audit. A business owner or a collective uses commons-board directly. It is not a layer that sits behind another application, and it does not require any other OLF repo to be usable.

[commons-crew](https://github.com/Open-Labor-Foundation/commons-crew) is an **optional** integration, not a dependency. If a user already lives in the commons-crew personal assistant, a thin bridge lets them reach their board — "run the weekly brief," "approve the contract," "what's the financial status" — without leaving the PA. That convenience exists for people already in the commons-crew workflow; it is never required to operate commons-board. The board's own interface is always the primary surface.

## Provider and Inference Settings

commons-board does its reasoning through configurable inference providers, chosen in a settings menu rather than hardcoded. An operator can select from multiple providers and multiple implementation styles — hosted API providers, harness/console-based providers, and local inference — and switch between them per deployment.

No API keys or provider credentials ever live in this repository. Provider selection is in-repo configuration; the credentials that back a selection are deployment-specific settings injected at runtime. The repo describes *which kinds of providers are supported and how to configure one*; it never contains a usable secret.

---

## Federation

Commons-board supports parent-child organizational relationships — and the same pattern serves both modes:

- **Business:** parent company → subsidiaries or divisions
- **Collective:** sector federation → regional collectives → local chapters

Policy flows from parent to child. A parent organization can set policy floors that child organizations cannot override. A child organization operates autonomously within those floors. Governance handoff is hash-chained and signed — any change in policy inheritance is recorded and attributable.

This is how a regional collective federation governs its member collectives, and how a multi-location business governs its branches. Same mechanism, different framing.

---

## The Trust Ramp

Both modes start conservative and graduate toward autonomy as the organization establishes trust with the platform.

**Advisor mode** (default): Every action requires human approval. Nothing executes automatically. The platform recommends and waits.

**Orchestrator mode**: Routine actions within defined scope execute automatically. Novel, risky, or high-impact actions surface for approval. The platform learns the difference over time.

**Autopilot mode**: All actions execute within policy thresholds. Only low-confidence or out-of-policy decisions escalate. The platform operates day-to-day with minimal input.

Organizations opt into each mode transition. The platform never promotes itself.

---

## What "Ready to Operate" Looks Like

After the onboarding interview:

1. The organization's governing artifacts are generated — who you are, what you're building, how much can run automatically, when things happen, which agents exist.
2. Labor-commons is consulted and the chairs are staffed with appropriate specialists.
3. Cadence begins: the platform runs daily, weekly, and monthly operations on schedule.
4. Decisions surface to the right authority — owner in business mode, membership in collective mode — and wait for resolution.
5. Everything is written to an immutable audit trail before it executes.

The organization is running. The owner or collective doesn't have to think about the machinery.

---

## What commons-board Is Not

- It is not a project management tool. It is an organizational governance platform.
- It is not a chatbot. It is an executive structure that operates on cadence.
- It is not an autonomous agent that acts without permission. It is a governed system that surfaces decisions to the right authority.
- It does not provide legal advice. It produces checklists, drafts, and reminders for human legal review.
- It does not fire people, change compensation, reallocate budgets, or make pricing decisions without explicit human authorization.
- It is not a layer that charges you to use it. commons-board is free, AGPL, and self-hosted; OLF never meters or bills your use of the platform. (Business mode *does* give you a full commercial stack to bill your own customers — that capability points outward, at your customers, never inward at you.)
