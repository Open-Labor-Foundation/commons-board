"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../lib/api";

export default function Root() {
  const router = useRouter();

  useEffect(() => {
    apiFetch<{ org_name?: string; workspace_id?: string }>("/api/v1/settings").then((s) => {
      if (!s || !s.org_name) {
        router.replace("/setup");
      } else {
        router.replace("/dashboard");
      }
    });
  }, [router]);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
      <span style={{ color: "var(--text-muted)", fontSize: 14 }}>Loading…</span>
    </div>
  );
}
