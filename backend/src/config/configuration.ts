export default () => ({
  port: Number(process.env.PORT) || 3000,
  database: {
    url: process.env.DATABASE_URL,
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },
  // ---------------------------------------------------------------------
  // Phase 3 (maturity) — Mail config.
  //
  // MAIL_PROVIDER selects the EmailProvider implementation:
  //   • console (default) — logs the email to stdout (dev).
  //   • smtp              — uses nodemailer with the MAIL_SMTP_* vars.
  //
  // MAIL_FROM is the sender address used by the EmailChannel. Leave
  // unset in dev — the console provider doesn't actually send so the
  // From: doesn't matter; production should set it explicitly to a
  // verified domain mailbox.
  //
  // Branding (used by template renderers) lives in MAIL_BRAND_*. Same
  // pattern — env-driven so a customer-branded deployment can ship
  // without code changes.
  // ---------------------------------------------------------------------
  mail: {
    provider: process.env.MAIL_PROVIDER ?? 'console',
    from: process.env.MAIL_FROM ?? 'Scholaris <noreply@scholaris.local>',
    smtp: {
      host: process.env.MAIL_SMTP_HOST,
      port: process.env.MAIL_SMTP_PORT,
      user: process.env.MAIL_SMTP_USER,
      pass: process.env.MAIL_SMTP_PASS,
      secure: process.env.MAIL_SMTP_SECURE,
    },
    brand: {
      productName: process.env.MAIL_BRAND_NAME ?? 'Scholaris',
      supportEmail: process.env.MAIL_BRAND_SUPPORT ?? 'support@scholaris.local',
      logoUrl: process.env.MAIL_BRAND_LOGO_URL,
      footerAddress: process.env.MAIL_BRAND_FOOTER,
    },
  },
  /**
   * App URL the frontend is served from. Used in transactional emails
   * to build absolute links (login, billing, etc.). Defaults to the
   * common dev port so unconfigured deployments still produce
   * functional links in the dev console output.
   */
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
});
