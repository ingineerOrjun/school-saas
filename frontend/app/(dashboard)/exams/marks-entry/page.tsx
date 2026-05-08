import { redirect } from "next/navigation";

/**
 * Legacy URL kept for bookmarks / external links pointing at the
 * earlier prototype path. The bulk grid now lives at the unified
 * `/exams/marks` page (default tab is "Bulk Entry"), so we redirect
 * straight there.
 */
export default function MarksEntryLegacyRedirect() {
  redirect("/exams/marks");
}
