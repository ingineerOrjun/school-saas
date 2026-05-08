import { redirect } from "next/navigation";

/**
 * `/exams` is now an alias for the unified marks-entry page.
 *
 * The exams workflow surfaces, all reachable directly:
 *
 *   • `/exams/marks`      → bulk grid (default for all roles)
 *   • `/exams/create`     → admin / staff create-exam form
 *   • `/exams/individual` → legacy per-student form + exam CRUD
 *
 * The redirect only catches the bare `/exams` URL — sub-paths like
 * `/exams/create` resolve to their own page files first, so this
 * doesn't interfere with the create flow.
 *
 * Server-side redirect via `next/navigation` so there's no client
 * flash of an empty layout while a useEffect kicks in.
 */
export default function ExamsRedirectPage() {
  redirect("/exams/marks");
}
