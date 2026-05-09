import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role, School, User } from '@prisma/client';
import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { HashingService } from '../common/hashing/hashing.service';
import { PrismaService } from '../database/prisma.service';
import { HealthService } from '../health/health.service';
import { NotificationService } from '../notifications/notification.service';
import { PlatformService } from '../platform/platform.service';
import { SessionService } from '../sessions/session.service';
import { LoginDto } from './dto/login.dto';
import { RegisterAdminDto } from './dto/register-admin.dto';
import type { JwtPayload } from './types/jwt-payload';

export type SafeUser = Omit<User, 'password'>;

/**
 * Optional teacher context — present only when the authenticated user
 * is a TEACHER. Lets the frontend route appropriately on login (e.g.
 * unassigned teachers → "ask admin to assign you" page).
 *
 * Source of truth is the `TeachingAssignment` table — NOT the legacy
 * `Teacher.classId/sectionId` columns. The legacy columns are kept on
 * the row for backward compat but no permission/routing decision reads
 * them anymore.
 */
export interface TeacherContext {
  /**
   * True when the teacher has at least one TeachingAssignment row.
   * Drives the "ask admin to assign you" landing — `landingFor` on the
   * frontend uses this to pick /attendance vs the unassigned hero.
   */
  hasAssignments: boolean;
  /**
   * "Primary" class ID derived from the FIRST assignment (createdAt
   * order). Null when there are no assignments. Used only for
   * deep-linking the post-login landing page; permission checks
   * always re-resolve via TeacherScopeService.
   */
  classId: string | null;
  /** First assignment's sectionId (or null if class-bound). */
  sectionId: string | null;
}

export interface AuthResult {
  accessToken: string;
  user: SafeUser;
  school: School;
  /** Populated only for TEACHER users, otherwise null. */
  teacher: TeacherContext | null;
}

