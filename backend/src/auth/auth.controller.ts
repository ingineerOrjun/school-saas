import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterAdminDto } from './dto/register-admin.dto';

/**
 * Phase 9 — sensitive endpoints carry tighter rate limits than the
 * global default. The buckets themselves are configured in
 * AppModule (`ThrottlerModule.forRoot`):
 *
 *   • register → 5 requests / hour / IP. Provisioning a new tenant
 *     is a high-impact, low-volume action — five per hour is well
 *     above legitimate usage and well below an enumeration attack.
 *   • login    → 10 requests / minute / IP. The login form will
 *     occasionally retry on a typo; ten per minute leaves
 *     headroom for that without becoming a credential-stuffing
 *     channel.
 *
 * The decorator targets a NAMED bucket so we don't accidentally
 * override the global default for everything else.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ register: { limit: 5, ttl: 60 * 60_000 } })
  register(@Body() dto: RegisterAdminDto) {
    return this.auth.registerAdmin(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }
}
