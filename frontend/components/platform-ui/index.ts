// ---------------------------------------------------------------------------
// Platform UI primitives — Phase 5 design system foundation.
//
// Every platform-area page imports its primitives from this barrel.
// One import path keeps the component graph easy to grep and gives
// us a single chokepoint to refactor when (e.g.) StatusPill needs a
// new severity or PageHeader gets a new slot.
//
// Tone:
//   These primitives are tuned for the slate-based, operational SaaS
//   look the platform layer uses. The school-side dashboard has its
//   own set under @/components/ui — those keep the school-themed
//   primary color + softer shadows. Don't cross-pollinate.
// ---------------------------------------------------------------------------

export { PageHeader } from "./PageHeader";
export type { BreadcrumbItem, PageHeaderProps } from "./PageHeader";

export { SectionCard } from "./SectionCard";
export type { SectionCardProps } from "./SectionCard";

export { StatCard, StatsGrid } from "./StatsGrid";
export type { StatCardProps, StatsGridProps } from "./StatsGrid";

export {
  StatusPill,
  SchoolStatusPill,
  PlanPill,
} from "./StatusPill";
export type { PillTone, PillSize, StatusPillProps } from "./StatusPill";

export {
  PanelEmptyState,
  PanelErrorState,
  PanelLoadingState,
  SkeletonLine,
  SkeletonRows,
} from "./States";

export { FilterToolbar } from "./FilterToolbar";
export type { ActiveFilter, FilterToolbarProps } from "./FilterToolbar";
