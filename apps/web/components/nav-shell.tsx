"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

type NavItem = { href: string; label: string; badge?: "approvals" };
type NavSection = { heading: string; items: NavItem[] };

const NAV_SECTIONS: NavSection[] = [
  {
    heading: "Board",
    items: [
      { href: "/dashboard",  label: "Dashboard" },
      { href: "/board",      label: "Requests" },
      { href: "/approvals",  label: "Approvals", badge: "approvals" },
      { href: "/governance", label: "Decision Log" },
    ],
  },
  {
    heading: "Operations",
    items: [
      { href: "/cadence",    label: "Schedule" },
      { href: "/execution",  label: "Execution" },
      { href: "/autonomous", label: "Automation" },
      { href: "/devloop",    label: "Dev Cycles" },
    ],
  },
  {
    heading: "Business",
    items: [
      { href: "/level4",   label: "Outreach" },
      { href: "/treasury", label: "Treasury" },
      { href: "/billing",  label: "Billing" },
      { href: "/bi",       label: "Analytics" },
    ],
  },
  {
    heading: "Org",
    items: [
      { href: "/org",        label: "Specialists" },
      { href: "/votes",      label: "Votes" },
      { href: "/federation", label: "Network" },
    ],
  },
  {
    heading: "Config",
    items: [
      { href: "/artifacts",  label: "Artifacts" },
      { href: "/onboarding", label: "Board Interview" },
      { href: "/launch",     label: "Launch Wizard" },
      { href: "/settings",   label: "Settings" },
    ],
  },
];

type BadgeCounts = { approvals: number };

export default function NavShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [orgName, setOrgName] = useState("");
  const [boardReady, setBoardReady] = useState<boolean | null>(null);
  const [badges, setBadges] = useState<BadgeCounts>({ approvals: 0 });

  useEffect(() => {
    apiFetch<{ org_name?: string }>("/api/v1/settings").then((s) => {
      if (s?.org_name) setOrgName(s.org_name);
    });

    apiFetch<{ artifact_id?: string }>("/api/v1/artifacts/business_profile/latest").then((bp) => {
      setBoardReady(!!bp?.artifact_id);
    });

    const fetchBadges = () => {
      apiFetch<{ approvals: unknown[] }>("/api/v1/approvals?status=pending&limit=50").then((a) => {
        setBadges({ approvals: a?.approvals?.length ?? 0 });
      });
    };
    fetchBadges();
    const iv = setInterval(fetchBadges, 30000);
    return () => clearInterval(iv);
  }, []);

  // Setup pages don't use the nav shell
  const isSetup = pathname === "/setup" || pathname === "/";
  if (isSetup) return <>{children}</>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      {/* Header */}
      <header style={{
        background: "var(--brand)",
        color: "#fff",
        padding: "0 16px",
        height: 52,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
        boxShadow: "0 1px 3px rgb(0 0 0 / 0.2)",
        zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link href="/dashboard" style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-0.01em", color: "#fff", textDecoration: "none" }}>
            commons-board
          </Link>
          {orgName && (
            <span style={{ fontSize: 12, opacity: 0.75, background: "rgba(255,255,255,0.15)", padding: "2px 8px", borderRadius: 10 }}>
              {orgName}
            </span>
          )}
        </div>
        {badges.approvals > 0 && (
          <Link href="/approvals" style={{ textDecoration: "none" }}>
            <span style={{ background: "#ef4444", color: "#fff", borderRadius: 12, padding: "2px 10px", fontSize: 12, fontWeight: 600 }}>
              {badges.approvals} pending
            </span>
          </Link>
        )}
      </header>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left nav */}
        <nav style={{
          width: 188,
          flexShrink: 0,
          background: "var(--surface)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          paddingTop: 8,
          overflowY: "auto",
        }}>
          {/* Board-not-ready call-to-action */}
          {boardReady === false && pathname !== "/onboarding" && (
            <Link href="/onboarding" style={{ textDecoration: "none", margin: "0 10px 10px" }}>
              <div style={{ background: "var(--brand-light)", border: "1px solid var(--brand)", borderRadius: "var(--radius)", padding: "9px 12px" }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: "var(--brand)", margin: 0 }}>Board not configured</p>
                <p style={{ fontSize: 11, color: "var(--brand)", margin: "2px 0 0", opacity: 0.8 }}>Complete interview →</p>
              </div>
            </Link>
          )}

          {NAV_SECTIONS.map((section) => (
            <div key={section.heading}>
              <p style={{
                fontSize: 9,
                fontWeight: 700,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                padding: "8px 14px 2px",
                margin: 0,
              }}>
                {section.heading}
              </p>
              {section.items.map(({ href, label, badge }) => {
                const active = pathname === href || pathname.startsWith(href + "/");
                const count = badge === "approvals" ? badges.approvals : 0;
                return (
                  <Link
                    key={href}
                    href={href}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "5px 12px 5px 14px",
                      fontSize: 13,
                      fontWeight: active ? 600 : 400,
                      color: active ? "var(--brand)" : "var(--text-secondary)",
                      background: active ? "var(--brand-light)" : "transparent",
                      borderLeft: active ? "2px solid var(--brand)" : "2px solid transparent",
                      textDecoration: "none",
                    }}
                  >
                    <span style={{ flex: 1 }}>{label}</span>
                    {count > 0 && (
                      <span style={{ background: "#ef4444", color: "#fff", borderRadius: 8, padding: "1px 6px", fontSize: 10, fontWeight: 700, lineHeight: 1.6 }}>
                        {count}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Page content */}
        <main style={{ flex: 1, overflow: "auto", background: "var(--surface-raised)" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