export type RegisterAdminResult = AuthResult;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
    private readonly jwt: JwtService,
    private readonly health: HealthService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * Provision a new tenant (School) together with its first ADMIN user.
   * Runs inside a transaction so a partial school/user state is impossible.
   * Auto-issues a JWT so the client can sign the admin in immediately.
   *
   * `ip` / `userAgent` are snapshotted onto the new session row so
   * the user's first session shows up in their session list with
   * the right origin info.
   */
  async registerAdmin(
    dto: RegisterAdminDto,
    ctx: { ip?: string | null; userAgent?: string | null } = {},
  ): Promise<RegisterAdminResult> {
    const { email, password, schoolName } = dto;

    await this.assertEmailAvailable(email);

    const passwordHash = await this.hashing.hash(password);
    const slug = await this.resolveUniqueSlug(schoolName);

    const { school, user } = await this.prisma.$transaction(async (tx) => {
      const school = await tx.school.create({
        data: { name: schoolName, slug },
      });

      const user = await tx.user.create({
        data: {
          email,
          password: passwordHash,
          role: Role.ADMIN,
          schoolId: school.id,
        },
      });

      return { school, user };
    });

    // Phase 3 (maturity) — welcome email to the new school admin.
    // Best-effort: a delivery failure does NOT roll back the
    // registration. Dedupe by user id so a network retry on the
    // same registration won't send twice.
    try {
      await this.notifications.enqueue({
        templateKey: 'platform.school_created',
        recipients: { email: user.email },
        dedupeKey: `user:${user.id}:welcome`,
        schoolId: school.id,
        userId: user.id,
        payload: {
          brand: this.config.get('mail.brand'),
          schoolName: school.name,
          adminEmail: user.email,
          loginUrl: `${this.config.get('appUrl')}/login`,
        },
      });
    } catch {
      /* swallow — registration must succeed regardless of email */
    }

    return {
      school,
      user: this.stripPassword(user),
      accessToken: await this.issueToken(user, ctx),
      // A freshly-registered ADMIN never has a teacher record.
      teacher: null,
    };
  }

  /**
   * Validate email + password and issue a JWT.
   * Uses a single generic error message for both "email not found" and
   * "wrong password" to avoid leaking whether an account exists.
   *
   * Phase 10 — login failures are recorded into the in-memory health
   * ring buffer with the source IP, so the platform health dashboard
   * can surface brute-force / credential-stuffing patterns. The
   * record never carries a password (or anything other than email +
   * IP); audit-grade detail lives in server logs.
   *
   * Phase 17 follow-up — every successful login creates a Session
   * row with the source IP + user-agent snapshot. The JWT carries
   * the session's id as `sid`; the strategy rejects tokens whose
   * session has been revoked.
   */
  async login(
    dto: LoginDto,
    ip: string | null = null,
    userAgent: string | null = null,
  ): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { school: true },
    });

    const passwordOk =
      !!user && (await this.hashing.compare(dto.password, user.password));

    if (!user || !passwordOk) {
      this.health.recordLoginFailure({
        email: dto.email,
        ip,
        reason: 'invalid_credentials',
      });
      throw new UnauthorizedException('Invalid email or password.');
    }

    const { school, ...userWithoutSchool } = user;

    // Tenant gate: a SUSPENDED or EXPIRED school blocks ALL of its
    // users from logging in (including the school's own ADMIN). The
    // SUPER_ADMIN role is exempt — platform owners aren't tied to a
    // tenant and the gate is for tenants only. The platform layer
    // owns the only path that flips a school to either status, so
    // this enforcement is the corresponding read-side check.
    if (user.role !== Role.SUPER_ADMIN) {
      try {
        PlatformService.assertSchoolCanLogin(school.status);
      } catch (err) {
        this.health.recordLoginFailure({
          email: dto.email,
          ip,
          reason: 'school_blocked',
        });
        throw err;
      }
    }

    // For TEACHER users, derive the landing context from
    // TeachingAssignment (the only source of truth — the legacy
    // Teacher.classId/sectionId columns were dropped). First
    // assignment by createdAt is the "primary" landing class.
    //
    // HARD GUARD: a TEACHER with zero TeachingAssignment rows is
    // blocked at the door with a 403. Admins must assign at least one
    // class/subject before the teacher can sign in. This eliminates
    // the "logged in but stranded with no permissions" state and
    // matches the spec's stable-by-construction requirement.
    let teacher: TeacherContext | null = null;
    if (user.role === Role.TEACHER) {
      const t = await this.prisma.teacher.findFirst({
        where: { userId: user.id, schoolId: user.schoolId },
        select: {
          assignments: {
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { classId: true, sectionId: true },
          },
        },
      });
      const first = t?.assignments[0] ?? null;
      if (!first) {
        throw new ForbiddenException(
          'No class/subject assigned. Contact admin.',
        );
      }
      teacher = {
        hasAssignments: true,
        classId: first.classId,
        sectionId: first.sectionId,
      };
    }

    return {
      user: this.stripPassword(userWithoutSchool),
      school,
      accessToken: await this.issueToken(user, { ip, userAgent }),
      teacher,
    };
  }

  /**
   * Mint a JWT for a user and back it with a fresh Session row.
   * The session's id is encoded into the token's `sid` claim so the
   * strategy can look it up + reject if revoked.
   */
  private async issueToken(
    user: Pick<User, 'id' | 'role' | 'schoolId'>,
    ctx: { ip?: string | null; userAgent?: string | null } = {},
  ): Promise<string> {
    const session = await this.sessions.create({
      userId: user.id,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    const payload: JwtPayload = {
      userId: user.id,
      role: user.role,
      schoolId: user.schoolId,
      sid: session.id,
    };
    return this.jwt.sign(payload);
  }

  private async assertEmailAvailable(email: string): Promise<void> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists.');
    }
  }

  private async resolveUniqueSlug(name: string): Promise<string> {
    const base = this.slugify(name);
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${this.randomSuffix()}`;
      const clash = await this.prisma.school.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!clash) return candidate;
    }
    return `${base}-${this.randomSuffix()}`;
  }

  private slugify(name: string): string {
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    return slug || 'school';
  }

  private randomSuffix(): string {
    return randomBytes(2).toString('hex');
  }

  private stripPassword(user: User): SafeUser {
    const { password: _password, ...safe } = user;
    return safe;
  }
}
