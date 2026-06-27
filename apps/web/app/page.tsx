"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../lib/api";

export default function Root() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const settings = await apiFetch<{ org_name?: string }>("/api/v1/settings");
      if (!settings?.org_name) {
        router.replace("/setup");
        return;
      }
      // Check whether the board has been configured (business_profile artifact exists).
      const bp = await apiFetch<{ artifact_id?: string }>("/api/v1/artifacts/business_profile/latest");
      if (!bp?.artifact_id) {
        router.replace("/onboarding");
        return;
      }
      router.replace("/dashboard");
    })();
  }, [router]);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
      <span style={{ color: "var(--text-muted)", fontSize: 14 }}>Loading…</span>
    </div>
  );
}
