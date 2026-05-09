/**
 * build-pdf.js — Convert PROJECT.md into a printable HTML file.
 *
 * Pipeline:
 *   PROJECT.md
 *     → marked (markdown → HTML body)
 *     → wrapped in style.css + cover page
 *     → emitted to PROJECT.html
 *
 * Then a separate step (Chrome headless) renders PROJECT.html → PROJECT.pdf.
 *
 * Run:
 *   npx --yes marked -i PROJECT.md -o _build/body.html --gfm
 *   node _build/build-pdf.js          (this script — wraps body.html)
 *   chrome --headless --print-to-pdf  (the renderer)
 *
 * The Bash invocation in the parent task chains all three.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUILD = __dirname;
const BODY_HTML = path.join(BUILD, 'body.html');
const STYLE = path.join(BUILD, 'style.css');
const OUT_HTML = path.join(BUILD, 'PROJECT.html');

const body = fs.readFileSync(BODY_HTML, 'utf8');
const css = fs.readFileSync(STYLE, 'utf8');

const today = new Date().toLocaleDateString(undefined, {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Scholaris — Project Documentation</title>
    <style>${css}</style>
  </head>
  <body>
    <section class="cover">
      <h1>Scholaris</h1>
      <p class="subtitle">Multi-tenant School ERP — Project Documentation</p>
      <div class="meta">
        <div>Generated ${today}</div>
        <div>41 migrations · 12 test suites · 135 tests</div>
        <div>Platform Control Layer Phases 1–18 + Maturity push</div>
      </div>
    </section>
    ${body}
  </body>
</html>`;

fs.writeFileSync(OUT_HTML, html);
console.log(`Wrote ${OUT_HTML} (${(html.length / 1024).toFixed(1)} KB)`);
