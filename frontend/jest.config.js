// ============================================================================
// Jest configuration for the Scholaris frontend.
//
// Session 6a establishes the frontend test floor (no test runner existed
// before this commit). We use Next.js 14's `next/jest` helper because:
//
//   • It transforms TS/TSX/JSX via SWC (no babel config to maintain).
//   • It auto-loads `next.config.js` and `.env.*` files the way the dev
//     server does, so tests that import code which reads env vars (e.g.
//     `lib/api.ts` reading NEXT_PUBLIC_API_URL) don't crash.
//   • It honours the `@/...` path alias from tsconfig automatically — no
//     duplicate `moduleNameMapper` for the common case.
//
// Test environment is `jsdom` because our hooks call into React Query,
// which expects window/document to exist. Pure Node tests aren't part
// of this codebase's pattern.
//
// Coverage of hooks is the Session 6a target — UI component tests are
// out of scope per the spec. As more tests land, add `--coverage` to
// the CI step in a follow-up session.
// ============================================================================

const nextJest = require("next/jest");

const createJestConfig = nextJest({
  // Path to the Next.js app — `./` since this config sits next to
  // next.config.js + tsconfig.json.
  dir: "./",
});

/** @type {import('jest').Config} */
const customJestConfig = {
  testEnvironment: "jsdom",
  // `setupFilesAfterEnv` runs the listed module(s) AFTER Jest has
  // installed its test-framework globals (`expect`, `jest`, `beforeEach`,
  // etc.) but BEFORE each test file's own code. This is the slot that
  // `@testing-library/jest-dom` needs in order to extend `expect` with
  // DOM matchers like `toBeInTheDocument()` — calling those extensions
  // from `setupFiles` (which runs BEFORE the framework) crashes with
  // `ReferenceError: expect is not defined`.
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  // Test discovery: any `*.test.ts(x)` or `*.spec.ts(x)` under app/ or
  // lib/ or components/. Excludes node_modules + .next build output.
  testMatch: [
    "<rootDir>/app/**/*.test.{ts,tsx}",
    "<rootDir>/lib/**/*.test.{ts,tsx}",
    "<rootDir>/components/**/*.test.{ts,tsx}",
    "<rootDir>/hooks/**/*.test.{ts,tsx}",
  ],
  // next/jest already maps `@/...` — listed here explicitly only to
  // document the convention so future readers don't think it's magic.
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  // Keep tests fast: skip the .next build dir and node_modules.
  modulePathIgnorePatterns: ["<rootDir>/.next/"],
};

module.exports = createJestConfig(customJestConfig);
