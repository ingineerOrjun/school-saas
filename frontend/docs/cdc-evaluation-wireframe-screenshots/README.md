# CDC Evaluation Wireframe Screenshots

Session 5 (wireframe-only) deliverable. The directory is intentionally
empty at the end of Session 5 — capture is a 60-second manual step the
agent didn't attempt to automate (browser-pick prompt + dev-server boot
+ auth stub setup would have been more friction than it's worth for a
visual wireframe review).

## To capture

1. Start the frontend dev server: `cd frontend && npm run dev`
   (boots on `http://localhost:3100`).
2. Log in normally so the dashboard layout's auth gate passes.
3. The `conEvaluation` feature flag is **OFF by default** (matches the
   backend pilot). Two ways to flip it on for screenshots:
   - Platform → Schools → your dev school → Feature Overrides →
     enable `conEvaluation`, OR
   - Browser DevTools console: `localStorage.setItem('scholaris:features',
     JSON.stringify({ ...JSON.parse(localStorage.getItem('scholaris:features') ?? '{}'), conEvaluation: true })); location.reload();`
4. Open Chrome DevTools → Toggle Device Toolbar (Ctrl+Shift+M) →
   set viewport to **iPhone SE — 375 × 667**.
5. Visit each of the four routes, screenshot, save here with the
   filenames below.

## Expected screenshots

| File | Route | What it should show |
|---|---|---|
| `01-home.png` | `/student-evaluation` | Two assignment cards: Class 4B (12 outcomes pending / 4 follow-up) and Class 5A ("All caught up ✓"). |
| `02-units.png` | `/student-evaluation/assign-1` | Three unit cards. Unit 1 progress bar full green ("Complete"). Unit 2 partial blue bar ("In progress — N of M ratings"). Unit 3 empty bar ("Not started"). |
| `03-unit.png` | `/student-evaluation/assign-1/units/2` | Filter chips ("All / Listening / Speaking / Reading / Writing"). Outcomes grouped by skill section header. Per-outcome rated count on the right. |
| `04-rating.png` | `/student-evaluation/assign-1/units/2/outcomes/o-u2-2` | The most-important screen. Sticky outcome header at top. 30 student rows. Selected ratings highlighted. Amber dot WITHOUT ✓ on row 4 (Bishnu Pandey — REGULAR 2, no follow-up). Pending clock icon on row 5. Amber dot WITH ✓ on row 6. Failed sync red icon on row 8. |
| `05-rating-after-support.png` | same | After-support modal open (tap an amber dot to open). |
| `06-feature-gate.png` *(optional)* | any route while `conEvaluation` is OFF | The feature-disabled panel, confirming the gate works. |

## What to look for during review

The Session 5 report flagged three observations + three follow-up
questions — open `report-session-5.md` (or the chat transcript at session
close) and check the screenshots against each:

- **Density at 375px** — does the rating screen feel tight or breathable?
- **Tap targets** — is each `[1] [2] [3] [4]` button visibly tappable?
- **Sticky header behavior** — when you scroll, does the outcome stay
  visible without overlapping the first student row?
- **Status icons** — pending vs failed vs amber-dot, are they
  distinguishable at thumb distance?

If any screenshot reveals horizontal scrolling at 375px, the screen
is broken — open a quick fix issue before Session 6.
