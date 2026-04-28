import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

/**
 * Metadata key the RolesGuard reads to discover required roles for a
 * given handler. Kept in a constant so the decorator and the guard
 * stay perfectly in sync.
 */
export const ROLES_KEY = 'roles';

/**
 * Mark a handler (or controller class) as restricted to one or more
 * roles. The handler still needs `@UseGuards(JwtAuthGuard, RolesGuard)`
 * applied above for the guard to actually run.
 *
 * Example:
 *   @Roles(Role.ADMIN)
 *   @Patch('school')
 *   updateSchool(...) {}
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
