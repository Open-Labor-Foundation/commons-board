/**
 * Business intelligence catalog — capability and dashboard specs.
 *
 * Ported from mother-board services/business-intelligence-catalog.ts.
 * Sanitized: "cio" domain → "it" (OLF schema).
 */
import type { BoardDomain } from "@commons-board/shared";
import type { Role } from "@commons-board/shared";

export type CapabilitySpec = {
  id: number;
  key: string;
  name: string;
  domain: BoardDomain;
};

export type DashboardSpec = {
  id: number;
  key: string;
  name: string;
  domain: BoardDomain;
  capabilityIds: number[];
  allowedRoles: Role[];
};

function toKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const capabilityDomains: Array<{ start: number; end: number; domain: BoardDomain }> = [
  { start: 1,  end: 10, domain: "strategy" },
  { start: 11, end: 20, domain: "ops" },
  { start: 21, end: 30, domain: "hr" },
  { start: 31, end: 40, domain: "growth" },
  { start: 41, end: 50, domain: "growth" },
  { start: 51, end: 60, domain: "finance" },
  { start: 61, end: 70, domain: "ops" },
  { start: 71, end: 80, domain: "rnd" },
  { start: 81, end: 90, domain: "strategy" },
  { start: 91, end: 100, domain: "it" }  // "cio" → "it"
];

function capabilityDomain(id: number): BoardDomain {
  for (const range of capabilityDomains) {
    if (id >= range.start && id <= range.end) return range.domain;
  }
  return "strategy";
}

const capabilityNames = [
  "Real-time revenue dashboard",
  "Multi-location performance monitoring",
  "Daily profit estimation",
  "Automated operational alerts",
  "Business health score",
  "Performance comparison",
  "Trend analysis for revenue growth",
  "Demand forecasting",
  "Automated weekly executive reports",
  "Strategic recommendation engine",
  "Manager performance dashboards",
  "Department-level metrics",
  "Staff productivity analytics",
  "Operational anomaly detection",
  "Automated scheduling suggestions",
  "Manager task assignment tools",
  "Workflow performance analysis",
  "KPI monitoring for teams",
  "Issue escalation alerts",
  "Performance coaching insights",
  "Individual productivity metrics",
  "Sales performance tracking",
  "Upsell opportunity suggestions",
  "Customer preference insights",
  "Staff ranking dashboards",
  "Training recommendation engine",
  "Goal tracking system",
  "Automated performance reports",
  "Shift performance summaries",
  "Workload balancing insights",
  "Customer lifetime value tracking",
  "Retention rate monitoring",
  "Customer behavior analysis",
  "Churn risk detection",
  "Customer segmentation",
  "Loyalty program insights",
  "Customer satisfaction tracking",
  "Review monitoring system",
  "Personalized promotion suggestions",
  "Customer journey analysis",
  "Campaign ROI analysis",
  "Lead source tracking",
  "Customer acquisition cost analysis",
  "Marketing channel comparison",
  "Conversion funnel analysis",
  "Campaign performance dashboards",
  "Automated marketing alerts",
  "Promotion effectiveness analysis",
  "Referral program tracking",
  "Local market demand insights",
  "Real-time revenue tracking",
  "Profit margin monitoring",
  "Expense category analysis",
  "Cash flow projection",
  "Invoice management insights",
  "Payroll cost monitoring",
  "Tax obligation tracking",
  "Budget vs actual reporting",
  "Financial risk alerts",
  "Cost center analysis",
  "Process efficiency metrics",
  "Resource utilization tracking",
  "Bottleneck detection",
  "SLA compliance monitoring",
  "Vendor performance tracking",
  "Service quality dashboards",
  "Capacity planning insights",
  "Cross-department coordination",
  "Operational cost analysis",
  "Research pipeline tracking",
  "Experiment outcome analysis",
  "Innovation velocity metrics",
  "Patent and IP tracking",
  "Research budget monitoring",
  "Technology readiness assessment",
  "Prototype success rate tracking",
  "Market research insights",
  "Competitive landscape analysis",
  "Scientific output metrics",
  "Market opportunity scoring",
  "Strategic alignment dashboard",
  "Initiative prioritization",
  "Portfolio performance tracking",
  "Risk exposure mapping",
  "Scenario planning tools",
  "Strategic goal completion",
  "Board-level reporting",
  "Stakeholder communication tracking",
  "Governance compliance dashboard",
  "Digital infrastructure health",
  "System performance monitoring",
  "Security posture dashboard",
  "IT service desk metrics",
  "Software deployment tracking",
  "Platform reliability insights",
  "Technology cost optimization",
  "User adoption analytics",
  "Integration health monitoring",
  "Automation coverage tracking"
];

export const capabilityCatalog: CapabilitySpec[] = capabilityNames.map((name, index) => {
  const id = index + 1;
  return { id, key: toKey(name), name, domain: capabilityDomain(id) };
});

const dashboardDefs: Array<{ name: string; domain: BoardDomain; capabilityIds: number[]; allowedRoles: Role[] }> = [
  { name: "Executive Overview",       domain: "strategy", capabilityIds: [1,2,3,4,5,6,7,8,9,10],    allowedRoles: ["admin","operator","member","observer"] },
  { name: "Operations Dashboard",     domain: "ops",      capabilityIds: [11,12,13,14,15,16,17,18,19,20], allowedRoles: ["admin","operator","member"] },
  { name: "Workforce Analytics",      domain: "hr",       capabilityIds: [21,22,23,24,25,26,27,28,29,30], allowedRoles: ["admin","operator","member"] },
  { name: "Customer Insights",        domain: "growth",   capabilityIds: [31,32,33,34,35,36,37,38,39,40], allowedRoles: ["admin","operator","member"] },
  { name: "Marketing Performance",    domain: "growth",   capabilityIds: [41,42,43,44,45,46,47,48,49,50], allowedRoles: ["admin","operator","member"] },
  { name: "Financial Dashboard",      domain: "finance",  capabilityIds: [51,52,53,54,55,56,57,58,59,60], allowedRoles: ["admin","operator"] },
  { name: "Process Excellence",       domain: "ops",      capabilityIds: [61,62,63,64,65,66,67,68,69,70], allowedRoles: ["admin","operator","member"] },
  { name: "Research & Development",   domain: "rnd",      capabilityIds: [71,72,73,74,75,76,77,78,79,80], allowedRoles: ["admin","operator","member"] },
  { name: "Strategic Intelligence",   domain: "strategy", capabilityIds: [81,82,83,84,85,86,87,88,89,90], allowedRoles: ["admin","operator","member","observer"] },
  { name: "Technology Platform",      domain: "it",       capabilityIds: [91,92,93,94,95,96,97,98,99,100], allowedRoles: ["admin","operator","member"] }
];

export const dashboardCatalog: DashboardSpec[] = dashboardDefs.map((def, index) => ({
  id: index + 1,
  key: toKey(def.name),
  ...def
}));

export function getCapabilityByKey(key: string): CapabilitySpec | undefined {
  return capabilityCatalog.find((c) => c.key === key);
}

export function getDashboardByKey(key: string): DashboardSpec | undefined {
  return dashboardCatalog.find((d) => d.key === key);
}
