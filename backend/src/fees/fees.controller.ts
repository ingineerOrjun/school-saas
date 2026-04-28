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
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { AssignFeeDto } from './dto/assign-fee.dto';
import { CreateFeeStructureDto } from './dto/create-fee-structure.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdateFeeAssignmentDto } from './dto/update-fee-assignment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { FeesService } from './fees.service';

@Controller()
@UseGuards(JwtAuthGuard)
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
    return this.fees.recordPayment(dto, user.schoolId);
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
    return this.fees.updatePayment(id, dto, user.schoolId);
  }

  @Get('payments/:id/receipt')
  getReceipt(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fees.getReceipt(id, user.schoolId);
  }

  // ---------- Dues dashboard ----------

  @Get('fees/dues')
  getDues(@CurrentUser() user: AuthenticatedUser) {
    return this.fees.getDues(user.schoolId);
  }
}
