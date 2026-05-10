import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { AnnouncementService } from './announcement.service';
import { BrandConfigService } from './brand-config.service';
import {
  AcceptInvitationDto,
  CreateExportDto,
  CreateGuardianDto,
  CreateInvitationDto,
  DryRunImportDto,
  LinkGuardianDto,
  SetOnboardingStepDto,
  UpdateBrandingDto,
  UpdateGuardianDto,
} from './dto/dto';
import { ExportService } from './export.service';
import { GuardianService } from './guardian.service';
import { ImportService } from './import.service';
import { InvitationService } from './invitation.service';
import { OnboardingService } from './onboarding.service';

// ---------------------------------------------------------------------------
// School-side productization endpoints. Mounted at /me to live next
// to the existing school-side surface. Routes:
//
//   /me/onboarding              — Section 1
//   /me/invitations             — Section 2 (admin only)
//   /me/invitations/preview/... — Section 2 (anonymous preview)
//   /me/invitations/accept      — Section 2 (anonymous accept)
//   /me/branding                — Section 3 (admin only)
//   /me/announcements           — Section 7 (read + dismiss)
//   /me/guardians               — Section 12 (admin only)
//   /me/exports                 — Section 8 (admin only)
//   /me/imports                 — Section 9 (admin only)
//
// Three of these (preview, accept, /me/announcements public read)
// have their own auth posture — see method-level decorators.
// ---------------------------------------------------------------------------

@Controller('me')
export class SchoolProductizationController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly invitations: InvitationService,
    private readonly branding: BrandConfigService,
    private readonly announcements: AnnouncementService,
    private readonly guardians: GuardianService,
    private readonly exports: ExportService,
    private readonly imports: ImportService,
  ) {}

  // ---------- Onboarding ----------

  @Get('onboarding')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  getOnboardingStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.onboarding.getStatus(user.schoolId);
  }

  @Patch('onboarding/step')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  setOnboardingStep(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetOnboardingStepDto,
  ) {
    return this.onboarding.setStep(user.schoolId, dto.step as never);
  }

  @Post('onboarding/complete')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  completeOnboarding(@CurrentUser() user: AuthenticatedUser) {
    return this.onboarding.complete(user.schoolId);
  }

  // ---------- Invitations ----------

  @Post('invitations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  createInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitations.invite({
      schoolId: user.schoolId,
      email: dto.email,
      role: dto.role,
      displayName: dto.displayName,
      invitedById: user.id,
    });
  }

  @Get('invitations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  listInvitations(@CurrentUser() user: AuthenticatedUser) {
    return this.invitations.listForSchool(user.schoolId);
  }

  @Post('invitations/:id/resend')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async resendInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    // Resend uses the same `invite()` path — fetch the row to get
    // the email + role + displayName.
    const all = await this.invitations.listForSchool(user.schoolId);
    const existing = all.find((i) => i.id === id);
    if (!existing) {
      throw new NotFoundException('Invitation not found.');
    }
    return this.invitations.invite({
      schoolId: user.schoolId,
      email: existing.email,
      role: existing.role,
      displayName: existing.displayName ?? undefined,
      invitedById: user.id,
    });
  }

  @Delete('invitations/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  revokeInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.invitations.revoke({
      invitationId: id,
      schoolId: user.schoolId,
    });
  }

  // ---------- Public invitation surface ----------
  // These two are intentionally unauthenticated — the recipient
  // doesn't have a session yet.

  @Get('invitations/preview/:token')
  async previewInvitation(@Param('token') token: string) {
    const preview = await this.invitations.preview(token);
    if (!preview) throw new NotFoundException('Invitation not found.');
    return preview;
  }

  @Post('invitations/accept')
  @HttpCode(HttpStatus.OK)
  async acceptInvitation(@Body() dto: AcceptInvitationDto, @Req() _req: Request) {
    // Returns the user; the frontend follows up with /auth/login or
    // we could mint a token here. Keep it small for v1 — the
    // accept page redirects to /login with the email pre-filled.
    return this.invitations.accept({
      token: dto.token,
      password: dto.password,
      displayName: dto.displayName,
    });
  }

  // ---------- Branding ----------

  @Get('branding')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  getBranding(@CurrentUser() user: AuthenticatedUser) {
    return this.branding.forSchool(user.schoolId);
  }

  @Patch('branding')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  setBranding(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateBrandingDto,
  ) {
    return this.branding.setForSchool(user.schoolId, dto);
  }

  // ---------- Announcements ----------

  @Get('announcements')
  @UseGuards(JwtAuthGuard)
  listActiveAnnouncements(@CurrentUser() user: AuthenticatedUser) {
    return this.announcements.listActiveFor({
      userId: user.id,
      schoolId: user.schoolId,
      role: user.role,
    });
  }

  @Post('announcements/:id/dismiss')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  dismissAnnouncement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.announcements.dismiss({
      announcementId: id,
      userId: user.id,
    });
  }

  // ---------- Guardians ----------

  @Get('guardians')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.TEACHER)
  listGuardians(@CurrentUser() user: AuthenticatedUser) {
    return this.guardians.list(user.schoolId);
  }

  @Post('guardians')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  createGuardian(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateGuardianDto,
  ) {
    return this.guardians.create({ schoolId: user.schoolId, ...dto });
  }

  @Patch('guardians/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  updateGuardian(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGuardianDto,
  ) {
    return this.guardians.update({
      schoolId: user.schoolId,
      guardianId: id,
      ...dto,
    });
  }

  @Delete('guardians/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeGuardian(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.guardians.remove({ schoolId: user.schoolId, guardianId: id });
  }

  @Post('guardians/:id/links')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  linkGuardian(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkGuardianDto,
  ) {
    return this.guardians.link({
      schoolId: user.schoolId,
      guardianId: id,
      studentId: dto.studentId,
      isPrimary: dto.isPrimary,
      relationship: dto.relationship,
    });
  }

  @Delete('guardians/:guardianId/links/:studentId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async unlinkGuardian(
    @CurrentUser() user: AuthenticatedUser,
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    await this.guardians.unlink({
      schoolId: user.schoolId,
      guardianId,
      studentId,
    });
  }

  @Get('students/:studentId/guardians')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.TEACHER)
  listGuardiansForStudent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.guardians.listForStudent({
      schoolId: user.schoolId,
      studentId,
    });
  }

  // ---------- Exports ----------

  @Post('exports')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  createExport(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateExportDto,
  ) {
    return this.exports.request({
      schoolId: user.schoolId,
      requestedById: user.id,
      entity: dto.entity,
      format: dto.format,
    });
  }

  @Get('exports')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  listExports(@CurrentUser() user: AuthenticatedUser) {
    return this.exports.list(user.schoolId);
  }

  @Get('exports/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  getExport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.exports.get({ schoolId: user.schoolId, runId: id });
  }

  // ---------- Imports ----------

  @Post('imports/dry-run')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  dryRunImport(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DryRunImportDto,
  ) {
    return this.imports.dryRun({
      schoolId: user.schoolId,
      requestedById: user.id,
      entity: dto.entity,
      filename: dto.filename,
      csv: dto.csv,
    });
  }

  @Post('imports/:id/commit')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  commitImport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.imports.commit({ schoolId: user.schoolId, runId: id });
  }

  @Get('imports')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  listImports(@CurrentUser() user: AuthenticatedUser) {
    return this.imports.list(user.schoolId);
  }
}
