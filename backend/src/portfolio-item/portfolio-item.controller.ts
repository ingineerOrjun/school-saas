import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { FeatureKey } from '../feature-flags/feature-catalog';
import { FeatureFlagsGuard } from '../feature-flags/feature-flags.guard';
import { RequireFeature } from '../feature-flags/require-feature.decorator';
import { CreatePortfolioItemDto } from './dto/create-portfolio-item.dto';
import { ListPortfolioItemsDto } from './dto/list-portfolio-items.dto';
import { UpdatePortfolioItemDto } from './dto/update-portfolio-item.dto';
import { PortfolioItemService } from './portfolio-item.service';

// ============================================================================
// PortfolioItemController — CDC portfolio-item write surface.
//
// Three endpoints, all gated identically (mirrors
// ContinuousRecordController one-for-one so the security envelope is
// trivially reviewable):
//
//   • POST   /portfolio-items       — create
//   • PATCH  /portfolio-items/:id   — description-only edit
//   • GET    /portfolio-items       — list by (student, session)
//
// Guard stack:
//   1. JwtAuthGuard       — 401 without a valid Bearer token.
//   2. RolesGuard         — 403 for roles outside @Roles.
//   3. FeatureFlagsGuard  — 403 with the standard feature-disabled
//                            copy when conEvaluation is off.
//
// Roles allowed (same set as ContinuousRecordController):
//   • TEACHER     — primary writer; per-call scope enforced by
//                   TeacherScopeService.assertPortfolioItemAccess
//                   (subject required iff outcomeId is in play).
//   • STAFF       — school-wide academic ops bypass for scope check.
//   • ADMIN       — full bypass.
//   • SUPER_ADMIN — allowed on this controller for cross-school
//                   inspection / support paths.
//
// No DELETE endpoint — intentional, Session 4 is read+append+patch only.
// Future ADMIN-grade delete surface lives in its own session.
// ============================================================================

@Controller('portfolio-items')
@UseGuards(JwtAuthGuard, RolesGuard, FeatureFlagsGuard)
@RequireFeature(FeatureKey.ConEvaluation)
export class PortfolioItemController {
  constructor(private readonly portfolio: PortfolioItemService) {}

  /**
   * POST /portfolio-items — create a new portfolio item.
   * Returns 201 with the created row (Nest's default for POST).
   *
   * Documented failure modes:
   *   • 400 — DTO validation (whitelist + forbidNonWhitelisted),
   *           session locked, occurredOn outside window.
   *   • 403 — feature flag off, role rejected, teacher scope failed.
   *   • 404 — student / session / outcome not found in tenant.
   */
  @Post()
  @Roles(Role.TEACHER, Role.STAFF, Role.ADMIN, Role.SUPER_ADMIN)
  create(
    @Body() dto: CreatePortfolioItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.portfolio.create(dto, user);
  }

  /**
   * PATCH /portfolio-items/:id — description-only edit.
   *
   * Any field other than `description` in the body is rejected with
   * 400 by the global ValidationPipe's `forbidNonWhitelisted`. The
   * service also re-asserts this (defense in depth) so test cases
   * documenting the contract pass even if the pipe ever gets
   * misconfigured.
   *
   * Documented failure modes:
   *   • 400 — DTO validation, extra body fields, session locked.
   *   • 403 — feature flag off, role rejected, teacher scope failed.
   *   • 404 — item not found OR item belongs to another school
   *           (tenant isolation surfaces as 404, not 403, to avoid
   *           cross-tenant existence disclosure).
   */
  @Patch(':id')
  @Roles(Role.TEACHER, Role.STAFF, Role.ADMIN, Role.SUPER_ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePortfolioItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.portfolio.update(id, dto, user);
  }

  /**
   * GET /portfolio-items?studentId=&sessionId=&outcomeId=&limit=&offset=
   *
   * Returns the items for that student in that session, ordered
   *   `occurredOn DESC, createdAt DESC`.
   * Optionally narrowed by outcomeId. Paginated via limit (default
   * 50, max 200) and offset (default 0).
   *
   * Items include the linked outcome (id, unit/description metadata,
   * subjectCode, classLevel) and the createdBy user's identity
   * (id + email — User has no `name` column on this schema).
   */
  @Get()
  @Roles(Role.TEACHER, Role.STAFF, Role.ADMIN, Role.SUPER_ADMIN)
  list(
    @Query() query: ListPortfolioItemsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.portfolio.list(query, user);
  }
}
