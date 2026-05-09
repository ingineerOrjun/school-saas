import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { SessionService } from './session.service';

// ---------------------------------------------------------------------------
// SessionsController — Phase 17 follow-up.
//
// School-side "/me/sessions" surface for users to see + revoke their
// own active sessions. Distinct from any platform-tier session
// management — operators reach into other users' sessions through
// the existing SecurityService (extended in this phase).
//
// Routes:
//   GET    /me/sessions              — list my active + recent sessions
//   POST   /me/sessions/:id/revoke   — revoke ONE of my sessions
//   POST   /me/sessions/revoke-others — revoke every session except
//                                       the calling one ("log out
//                                       everywhere except here")
//
// Security:
//   The `expectUserId` filter on SessionService.revoke ensures a
//   user can only revoke sessions they own. Trying to revoke another
//   user's session id surfaces as a NotFoundException (the same
//   shape as a non-existent id) to avoid leaking session id space.
// ---------------------------------------------------------------------------

class RevokeSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

@Controller('me/sessions')
@UseGuards(JwtAuthGuard)
export class SessionsController {
  constructor(private readonly sessions: SessionService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    const rows = await this.sessions.listForUser(user.id);
    return {
      // Convenience flag so the UI can mark "this is the session
      // you're using right now."
      currentSessionId: user.sessionId ?? null,
      sessions: rows,
    };
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevokeSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sessions.revoke({
      sessionId: id,
      reason: dto.reason ?? 'user revoke',
      expectUserId: user.id,
    });
  }

  @Post('revoke-others')
  @HttpCode(HttpStatus.OK)
  async revokeOthers(@CurrentUser() user: AuthenticatedUser) {
    if (!user.sessionId) {
      // Legacy token without a sid — without it we can't tell which
      // session to KEEP, and "log out everywhere" without an
      // exception would also kill the calling session. Reject
      // until the user logs in again to get a fresh sid token.
      throw new ForbiddenException(
        'Re-login required before revoking other sessions.',
      );
    }
    return this.sessions.revokeAllForUser({
      userId: user.id,
      reason: 'user revoke-others',
      exceptSessionId: user.sessionId,
    });
  }
}
