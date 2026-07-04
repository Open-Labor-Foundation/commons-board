import type { ComponentType } from "react";

// Registry of installed add-in page components.
// When a pack is installed, add an entry here:
//
//   import dynamic from "next/dynamic";
//   "pack-id": {
//     "route-slug": dynamic(() => import("../addins/pack-id/pages/PageComponent")),
//   }
//
// Route slugs must match the pack's manifest.json "pages[].route" values.

export const ADDIN_PAGES: Record<string, Record<string, ComponentType>> = {};
