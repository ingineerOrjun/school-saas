import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role, School, User } from '@prisma/client';
import { randomBytes } from 'crypto';
import { HashingService } from '../common/hashing/hashing.service';
import { PrismaService } from '../database/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterAdminDto } from './dto/register-admin.dto';
import type { JwtPayload } from './types/jwt-payload';

export type SafeUser = Omit<User, 'password'>;

export interface AuthResult {
  accessToken: string;
  user: SafeUser;
  school: School;
}

export type RegisterAdminResult = AuthResult;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Provision a new tenant (School) together with its first ADMIN user.
   * Runs inside a transaction so a partial school/user state is impossible.
   * Auto-issues a JWT so the client can sign the admin in immediately.
   */
  async registerAdmin(dto: RegisterAdminDto): Promise<RegisterAdminResult> {
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

    return {
      school,
      user: this.stripPassword(user),
      accessToken: this.issueToken(user),
    };
  }

  /**
   * Validate email + password and issue a JWT.
   * Uses a single generic error message for both "email not found" and
   * "wrong password" to avoid leaking whether an account exists.
   */
  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { school: true },
    });

    const passwordOk =
      !!user && (await this.hashing.compare(dto.password, user.password));

    if (!user || !passwordOk) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const { school, ...userWithoutSchool } = user;

    return {
      user: this.stripPassword(userWithoutSchool),
      school,
      accessToken: this.issueToken(user),
    };
  }

  private issueToken(user: Pick<User, 'id' | 'role' | 'schoolId'>): string {
    const payload: JwtPayload = {
      userId: user.id,
      role: user.role,
      schoolId: user.schoolId,
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
