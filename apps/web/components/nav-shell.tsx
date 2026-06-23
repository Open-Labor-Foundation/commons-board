"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

type NavItem = { href: string; label: string; icon: string; badge?: "approvals" };
type NavSection = { heading: string; items: NavItem[] };

const NAV_SECTIONS: NavSection[] = [
  {
    heading: "Main",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "◎" },
      { href: "/board", label: "Board", icon: "⬟" },
      { href: "/approvals", label: "Approvals", icon: "◎", badge: "approvals" },
      { href: "/votes", label: "Votes", icon: "◉" },
    ],
  },
  {
    heading: "Documents",
    items: [
      { href: "/artifacts", label: "Documents", icon: "◫" },
      { href: "/governance", label: "Decision Log", icon: "⬤" },
    ],
  },
  {
    heading: "Business",
    items: [
      { href: "/treasury", label: "Treasury", icon: "◈" },
      { href: "/billing", label: "Billing", icon: "◉" },
      { href: "/bi", label: "Analytics", icon: "▣" },
    ],
  },
  {
    heading: "Organization",
    items: [
      { href: "/org", label: "Specialists", icon: "⬡" },
      { href: "/onboarding", label: "Onboarding", icon: "◌" },
      { href: "/level4", label: "Outreach", icon: "⧊" },
    ],
  },
  {
    heading: "Operations",
    items: [
      { href: "/cadence", label: "Schedule", icon: "◷" },
      { href: "/execution", label: "Action Queue", icon: "▷" },
      { href: "/devloop", label: "Dev Cycles", icon: "⟳" },
      { href: "/autonomous", label: "Automation", icon: "⊛" },
      { href: "/federation", label: "Network", icon: "⬡" },
    ],
  },
  {
    heading: "Setup",
    items: [
      { href: "/launch", label: "Board Setup", icon: "◈" },
      { href: "/settings", label: "Settings", icon: "⚙" },
    ],
  },
];

type BadgeCounts = { approvals: number; actions: number };

export default function NavShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [orgName, setOrgName] = useState("");
  const [badges, setBadges] = useState<BadgeCounts>({ approvals: 0, actions: 0 });

  useEffect(() => {
    apiFetch<{ workspace_id: string; org_name?: string }>("/api/v1/settings").then((s) => {
      if (s?.org_name) setOrgName(s.org_name);
    });
    const fetchBadges = () => {
      Promise.all([
        apiFetch<{ approvals: unknown[] }>("/api/v1/approvals?status=pending&limit=50"),
        apiFetch<{ actions: unknown[] }>("/api/v1/level4/actions?status=pending&limit=50"),
      ]).then(([a, l]) => {
        setBadges({
          approvals: a?.approvals?.length ?? 0,
          actions: l?.actions?.length ?? 0,
        });
      });
    };
    fetchBadges();
    const iv = setInterval(fetchBadges, 30000);
    return () => clearInterval(iv);
  }, []);

  const isSetup = pathname === "/setup" || pathname === "/";
  if (isSetup) return <>{children}</>;

  const urgent = badges.approvals + badges.actions;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      {/* Header */}
      <header style={{
        background: "var(--brand)",
        color: "#fff",
        padding: "0 20px",
        height: 52,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
        boxShadow: "0 1px 3px rgb(0 0 0 / 0.2)",
        zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em" }}>commons-board</span>
          {orgName && (
            <span style={{ fontSize: 12, opacity: 0.75, background: "rgba(255,255,255,0.15)", padding: "2px 8px", borderRadius: 10 }}>
              {orgName}
            </span>
          )}
        </div>
        {urgent > 0 && (
          <Link href="/dashboard" style={{ textDecoration: "none" }}>
            <span style={{ background: "#ef4444", color: "#fff", borderRadius: 12, padding: "2px 10px", fontSize: 12, fontWeight: 600 }}>
              {urgent} pending
            </span>
          </Link>
        )}
      </header>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left nav */}
        <nav style={{
          width: 200,
          flexShrink: 0,
          background: "var(--surface)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          paddingTop: 4,
          overflowY: "auto",
        }}>
          {NAV_SECTIONS.map((section) => (
            <div key={section.heading}>
              <p style={{
                fontSize: 10,
                fontWeight: 700,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                padding: "10px 16px 3px",
                margin: 0,
              }}>
                {section.heading}
              </p>
              {section.items.map(({ href, label, icon, badge }) => {
                const active = pathname === href || pathname.startsWith(href + "/");
                const count = badge === "approvals" ? badges.approvals : 0;
                return (
                  <Link
                    key={href}
                    href={href}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      padding: "6px 14px 6px 16px",
                      fontSize: 13,
                      fontWeight: active ? 600 : 400,
                      color: active ? "var(--brand)" : "var(--text-secondary)",
                      background: active ? "var(--brand-light)" : "transparent",
                      borderLeft: active ? "3px solid var(--brand)" : "3px solid transparent",
                      textDecoration: "none",
                      transition: "background 0.1s",
                    }}
                  >
                    <span style={{ fontSize: 13, width: 16, textAlign: "center", flexShrink: 0 }}>{icon}</span>
                    <span style={{ flex: 1 }}>{label}</span>
                    {count > 0 && (
                      <span style={{
                        background: "#ef4444",
                        color: "#fff",
                        borderRadius: 8,
                        padding: "1px 6px",
                        fontSize: 10,
                        fontWeight: 700,
                        lineHeight: 1.6,
                      }}>
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
