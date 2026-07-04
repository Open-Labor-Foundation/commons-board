"use client";

import { use } from "react";
import { ADDIN_PAGES } from "../../../../lib/addin-page-registry";

type Props = { params: Promise<{ pack: string; slug: string[] }> };

export default function AddinPage({ params }: Props) {
  const { pack, slug } = use(params);
  const route = slug.join("/");
  const packPages = ADDIN_PAGES[pack];
  const Component = packPages?.[route];

  if (!packPages) {
    return (
      <div style={{ padding: 32, fontSize: 13, color: "var(--text-muted)" }}>
        Add-in &quot;{pack}&quot; is not installed.
      </div>
    );
  }
  if (!Component) {
    return (
      <div style={{ padding: 32, fontSize: 13, color: "var(--text-muted)" }}>
        Page &quot;{route}&quot; not found in add-in &quot;{pack}&quot;.
      </div>
    );
  }

  return <Component />;
}
