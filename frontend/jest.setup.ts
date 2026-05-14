// ============================================================================
// Global Jest setup — runs once per test file after the test environment
// is created. The Session 6a use case is the React Query hook test
// shared wrapper (see lib/__tests__/test-utils.tsx); this file pulls in
// jest-dom matchers so component tests in future sessions can do
// `expect(node).toBeInTheDocument()` without re-importing per file.
// ============================================================================
import "@testing-library/jest-dom";
