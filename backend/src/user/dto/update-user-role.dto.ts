import { Role } from '@prisma/client';
import { IsEnum, IsIn } from 'class-validator';

/**
 * Only ADMIN, STAFF, and TEACHER transitions are permitted via this
 * endpoint. STUDENT and PARENT roles are issued through other flows
 * (student onboarding, parent invites) and shouldn't be assigned
 * arbitrarily from a settings UI.
 */
const ALLOWED_ROLES = [Role.ADMIN, Role.STAFF, Role.TEACHER] as const;

export class UpdateUserRoleDto {
  @IsEnum(Role)
  @IsIn(ALLOWED_ROLES as unknown as Role[], {
    message: `role must be one of: ${ALLOWED_ROLES.join(', ')}`,
  })
  role!: Role;
}
