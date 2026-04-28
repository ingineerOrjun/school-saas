import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { UpdateSchoolDto } from './dto/update-school.dto';

export interface SchoolDto {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class SchoolService {
  constructor(private readonly prisma: PrismaService) {}

  async get(schoolId: string): Promise<SchoolDto> {
    const s = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!s) throw new NotFoundException('School not found.');
    return {
      id: s.id,
      name: s.name,
      slug: s.slug,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  /**
   * Update mutable school profile fields. Slug is intentionally
   * immutable here — changing it would break tenant identity and any
   * URLs that already exist.
   */
  async update(
    schoolId: string,
    dto: UpdateSchoolDto,
  ): Promise<SchoolDto> {
    // Reject empty updates so callers don't hit the DB for nothing.
    if (dto.name === undefined) {
      return this.get(schoolId);
    }

    const updated = await this.prisma.school.update({
      where: { id: schoolId },
      data: { name: dto.name },
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }
}
