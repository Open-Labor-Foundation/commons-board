"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost, apiFetch } from "../../lib/api";

// ─── types ──────────────────────────────────────────────────────────────────

type SectionKey = "L0" | "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7";

type SessionState = {
  currentSection: SectionKey;
  completedSections: SectionKey[];
  answers: Record<string, unknown>;
  readyToFinalize: boolean;
};

type WizardStep =
  | "welcome"
  | "L0" | "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7"
  | "review"
  | "done";

// ─── helpers ─────────────────────────────────────────────────────────────────

const SECTION_LABELS: Record<SectionKey, string> = {
  L0: "Agreements",
  L1: "Capacity",
  L2: "Market",
  L3: "Offer",
  L4: "Outreach",
  L5: "Tech Stack",
  L6: "Treasury Rules",
  L7: "Review",
};

const SECTIONS: SectionKey[] = ["L0", "L1", "L2", "L3", "L4", "L5", "L6", "L7"];

function Progress({ completed, current }: { completed: SectionKey[]; current: SectionKey }) {
  return (
    <div style={{ display: "flex", gap: 4, padding: "16px 24px 0" }}>
      {SECTIONS.map((s) => {
        const done = completed.includes(s);
        const active = s === current;
        return (
          <div key={s} style={{ flex: 1 }}>
            <div style={{
              height: 4,
              borderRadius: 2,
              background: done ? "var(--brand)" : active ? "var(--brand)" : "var(--border)",
              opacity: active ? 0.5 : 1,
              transition: "background 0.2s",
            }} />
            <p style={{ fontSize: 9, color: done ? "var(--brand)" : active ? "var(--text-secondary)" : "var(--text-muted)", textAlign: "center", margin: "3px 0 0", fontWeight: active ? 700 : 400 }}>
              {SECTION_LABELS[s]}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{label}</label>
      {hint && <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>{hint}</p>}
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 13,
  borderRadius: "var(--radius)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text-primary)",
  width: "100%",
  boxSizing: "border-box",
};

const btnStyle: React.CSSProperties = {
  background: "var(--brand)",
  color: "#fff",
  padding: "10px 24px",
  fontSize: 14,
  fontWeight: 600,
  borderRadius: "var(--radius)",
  border: "none",
  cursor: "pointer",
};

// ─── section forms ────────────────────────────────────────────────────────────

function L0Form({ onSubmit, onSkip, busy }: { onSubmit: (p: object) => void; onSkip: () => void; busy: boolean }) {
  const [consent, setConsent] = useState(false);
  const [noMoney, setNoMoney] = useState(false);
  const [noContact, setNoContact] = useState(false);
  const ready = consent && noMoney && noContact;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 4px" }}>Agreements</h3>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
          Before we configure your board, please confirm these operating agreements.
        </p>
      </div>
      {[
        { val: consent, set: setConsent, text: "I understand this setup will configure an AI-assisted board with real operational authority." },
        { val: noMoney, set: setNoMoney, text: "No money will move without board approval — all spending requires explicit authorization." },
        { val: noContact, set: setNoContact, text: "No customer contact will happen without opt-in — all outreach requires prior consent." },
      ].map(({ val, set, text }, i) => (
        <label key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer" }}>
          <input type="checkbox" checked={val} onChange={e => set(e.target.checked)} style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5 }}>{text}</span>
        </label>
      ))}
      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={() => onSubmit({ consent: true, no_money_without_approval: true, no_customer_contact_without_opt_in: true })}
          disabled={!ready || busy} style={{ ...btnStyle, opacity: ready && !busy ? 1 : 0.5 }}>
          {busy ? "Saving…" : "Agree & Continue"}
        </button>
        <button onClick={onSkip} disabled={busy} style={{ ...btnStyle, background: "var(--surface)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
          Skip for now
        </button>
      </div>
    </div>
  );
}

function L1Form({ onSubmit, onSkip, busy }: { onSubmit: (p: object) => void; onSkip: () => void; busy: boolean }) {
  const [hours, setHours] = useState("");
  const [budget, setBudget] = useState("low");
  const [risk, setRisk] = useState("conservative");
  const [motion, setMotion] = useState("inbound");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 4px" }}>Capacity</h3>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>How much time and resources can your board commit?</p>
      </div>
      <Field label="Hours available per week" hint="Across all board members combined">
        <input type="number" value={hours} onChange={e => setHours(e.target.value)} placeholder="20" style={inputStyle} />
      </Field>
      <Field label="Budget range">
        <select value={budget} onChange={e => setBudget(e.target.value)} style={inputStyle}>
          <option value="low">Low — bootstrap / &lt;$1k/mo</option>
          <option value="medium">Medium — $1k–$10k/mo</option>
          <option value="high">High — $10k+/mo</option>
        </select>
      </Field>
      <Field label="Risk appetite">
        <select value={risk} onChange={e => setRisk(e.target.value)} style={inputStyle}>
          <option value="conservative">Conservative</option>
          <option value="moderate">Moderate</option>
          <option value="aggressive">Aggressive</option>
        </select>
      </Field>
      <Field label="Preferred sales motion">
        <select value={motion} onChange={e => setMotion(e.target.value)} style={inputStyle}>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
          <option value="product_led">Product-led</option>
          <option value="community_led">Community-led</option>
        </select>
      </Field>
      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={() => onSubmit({ time_available_per_week_hours: Number(hours) || 10, budget_range: budget, risk_appetite: risk, preferred_sales_motion: motion })}
          disabled={busy} style={{ ...btnStyle, opacity: busy ? 0.5 : 1 }}>
          {busy ? "Saving…" : "Continue"}
        </button>
        <button onClick={onSkip} disabled={busy} style={{ ...btnStyle, background: "var(--surface)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>Skip</button>
      </div>
    </div>
  );
}

function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState("");
  function add() {
    const t = draft.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft("");
  }
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
        {value.map(v => (
          <span key={v} style={{ background: "var(--brand-light)", color: "var(--brand)", padding: "2px 10px", borderRadius: 12, fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
            {v}
            <button onClick={() => onChange(value.filter(x => x !== v))} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--brand)", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder={placeholder} style={{ ...inputStyle, flex: 1 }} />
        <button onClick={add} style={{ ...btnStyle, padding: "8px 14px", fontSize: 12 }}>Add</button>
      </div>
    </div>
  );
}

function L2Form({ onSubmit, onSkip, busy }: { onSubmit: (p: object) => void; onSkip: () => void; busy: boolean }) {
  const [industries, setIndustries] = useState<string[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [advantages, setAdvantages] = useState<string[]>([]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 4px" }}>Market Focus</h3>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>Where does your business operate and what problems does it solve?</p>
      </div>
      <Field label="Industries of interest" hint="Press Enter or click Add after each one">
        <TagInput value={industries} onChange={setIndustries} placeholder="e.g. Healthcare, Fintech…" />
      </Field>
      <Field label="Problems to solve">
        <TagInput value={problems} onChange={setProblems} placeholder="e.g. Manual invoicing, slow onboarding…" />
      </Field>
      <Field label="Unfair advantages" hint="What gives you an edge over competitors?">
        <TagInput value={advantages} onChange={setAdvantages} placeholder="e.g. Existing network, proprietary data…" />
      </Field>
      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={() => onSubmit({ industries_of_interest: industries, problems_to_solve: problems, unfair_advantages: advantages })}
          disabled={busy} style={{ ...btnStyle, opacity: busy ? 0.5 : 1 }}>
          {busy ? "Saving…" : "Continue"}
        </button>
        <button onClick={onSkip} disabled={busy} style={{ ...btnStyle, background: "var(--surface)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>Skip</button>
      </div>
    </div>
  );
}

function L3Form({ onSubmit, onSkip, busy }: { onSubmit: (p: object) => void; onSkip: () => void; busy: boolean }) {
  const [icp, setIcp] = useState("");
  const [offer, setOffer] = useState("");
  const [urgency, setUrgency] = useState("");
  const [delivery, setDelivery] = useState("async");
  const [pricing, setPricing] = useState("");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 4px" }}>Your Offer</h3>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>Define what you sell and who you sell it to.</p>
      </div>
      <Field label="Target customer" hint="Describe your ideal customer profile">
        <input value={icp} onChange={e => setIcp(e.target.value)} placeholder="e.g. SMB operations managers at 10-50 person companies" style={inputStyle} />
      </Field>
      <Field label="Your offer">
        <textarea value={offer} onChange={e => setOffer(e.target.value)} placeholder="e.g. Monthly retainer for workflow automation consulting" rows={3}
          style={{ ...inputStyle, resize: "vertical" }} />
      </Field>
      <Field label="Urgency trigger" hint="What makes a customer buy now?">
        <input value={urgency} onChange={e => setUrgency(e.target.value)} placeholder="e.g. Year-end budget flush, hiring freeze" style={inputStyle} />
      </Field>
      <Field label="Delivery model">
        <select value={delivery} onChange={e => setDelivery(e.target.value)} style={inputStyle}>
          <option value="async">Async / self-serve</option>
          <option value="sync">Synchronous / live</option>
          <option value="hybrid">Hybrid</option>
          <option value="productized">Productized service</option>
        </select>
      </Field>
      <Field label="Pricing hypothesis">
        <input value={pricing} onChange={e => setPricing(e.target.value)} placeholder="e.g. $2,500/mo retainer or $500/project" style={inputStyle} />
      </Field>
      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={() => onSubmit({ target_icp: icp, offer, urgency, delivery_model: delivery, pricing_hypothesis: pricing })}
          disabled={busy} style={{ ...btnStyle, opacity: busy ? 0.5 : 1 }}>
          {busy ? "Saving…" : "Continue"}
        </button>
        <button onClick={onSkip} disabled={busy} style={{ ...btnStyle, background: "var(--surface)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>Skip</button>
      </div>
    </div>
  );
}

function L4Form({ onSubmit, onSkip, busy }: { onSubmit: (p: object) => void; onSkip: () => void; busy: boolean }) {
  const [channel, setChannel] = useState("email");
  const [sources, setSources] = useState<string[]>([]);
  const [compliance, setCompliance] = useState<string[]>([]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 4px" }}>Outreach Channels</h3>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>How will your board reach potential customers?</p>
      </div>
      <Field label="Primary channel">
        <select value={channel} onChange={e => setChannel(e.target.value)} style={inputStyle}>
          <option value="email">Email</option>
          <option value="linkedin">LinkedIn</option>
          <option value="phone">Phone</option>
          <option value="events">Events</option>
          <option value="content">Content / SEO</option>
          <option value="referral">Referral</option>
        </select>
      </Field>
      <Field label="List sources" hint="Where will you source leads?">
        <TagInput value={sources} onChange={setSources} placeholder="e.g. Apollo, LinkedIn, existing CRM…" />
      </Field>
      <Field label="Compliance constraints" hint="Any legal or regulatory restrictions on outreach?">
        <TagInput value={compliance} onChange={setCompliance} placeholder="e.g. CAN-SPAM, GDPR, no cold call…" />
      </Field>
      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={() => onSubmit({ primary_channel: channel, list_sources: sources, compliance_constraints: compliance })}
          disabled={busy} style={{ ...btnStyle, opacity: busy ? 0.5 : 1 }}>
          {busy ? "Saving…" : "Continue"}
        </button>
        <button onClick={onSkip} disabled={busy} style={{ ...btnStyle, background: "var(--surface)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>Skip</button>
      </div>
    </div>
  );
}

function L5Form({ onSubmit, onSkip, busy }: { onSubmit: (p: object) => void; onSkip: () => void; busy: boolean }) {
  const [domain, setDomain] = useState("");
  const [email, setEmail] = useState("");
  const [landing, setLanding] = useState("");
  const [crm, setCrm] = useState("");
  const [billing, setBilling] = useState("");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 4px" }}>Tech Stack</h3>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>What tools will your business use?</p>
      </div>
      <Field label="Domain provider"><input value={domain} onChange={e => setDomain(e.target.value)} placeholder="e.g. Namecheap, GoDaddy, Cloudflare" style={inputStyle} /></Field>
      <Field label="Email provider"><input value={email} onChange={e => setEmail(e.target.value)} placeholder="e.g. Google Workspace, Mailgun, SendGrid" style={inputStyle} /></Field>
      <Field label="Landing page"><input value={landing} onChange={e => setLanding(e.target.value)} placeholder="e.g. Webflow, Framer, Carrd" style={inputStyle} /></Field>
      <Field label="CRM"><input value={crm} onChange={e => setCrm(e.target.value)} placeholder="e.g. HubSpot, Pipedrive, Notion" style={inputStyle} /></Field>
      <Field label="Billing"><input value={billing} onChange={e => setBilling(e.target.value)} placeholder="e.g. Stripe, Wave, QuickBooks" style={inputStyle} /></Field>
      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={() => onSubmit({ domain_provider: domain, email_provider: email, landing_stack: landing, crm_choice: crm, billing_choice: billing })}
          disabled={busy} style={{ ...btnStyle, opacity: busy ? 0.5 : 1 }}>
          {busy ? "Saving…" : "Continue"}
        </button>
        <button onClick={onSkip} disabled={busy} style={{ ...btnStyle, background: "var(--surface)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>Skip</button>
      </div>
    </div>
  );
}

function L6Form({ onSubmit, onSkip, busy }: { onSubmit: (p: object) => void; onSkip: () => void; busy: boolean }) {
  const [currency, setCurrency] = useState("USD");
  const [dailyCap, setDailyCap] = useState("");
  const [weeklyCap, setWeeklyCap] = useState("");
  const [txCap, setTxCap] = useState("");
  const [forbidden, setForbidden] = useState<string[]>([]);
  const [approvalThreshold, setApprovalThreshold] = useState("");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 4px" }}>Treasury Rules</h3>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>Set spending limits and approval requirements.</p>
      </div>
      <Field label="Currency">
        <select value={currency} onChange={e => setCurrency(e.target.value)} style={inputStyle}>
          {["USD", "EUR", "GBP", "CAD", "AUD"].map(c => <option key={c}>{c}</option>)}
        </select>
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Field label="Daily spend cap"><input type="number" value={dailyCap} onChange={e => setDailyCap(e.target.value)} placeholder="500" style={inputStyle} /></Field>
        <Field label="Weekly spend cap"><input type="number" value={weeklyCap} onChange={e => setWeeklyCap(e.target.value)} placeholder="2000" style={inputStyle} /></Field>
      </div>
      <Field label="Per-transaction cap"><input type="number" value={txCap} onChange={e => setTxCap(e.target.value)} placeholder="250" style={inputStyle} /></Field>
      <Field label="Forbidden spending categories" hint="Categories that require explicit board approval">
        <TagInput value={forbidden} onChange={setForbidden} placeholder="e.g. Advertising, Legal, Travel…" />
      </Field>
      <Field label="Approval required over amount" hint="Any single transaction above this needs board sign-off">
        <input type="number" value={approvalThreshold} onChange={e => setApprovalThreshold(e.target.value)} placeholder="1000" style={inputStyle} />
      </Field>
      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={() => onSubmit({
          currency,
          daily_spend_cap: Number(dailyCap) || null,
          weekly_spend_cap: Number(weeklyCap) || null,
          per_transaction_cap: Number(txCap) || null,
          forbidden_categories: forbidden,
          approval_required_over_amount: Number(approvalThreshold) || null,
          approval_required_for_categories: forbidden,
          approver_roles: ["admin"],
        })} disabled={busy} style={{ ...btnStyle, opacity: busy ? 0.5 : 1 }}>
          {busy ? "Saving…" : "Continue"}
        </button>
        <button onClick={onSkip} disabled={busy} style={{ ...btnStyle, background: "var(--surface)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>Skip</button>
      </div>
    </div>
  );
}

function L7Form({ assumptions, onConfirm, busy }: { assumptions: string; onConfirm: () => void; busy: boolean }) {
  const [corrections, setCorrections] = useState("");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 4px" }}>Review Your Board Setup</h3>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
          Based on your answers, here&apos;s what your board will operate with. Review carefully before activating.
        </p>
      </div>
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "16px 20px" }}>
        <p style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.7, whiteSpace: "pre-wrap", margin: 0 }}>
          {assumptions || "Loading assumptions…"}
        </p>
      </div>
      <Field label="Corrections or notes" hint="Anything above that needs adjusting? (optional)">
        <textarea value={corrections} onChange={e => setCorrections(e.target.value)} rows={3}
          placeholder="e.g. The budget range should be medium, not low…" style={{ ...inputStyle, resize: "vertical" }} />
      </Field>
      <button onClick={onConfirm} disabled={busy} style={{ ...btnStyle, opacity: busy ? 0.5 : 1 }}>
        {busy ? "Activating board…" : "Activate Board"}
      </button>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function LaunchPage() {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>("welcome");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [assumptions, setAssumptions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function startSession() {
    setBusy(true);
    setError("");
    const { data, status } = await apiPost<{ session_id: string; state: SessionState }>("/api/v1/launch/sessions", {});
    setBusy(false);
    if (status >= 400 || !data?.session_id) {
      setError("Could not start a board setup session. Please try again.");
      return;
    }
    setSessionId(data.session_id);
    setSessionState(data.state);
    setStep(data.state.currentSection);
  }

  async function submitSection(section: SectionKey, payload: object) {
    if (!sessionId) return;
    setBusy(true);
    setError("");
    const { data, status } = await apiPost<{ state: SessionState }>(
      `/api/v1/launch/sessions/${sessionId}/sections/${section}`,
      { payload }
    );
    setBusy(false);
    if (status >= 400 || !data?.state) {
      setError("Failed to save this section. Please try again.");
      return;
    }
    setSessionState(data.state);
    if (data.state.readyToFinalize) {
      await loadAssumptions();
    } else {
      setStep(data.state.currentSection);
    }
  }

  async function skipSection(section: SectionKey) {
    if (!sessionId) return;
    setBusy(true);
    setError("");
    const { data, status } = await apiPost<{ state: SessionState }>(
      `/api/v1/launch/sessions/${sessionId}/sections/${section}`,
      { skip: true }
    );
    setBusy(false);
    if (status >= 400 || !data?.state) {
      setError("Failed to skip this section. Please try again.");
      return;
    }
    setSessionState(data.state);
    if (data.state.readyToFinalize) {
      await loadAssumptions();
    } else {
      setStep(data.state.currentSection);
    }
  }

  async function loadAssumptions() {
    if (!sessionId) return;
    const data = await apiFetch<{ assumptions: string }>(`/api/v1/launch/sessions/${sessionId}/assumptions`);
    setAssumptions(data?.assumptions ?? "");
    setStep("L7");
  }

  async function finalize() {
    if (!sessionId) return;
    setBusy(true);
    setError("");
    const { data, status } = await apiPost(`/api/v1/launch/sessions/${sessionId}/finalize`, {});
    setBusy(false);
    if (status >= 400 || !data) {
      setError("Failed to activate board. Please try again.");
      return;
    }
    setStep("done");
    setTimeout(() => router.replace("/dashboard"), 2500);
  }

  const completed = sessionState?.completedSections ?? [];
  const current = sessionState?.currentSection ?? "L0";

  // ── welcome ────────────────────────────────────────────────────────────────
  if (step === "welcome") {
    return (
      <div style={{ padding: 40, maxWidth: 560 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 12px" }}>Board Setup</h2>
        <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, margin: "0 0 8px" }}>
          This guided setup takes about 10 minutes. It will configure your board with the agreements, operating model, and financial rules your team will run on.
        </p>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 32px" }}>
          You can skip any section and come back to it later from Settings.
        </p>
        {error && <p style={{ fontSize: 13, color: "var(--error)", marginBottom: 16 }}>{error}</p>}
        <button onClick={startSession} disabled={busy} style={{ ...btnStyle, opacity: busy ? 0.5 : 1, fontSize: 15, padding: "12px 28px" }}>
          {busy ? "Starting…" : "Begin board setup"}
        </button>
      </div>
    );
  }

  // ── done ───────────────────────────────────────────────────────────────────
  if (step === "done") {
    return (
      <div style={{ padding: 40, maxWidth: 560, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px", color: "var(--brand)" }}>Board activated</h2>
        <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: 0 }}>Redirecting you to the dashboard…</p>
      </div>
    );
  }

  const sectionProps = { busy, onSkip: () => skipSection(step as SectionKey) };
  const wrapSectionSubmit = (s: SectionKey) => (p: object) => submitSection(s, p);

  return (
    <div style={{ maxWidth: 640, padding: "24px 32px" }}>
      <Progress completed={completed} current={current} />

      <div style={{ marginTop: 28 }}>
        {error && <p style={{ fontSize: 13, color: "var(--error)", marginBottom: 16 }}>{error}</p>}

        {step === "L0" && <L0Form {...sectionProps} onSubmit={wrapSectionSubmit("L0")} />}
        {step === "L1" && <L1Form {...sectionProps} onSubmit={wrapSectionSubmit("L1")} />}
        {step === "L2" && <L2Form {...sectionProps} onSubmit={wrapSectionSubmit("L2")} />}
        {step === "L3" && <L3Form {...sectionProps} onSubmit={wrapSectionSubmit("L3")} />}
        {step === "L4" && <L4Form {...sectionProps} onSubmit={wrapSectionSubmit("L4")} />}
        {step === "L5" && <L5Form {...sectionProps} onSubmit={wrapSectionSubmit("L5")} />}
        {step === "L6" && <L6Form {...sectionProps} onSubmit={wrapSectionSubmit("L6")} />}
        {step === "L7" && <L7Form assumptions={assumptions} onConfirm={finalize} busy={busy} />}
      </div>
    </div>
  );
}
