import { Role } from '@prisma/client';

/**
 * Shape of the signed JWT payload.
 *
 * Every authenticated request carries (userId, role, schoolId) — which is the
 * minimum needed to enforce tenant isolation and RBAC without an extra DB hit.
 */
export interface JwtPayload {
  userId: string;
  role: Role;
  schoolId: string;
}
