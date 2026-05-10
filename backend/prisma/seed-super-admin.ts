/**
 * Seed the first SUPER_ADMIN.
 *
 * Run once per environment, manually:
 *
 *   SUPER_ADMIN_EMAIL=owner@example.com \
 *   SUPER_ADMIN_PASSWORD='change-me-in-prod' \
 *   npx ts-node prisma/seed-super-admin.ts
 *
 * Idempotent — re-running with the same email is a no-op (the script
 * detects an existing SUPER_ADMIN with that email and exits cleanly).
 *
 * The script attaches the SUPER_ADMIN to the FIRST school by createdAt
 * because the User table requires a non-null schoolId. The platform
 * layer doesn't actually use that schoolId — every PlatformService
 * method is cross-tenant — but the FK has to point somewhere and a
 * deterministic placeholder beats a synthetic "platform" school. If
 * you're starting from an empty database, create one school first via
 * the regular registration flow, then run this script.
 *
 * Why a separate script (not a migration):
 *   • Migrations should be data-shape-only; baking secrets into them
 *     would put the password in source control.
 *   • The script is intentionally manual — there's no automatic path
 *     to mint a SUPER_ADMIN, which matches the spec ("never created
 *     from school UI").
 */
import { PrismaClient, Role } from '@prisma/client';
import { hash } from 'bcrypt';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!email || !password) {
    console.error(
      'Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD before running this script.',
    );
    process.exit(1);
  }
  if (password.length < 12) {
    console.error(
      'SUPER_ADMIN_PASSWORD must be at least 12 characters. Pick something stronger.',
    );
    process.exit(1);
  }

  // FK target — pick the oldest school as the placeholder tenant.
  // We resolve this BEFORE the email-existence check because emails
  // are now tenant-scoped (`@@unique([schoolId, email])`); the check
  // needs to be "is this email taken at the placeholder school?"
  // not "is this email taken anywhere on the platform?"
  const school = await prisma.school.findFirst({
    orderBy: { createdAt: 'asc' },
  });
  if (!school) {
    console.error(
      'No schools exist yet. Register at least one school via /auth/register-admin before seeding the SUPER_ADMIN.',
    );
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({
    where: { schoolId_email: { schoolId: school.id, email } },
  });
  if (existing) {
    if (existing.role === Role.SUPER_ADMIN) {
      console.log(`SUPER_ADMIN ${email} already exists. No changes made.`);
      return;
    }
    console.error(
      `User ${email} already exists at the placeholder school ` +
        `(${school.name}) with role ${existing.role}. ` +
        `Cannot promote via this script — drop the row manually or pick a different email.`,
    );
    process.exit(1);
  }

  const passwordHash = await hash(password, 12);
  const created = await prisma.user.create({
    data: {
      email,
      password: passwordHash,
      role: Role.SUPER_ADMIN,
      schoolId: school.id,
    },
  });

  console.log(`Created SUPER_ADMIN ${created.email} (id: ${created.id}).`);
  console.log(`FK schoolId: ${school.id} (placeholder — not consumed by /platform routes).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
