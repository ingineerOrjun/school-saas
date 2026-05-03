import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../database/prisma.service';
import { UpdateSchoolDto } from './dto/update-school.dto';

export interface SchoolDto {
  id: string;
  name: string;
  slug: string;
  /** Public URL (or null if no logo uploaded yet). */
  logoUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

const SCHOOL_SELECT = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Allowed image MIME types for the logo upload. */
const ALLOWED_LOGO_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);

/** Hard cap: 2 MB. School logos don't need to be huge. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

@Injectable()
export class SchoolService {
  constructor(private readonly prisma: PrismaService) {}

  async get(schoolId: string): Promise<SchoolDto> {
    const s = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: SCHOOL_SELECT,
    });
    if (!s) throw new NotFoundException('School not found.');
    return toDto(s);
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
      select: SCHOOL_SELECT,
    });
    return toDto(updated);
  }

  /**
   * Persist an uploaded logo to disk and update the School row's
   * `logoUrl` to a stable public path. The previous logo file (if any)
   * is best-effort deleted so we don't pile up orphaned uploads.
   *
   * `file` is whatever Multer's FileInterceptor handed to the
   * controller — we accept the minimal shape we actually need so this
   * file doesn't depend on Multer's types.
   */
  async setLogo(
    schoolId: string,
    file: {
      buffer: Buffer;
      mimetype: string;
      size: number;
      originalname: string;
    } | undefined,
  ): Promise<SchoolDto> {
    if (!file) {
      throw new BadRequestException('No file uploaded.');
    }
    if (!ALLOWED_LOGO_MIME.has(file.mimetype)) {
      throw new BadRequestException(
        'Logo must be a PNG, JPG, or WebP image.',
      );
    }
    if (file.size > MAX_LOGO_BYTES) {
      throw new BadRequestException(
        `Logo must be under ${Math.floor(MAX_LOGO_BYTES / 1024)} KB.`,
      );
    }

    // Find the school FIRST — fail fast on tenant mismatch before
    // committing the file to disk.
    const existing = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, logoUrl: true },
    });
    if (!existing) {
      throw new NotFoundException('School not found.');
    }

    // Pick the extension from MIME (more reliable than originalname).
    const ext = mimeToExt(file.mimetype);
    // Filename: schoolId + timestamp + ext. Including the timestamp
    // forces a new URL on every upload, which side-steps any HTTP
    // caching of the old logo.
    const filename = `${schoolId}-${Date.now()}.${ext}`;
    const dir = join(process.cwd(), 'uploads', 'logos');
    await fs.mkdir(dir, { recursive: true });
    const fullPath = join(dir, filename);
    await fs.writeFile(fullPath, file.buffer);

    const publicUrl = `/uploads/logos/${filename}`;

    const updated = await this.prisma.school.update({
      where: { id: schoolId },
      data: { logoUrl: publicUrl },
      select: SCHOOL_SELECT,
    });

    // Best-effort cleanup of the previous file. Failure here doesn't
    // matter — orphaned files are harmless and we already have the
    // new logo in place.
    if (existing.logoUrl && existing.logoUrl !== publicUrl) {
      const prev = existing.logoUrl.replace(/^\/uploads\//, '');
      const prevPath = join(process.cwd(), 'uploads', prev);
      void fs.unlink(prevPath).catch(() => {
        /* ignore */
      });
    }

    return toDto(updated);
  }

  /**
   * Clear the logo (used when an admin wants to revert to the placeholder).
   * Best-effort deletes the file too.
   */
  async clearLogo(schoolId: string): Promise<SchoolDto> {
    const existing = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, logoUrl: true },
    });
    if (!existing) throw new NotFoundException('School not found.');

    if (existing.logoUrl) {
      const rel = existing.logoUrl.replace(/^\/uploads\//, '');
      const fullPath = join(process.cwd(), 'uploads', rel);
      void fs.unlink(fullPath).catch(() => {
        /* ignore */
      });
    }

    const updated = await this.prisma.school.update({
      where: { id: schoolId },
      data: { logoUrl: null },
      select: SCHOOL_SELECT,
    });
    return toDto(updated);
  }
}

// ---------------------------------------------------------------------------

function toDto(row: {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SchoolDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logoUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mimeToExt(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/jpeg':
    case 'image/jpg':
    default:
      return 'jpg';
  }
}
