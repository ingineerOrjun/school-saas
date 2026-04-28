import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../database/prisma.service';
import type { JwtPayload } from './types/jwt-payload';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  schoolId: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('auth.jwtSecret'),
    });
  }

  /**
   * Passport calls `validate` with the decoded payload. We re-check the user
   * exists and still belongs to the claimed school — the returned value is
   * attached to `req.user`.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, role: true, schoolId: true },
    });

    if (!user || user.schoolId !== payload.schoolId) {
      throw new UnauthorizedException('Token is no longer valid.');
    }

    return user;
  }
}
