import { api } from "./api";

// ---------------------------------------------------------------------------
// Global search client (Phase 24 Section 2). Mirrors GlobalSearchService.
// ---------------------------------------------------------------------------

export interface SearchHit {
  id: string;
  primary: string;
  secondary: string | null;
  href: string;
  score: number;
}

export type SearchGroupKey =
  | "students"
  | "teachers"
  | "guardians"
  | "payments"
  | "exams"
  | "classes";

export interface GlobalSearchResult {
  query: string;
  generatedAt: string;
  groups: Record<SearchGroupKey, SearchHit[]>;
  hasResults: boolean;
}

export const globalSearchApi = {
  search: (q: string) =>
    api<GlobalSearchResult>(
      `/me/search?q=${encodeURIComponent(q)}`,
    ),
};
