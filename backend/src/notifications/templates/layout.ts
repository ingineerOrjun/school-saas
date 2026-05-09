// ---------------------------------------------------------------------------
// Email layout primitive — wraps every template's body in a consistent
// branded shell. One file = one place to update header, footer,
// font stack, support links across every email the platform sends.
//
// Design rules:
//   • Inline CSS only. Most clients (Outlook, Gmail Web) strip <style>.
//   • Tables for layout. Flex is unsupported in older Outlook engines.
//   • Max width 600px. Standard for a single-column email.
//   • Black-on-white core, no images required for the message to be
//     readable. Logo is text-based fallback when image fails to load.
//   • Plain-text version is generated alongside HTML by callers.
// ---------------------------------------------------------------------------

const PRIMARY = '#0f172a'; // slate-900
const MUTED = '#64748b'; // slate-500
const BORDER = '#e2e8f0'; // slate-200
const BG = '#f8fafc'; // slate-50

export interface BrandConfig {
  productName: string;
  supportEmail: string;
  /** Optional URL to a hosted logo. Falls back to text when omitted. */
  logoUrl?: string;
  /** Footer address line — physical or registered office. */
  footerAddress?: string;
}

export interface WrapEmailInput {
  brand: BrandConfig;
  /** Optional preheader — the muted preview text email clients show. */
  preheader?: string;
  /** Inner HTML — the template's body. */
  body: string;
}

export function wrapEmail({ brand, preheader, body }: WrapEmailInput): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(brand.productName)}</title>
  </head>
  <body style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${PRIMARY};">
    ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</div>` : ''}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${BORDER};border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px 0 28px;">
                ${
                  brand.logoUrl
                    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.productName)}" width="120" style="display:block;border:0;outline:none;text-decoration:none;height:auto;" />`
                    : `<div style="font-size:18px;font-weight:600;letter-spacing:-0.01em;color:${PRIMARY};">${escapeHtml(brand.productName)}</div>`
                }
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px 28px 28px;font-size:14px;line-height:1.55;color:${PRIMARY};">
                ${body}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 24px 28px;border-top:1px solid ${BORDER};font-size:11px;color:${MUTED};line-height:1.5;">
                <div>Need help? <a href="mailto:${escapeHtml(brand.supportEmail)}" style="color:${MUTED};text-decoration:underline;">${escapeHtml(brand.supportEmail)}</a></div>
                ${brand.footerAddress ? `<div style="margin-top:6px;">${escapeHtml(brand.footerAddress)}</div>` : ''}
                <div style="margin-top:8px;">${escapeHtml(brand.productName)} · sent ${new Date().toUTCString()}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Helpers used by template bodies.
 */
export function emailParagraph(text: string): string {
  return `<p style="margin:0 0 12px 0;">${escapeHtml(text)}</p>`;
}

export function emailHeading(text: string): string {
  return `<h1 style="margin:0 0 12px 0;font-size:20px;line-height:1.3;font-weight:600;letter-spacing:-0.01em;">${escapeHtml(text)}</h1>`;
}

export function emailButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;">
  <tr>
    <td style="background:${PRIMARY};border-radius:6px;">
      <a href="${escapeHtml(href)}" style="display:inline-block;padding:10px 18px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;
}

export function emailMonoBlock(text: string): string {
  return `<div style="margin:16px 0;padding:14px 16px;border-radius:6px;background:${BG};border:1px solid ${BORDER};font-family:Menlo,Monaco,'Courier New',monospace;font-size:13px;letter-spacing:0.02em;color:${PRIMARY};">${escapeHtml(text)}</div>`;
}

export function emailDivider(): string {
  return `<div style="margin:18px 0;height:1px;background:${BORDER};"></div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
