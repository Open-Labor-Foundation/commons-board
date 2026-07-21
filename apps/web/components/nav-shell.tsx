"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, apiPost } from "../lib/api";

type SessionUser = {
  userId: string;
  workspaceId: string;
  role: string;
  legacy?: boolean;
};

type NavItem = { href: string; label: string; badge?: "approvals" };
type NavSection = { heading: string; items: NavItem[] };

const NAV_SECTIONS: NavSection[] = [
  {
    heading: "My Board",
    items: [
      { href: "/dashboard",    label: "Board Chat" },
      { href: "/chat",         label: "AI Chat" },
      { href: "/your-board",   label: "Your Board" },
      { href: "/board",        label: "Board Requests" },
      { href: "/approvals",  label: "Decisions Needed", badge: "approvals" },
      { href: "/governance", label: "Board Minutes" },
    ],
  },
  {
    heading: "Business",
    items: [
      { href: "/billing", label: "Revenue" },
      { href: "/bi",      label: "Insights" },
    ],
  },
  {
    heading: "AI Board",
    items: [
      { href: "/org",     label: "Board Structure" },
      { href: "/workers", label: "Agent Tasks" },
    ],
  },
  {
    heading: "Settings",
    items: [
      { href: "/cadence",         label: "Briefing Schedule" },
      { href: "/artifacts",       label: "Board Documents" },
      { href: "/onboarding",      label: "Board Profile" },
      { href: "/settings",        label: "Settings" },
      { href: "/settings/addins", label: "Add-ins" },
    ],
  },
];

type BadgeCounts = { approvals: number };

export default function NavShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [orgName, setOrgName] = useState("");
  const [boardReady, setBoardReady] = useState<boolean | null>(null);
  const [badges, setBadges] = useState<BadgeCounts>({ approvals: 0 });
  const [addinSections, setAddinSections] = useState<NavSection[]>([]);
  const [dark, setDark] = useState(false);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    try { setDark(localStorage.getItem("cb-theme") === "dark"); } catch { /* ignore */ }
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    try {
      if (next) {
        document.documentElement.setAttribute("data-theme", "dark");
        localStorage.setItem("cb-theme", "dark");
      } else {
        document.documentElement.removeAttribute("data-theme");
        localStorage.setItem("cb-theme", "light");
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    // Check session status — if session auth is enabled and user is not
    // authenticated, redirect to login.
    apiFetch<{ authenticated: boolean; userId?: string; workspaceId?: string; role?: string; legacy?: boolean }>("/api/v1/auth/me").then((me) => {
      if (me && me.authenticated) {
        setSessionUser({
          userId: me.userId ?? "admin",
          workspaceId: me.workspaceId ?? "default",
          role: me.role ?? "admin",
          legacy: me.legacy,
        });
      }
    });

    apiFetch<{ org_name?: string }>("/api/v1/settings").then((s) => {
      if (s?.org_name) setOrgName(s.org_name);
    });

    apiFetch<{ artifact_id?: string }>("/api/v1/artifacts/business_profile/latest").then((bp) => {
      setBoardReady(!!bp?.artifact_id);
    });

    apiFetch<{ installed: Array<{ nav?: NavSection }> }>("/api/v1/addins").then((data) => {
      const sections = (data?.installed ?? []).map(p => p.nav).filter((n): n is NavSection => !!n);
      setAddinSections(sections);
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

  async function handleLogout() {
    await apiPost("/api/v1/auth/logout", {});
    setSessionUser(null);
    router.push("/login");
  }

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
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {badges.approvals > 0 && (
            <Link href="/approvals" style={{ textDecoration: "none" }}>
              <span style={{ background: "#ef4444", color: "#fff", borderRadius: 12, padding: "2px 10px", fontSize: 12, fontWeight: 600 }}>
                {badges.approvals} decision{badges.approvals !== 1 ? "s" : ""} pending
              </span>
            </Link>
          )}
          {sessionUser && !sessionUser.legacy && (
            <span style={{ fontSize: 12, opacity: 0.8 }}>
              {sessionUser.userId}
            </span>
          )}
          <button
            onClick={toggleTheme}
            title={dark ? "Switch to light mode" : "Switch to dark mode"}
            style={{
              background: "rgba(255,255,255,0.12)",
              color: "#fff",
              border: "none",
              borderRadius: "var(--radius)",
              width: 30,
              height: 30,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 15,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {dark ? "☀" : "◑"}
          </button>
          {sessionUser && !sessionUser.legacy && (
            <button
              onClick={handleLogout}
              title="Sign out"
              style={{
                background: "rgba(255,255,255,0.12)",
                color: "#fff",
                border: "none",
                borderRadius: "var(--radius)",
                height: 30,
                padding: "0 12px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              Sign out
            </button>
          )}
        </div>
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
                <p style={{ fontSize: 11, fontWeight: 700, color: "var(--brand)", margin: 0 }}>Board not set up yet</p>
                <p style={{ fontSize: 11, color: "var(--brand)", margin: "2px 0 0", opacity: 0.8 }}>Complete your board profile →</p>
              </div>
            </Link>
          )}

          {[...NAV_SECTIONS.slice(0, 2), ...addinSections, ...NAV_SECTIONS.slice(2)].map((section) => (
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
