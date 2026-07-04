# commons-board — Governing Artifacts

Artifacts are authoritative configuration. Agents read artifacts and act on them. Agents do not write artifacts. Connectors provide data views only.

Every artifact is versioned, validated against a JSON schema on write, and hash-chained into the governance record. Changes to artifacts are governance events.

---

## Core Artifacts (Both Modes)

These five artifacts exist in every commons-board organization regardless of governance mode.

---

### 1. `business_profile.json`

Who the organization is.

```json
{
  "org_id": "string",
  "org_name": "string",
  "governance_mode": "business | collective",
  "description": "string",
  "industry": "string",
  "primary_domain": "string",
  "operating_since": "ISO date or null",
  "location": {
    "primary": "string",
    "regions": ["string"]
  },
  "size": {
    "headcount": "integer",
    "member_count": "integer | null"
  },
  "external_systems": ["string"],
  "created_at": "ISO datetime",
  "schema_version": "string"
}
```

**`governance_mode`** is set at onboarding and is the root configuration that branches all downstream behavior. It can be changed only through an amendment workflow.

---

### 2. `objective_config.json`

What the organization is trying to accomplish.

```json
{
  "org_id": "string",
  "primary_objectives": [
    {
      "id": "string",
      "description": "string",
      "type": "revenue | mission | growth | sustainability | service | other",
      "priority": "integer",
      "success_criteria": ["string"],
      "target_date": "ISO date | null"
    }
  ],
  "kpis": [
    {
      "id": "string",
      "name": "string",
      "unit": "string",
      "current_value": "number | null",
      "target_value": "number | null",
      "reporting_cadence": "daily | weekly | monthly"
    }
  ],
  "constraints": ["string"],
  "schema_version": "string"
}
```

---

### 3. `autonomy_policy.json`

How much the platform can do without asking.

```json
{
  "org_id": "string",
  "autonomy_mode": "advisor | orchestrator | autopilot",
  "execution_mode": "sim | live",
  "approval_thresholds": {
    "financial_spend_auto_limit": "number",
    "outreach_auto_limit": "integer",
    "content_publish_requires_approval": "boolean",
    "external_write_requires_approval": "boolean"
  },
  "disabled_capabilities": ["string"],
  "hr_agent_enabled": "boolean",
  "per_person_analytics_enabled": "boolean",
  "slack_dm_enabled": "boolean",
  "slack_channel_whitelist": ["string"],
  "risk_escalation_threshold": "integer",
  "blast_radius_escalation_threshold": "string",
  "schema_version": "string"
}
```

Defaults at onboarding:
- `autonomy_mode`: `advisor`
- `execution_mode`: `sim`
- `hr_agent_enabled`: `false`
- `per_person_analytics_enabled`: `false`
- `slack_dm_enabled`: `false`
- `external_write_requires_approval`: `true`

The platform never promotes its own autonomy mode. Mode transitions require explicit operator or member action.

---

### 4. `cadence_protocol.json`

When things run.

```json
{
  "org_id": "string",
  "daily": {
    "enabled": "boolean",
    "run_at": "HH:MM",
    "timezone": "string",
    "output": "pulse | silent",
    "delivery": ["slack | crew-bridge | email"]
  },
  "weekly": {
    "enabled": "boolean",
    "run_on": "monday | tuesday | ... | sunday",
    "run_at": "HH:MM",
    "timezone": "string",
    "output": "brief | silent",
    "delivery": ["slack | crew-bridge | email"],
    "chairs_included": ["all | string[]"]
  },
  "monthly": {
    "enabled": "boolean",
    "run_on_day": "integer",
    "output": "review | silent",
    "delivery": ["slack | crew-bridge | email"]
  },
  "schema_version": "string"
}
```

---

### 5. `agent_blueprint.json`

Which agents exist, what they own, and which labor-commons specialists back them.

```json
{
  "org_id": "string",
  "chairs": [
    {
      "chair_id": "string",
      "name": "string",
      "domain": "finance | ops | growth | legal | hr | product | it | security | strategy | rnd | sales | custom",
      "description": "string",
      "labor_commons_refs": [
        {
          "specialist_slug": "string",
          "catalog_path": "string",
          "role": "primary | supporting",
          "pinned_ref": "string | null"
        }
      ],
      "scope": {
        "owns": ["string"],
        "refuses": ["string"],
        "escalates_to": ["string"]
      },
      "worker_agents": [
        {
          "agent_id": "string",
          "name": "string",
          "labor_commons_ref": "string | null",
          "task_scope": ["string"]
        }
      ],
      "approval_required_for": ["string"]
    }
  ],
  "schema_version": "string"
}
```

