import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PaymentMethod, Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { AssignFeeDto } from './dto/assign-fee.dto';
import { CreateFeeStructureDto } from './dto/create-fee-structure.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { UpdateFeeAssignmentDto } from './dto/update-fee-assignment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { FeesService } from './fees.service';

/**
 * The entire fees module is admin-only — fee structures, assignments,
 * payments, dues, and receipts. Teachers don't deal with money.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class FeesController {
  constructor(private readonly fees: FeesService) {}

  // ---------- Fee structures ----------

  @Post('fees/structure')
  @HttpCode(HttpStatus.CREATED)
  createStructure(
    @Body() dto: CreateFeeStructureDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fees.createStructure(dto, user.schoolId);
  }

  @Get('fees/structure')
  listStructures(@CurrentUser() user: AuthenticatedUser) {
    return this.fees.listStructures(user.schoolId);
  }

  // ---------- Assignment ----------

  @Post('fees/assign')
  @HttpCode(HttpStatus.CREATED)
  assignFee(
    @Body() dto: AssignFeeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fees.assignFee(dto, user.schoolId);
  }

  /**
   * Edit the discount on a single assignment. Rejected with 400 if the
   * assignment already has payments — once money has moved, the discount
   * is part of the frozen record.
   */
  @Patch('fees/assignments/:id')
  updateAssignmentDiscount(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFeeAssignmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fees.updateAssignmentDiscount(id, dto, user.schoolId);
  }

  // ---------- Student fee view ----------

  @Get('fees/student/:id')
  getStudentFees(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fees.getStudentFees(id, user.schoolId);
  }

  // ---------- Payments ----------

  @Post('payments')
  @HttpCode(HttpStatus.CREATED)
  recordPayment(
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fees.recordPayment(dto, user.schoolId, user.id);
  }

  /**
   * Edit a payment's non-financial annotations (notes, method).
   * Rejected with 400 if the caller tries to reassign a General Credit
   * payment (feeAssignmentId was null) onto a specific fee — credit
   * history is immutable.
   */
  @Patch('payments/:id')
  updatePayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fees.updatePayment(id, dto, user.schoolId, user.id);
  }

  @Get('payments/:id/receipt')
  getReceipt(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fees.getReceipt(id, user.schoolId);
  }

  /**
   * Refund a payment.
   *
   * INTENTIONAL: there is NO `DELETE /payments/:id` endpoint, and never
   * will be. Once a receipt is issued, the row is immutable — that's
   * what makes the receipt a trustworthy artifact. To reverse a
   * payment, callers POST a refund here, which writes a NEW negative
   * row linked to the source. See the rationale on `FeesService.refundPayment`.
   */
  @Post('payments/:id/refund')
  @HttpCode(HttpStatus.CREATED)
  refundPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fees.refundPayment(id, dto, user.schoolId, user.id);
  }

  // ---------- Dues dashboard ----------

  @Get('fees/dues')
  getDues(@CurrentUser() user: AuthenticatedUser) {
    return this.fees.getDues(user.schoolId);
  }

  // ---------- Summary cards / dashboard ----------

  @Get('fees/summary')
  getSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.fees.getSummary(user.schoolId);
  }

  /**
   * Today's-collection snapshot for the cashier workspace stats bar.
   * Optional `?date=YYYY-MM-DD` lets admins look back at a previous day
   * without a separate endpoint; defaults to today.
   */
  @Get('fees/cashier-summary')
  getCashierSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query('date') date?: string,
  ) {
    return this.fees.getCashierSummary(user.schoolId, date);
  }

  // ---------- Payment history (global, filterable, paginated) ----------

  /**
   * Powers the `/fees/payments` history page. Query params are all
   * optional; service caps `pageSize` at 100 and clamps `page` to ≥ 1.
   *
   * The strings come in via `@Query` so they're always strings on the
   * wire — we coerce `page`/`pageSize` to numbers here rather than
   * burdening the service with parsing.
   */
  @Get('payments')
  listPayments(
    @CurrentUser() user: AuthenticatedUser,
    @Query('q') q?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('method') method?: PaymentMethod,
    @Query('classId') classId?: string,
    @Query('studentId') studentId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.fees.listPayments(user.schoolId, {
      q,
      fromDate,
      toDate,
      method,
      classId,
      studentId,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }
}