`labor_commons_refs` is the key change from mother-board. Instead of a chair operating from a generic domain definition, it draws its task knowledge, scope boundaries, refusal behaviors, and authority sources from one or more specialists in the labor-commons catalog. Multiple specialists can back one chair when a function spans related domains.

---

## Collective-Only Artifact

This artifact is generated only when `governance_mode` is `collective`.

---

### 6. `collective_config.json`

How the collective governs itself.

```json
{
  "org_id": "string",
  "membership": {
    "member_roles": ["member | steward | coordinator | observer"],
    "quorum_threshold": "float",
    "active_member_count": "integer"
  },
  "voting": {
    "standard_vote_duration_hours": "integer",
    "urgent_vote_duration_hours": "integer",
    "vote_method": "simple_majority | supermajority | consensus | ranked_choice",
    "supermajority_threshold": "float | null",
    "decisions_requiring_vote": [
      "policy_change",
      "new_chair",
      "artifact_amendment",
      "budget_above_threshold",
      "federation_join",
      "governance_mode_change"
    ],
    "decisions_requiring_consensus": [
      "governance_mode_change",
      "dissolution"
    ]
  },
  "contribution_tracking": {
    "enabled": "boolean",
    "tracked_actions": ["vote | approval | meeting_attendance | task_completion"]
  },
  "amendment_protocol": {
    "proposal_requires": "any_member | steward | coordinator",
    "notice_period_hours": "integer",
    "amendment_vote_method": "supermajority | consensus"
  },
  "schema_version": "string"
}
```

---

## How Artifacts Interact

```
business_profile.json
    └── governance_mode → branches all downstream behavior

autonomy_policy.json
    └── approval thresholds → verification policy engine
    └── disabled capabilities → agent blueprint enforcement

agent_blueprint.json
    └── labor_commons_refs → specialist-resolver.ts → chair operating context
    └── scope definitions → board orchestration routing

cadence_protocol.json
    └── schedule → cadence workers
    └── delivery → connector routing

objective_config.json
    └── kpis → weekly brief generation
    └── success criteria → decision quality evaluation

collective_config.json (collective mode)
    └── voting rules → approval routing (member vote vs. operator)
    └── amendment protocol → artifact change governance
```

---

## Artifact Governance Rules

1. **Artifacts are not edited directly.** They are replaced through governed transitions that create a new version. The previous version is retained in the version history.

2. **Every artifact write is a governance event.** The event is signed, timestamped, and appended to the decision log.

3. **In collective mode, artifact changes above defined scope require member vote.** The amendment protocol in `collective_config.json` governs this process.

4. **`governance_mode` is the most protected field.** Changing governance mode from `collective` to `business` requires consensus (per `collective_config.json`) and is recorded as a major governance event.

5. **`autonomy_mode` is never changed automatically.** Only explicit human or collective action promotes the autonomy mode. The platform may surface a suggestion to promote, but it never promotes itself.

6. **`labor_commons_refs` in `agent_blueprint.json` are pinnable.** An organization can pin a specific catalog ref to freeze the specialist definition it's operating from, or leave it unpinned to receive catalog updates as they land.

---

## Onboarding Interview → Artifact Mapping

The onboarding interview generates all artifacts through a structured conversation. The interview detects `governance_mode` in the first exchange and branches accordingly.

| Interview Section | Artifacts Populated |
|---|---|
| Org identity and description | `business_profile.json` |
| Industry and operating context | `business_profile.json`, `objective_config.json` |
| Goals and success criteria | `objective_config.json` |
| Risk appetite and autonomy comfort | `autonomy_policy.json` |
| Operating cadence preferences | `cadence_protocol.json` |
| Functions and roles needed | `agent_blueprint.json` (chair list) |
| Collective structure (collective only) | `collective_config.json` |

After the interview, the specialist-resolver queries labor-commons and fills `labor_commons_refs` in `agent_blueprint.json` for each chair. The org then enters a confirmation phase where the operator or collective reviews the generated artifacts before the board activates.
