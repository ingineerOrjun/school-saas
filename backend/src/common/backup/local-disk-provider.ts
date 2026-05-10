import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { BackupStorageProvider } from './backup.types';

// ---------------------------------------------------------------------------
// LocalDiskProvider — Phase α.
//
// Writes backup artifacts to a local filesystem path. Designed for:
//   • Single-VPS deployments (most early Nepal schools).
//   • On-premises school deployments.
//   • Development.
//
// For multi-server / cloud deployments, swap this for an S3-compatible
// implementation against the same `BackupStorageProvider` interface.
//
// Storage path:
//   `BACKUP_DIR` env var (default `<cwd>/backups`). The service
//   ensures the directory exists at boot. Operators should mount a
//   separate volume here in production so backups survive a fresh
//   container.
//
// File naming:
//   `<key>.dump` — operator can list / inspect / restore directly
//   from the filesystem if the app is unreachable.
//
// SHA-256:
//   Computed during write via a pass-through stream so we don't
//   re-read the (potentially gigabyte-sized) file. The hash is what
//   the restore script verifies before piping to pg_restore.
// ---------------------------------------------------------------------------

@Injectable()
export class LocalDiskProvider implements BackupStorageProvider {
  readonly name = 'local';
  private readonly logger = new Logger(LocalDiskProvider.name);
  private readonly baseDir: string;

  constructor(config: ConfigService) {
    this.baseDir =
      config.get<string>('BACKUP_DIR') ??
      process.env.BACKUP_DIR ??
      join(process.cwd(), 'backups');
  }

  /** Ensure the base directory exists. Called by BackupService at boot. */
  async ensureReady(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  async put(input: {
    key: string;
    data: Buffer | NodeJS.ReadableStream;
    contentType?: string;
  }): Promise<{ location: string; sizeBytes: number; sha256: string }> {
    await this.ensureReady();
    const path = this.pathFor(input.key);
    const hash = createHash('sha256');
    let sizeBytes = 0;

    if (Buffer.isBuffer(input.data)) {
      hash.update(input.data);
      sizeBytes = input.data.byteLength;
      await fs.writeFile(path, input.data);
    } else {
      // Stream → file with simultaneous hashing. We don't pipe into
      // the hash — we tee: each chunk is written + hashed in one
      // pass. Avoids re-reading the artifact for the digest.
      // Local narrowing — TS doesn't keep the union narrowed
      // across the closure boundary below.
      const stream: NodeJS.ReadableStream = input.data;
      await new Promise<void>((resolve, reject) => {
        const out = createWriteStream(path);
        stream.on('data', (chunk: Buffer) => {
          hash.update(chunk);
          sizeBytes += chunk.byteLength;
        });
        stream.on('error', reject);
        out.on('error', reject);
        out.on('finish', () => resolve());
        stream.pipe(out);
      });
    }

    return {
      location: path,
      sizeBytes,
      sha256: hash.digest('hex'),
    };
  }

  async get(
    key: string,
  ): Promise<{ data: NodeJS.ReadableStream; sizeBytes: number }> {
    const path = this.pathFor(key);
    const stat = await fs.stat(path);
    return {
      data: createReadStream(path),
      sizeBytes: stat.size,
    };
  }

  async list(prefix: string, limit?: number): Promise<string[]> {
    await this.ensureReady();
    const entries = await fs.readdir(this.baseDir);
    const matches = entries
      .filter((name) => name.startsWith(prefix))
      .sort()
      .reverse();
    return limit ? matches.slice(0, limit) : matches;
  }

  async delete(key: string): Promise<void> {
    const path = this.pathFor(key);
    try {
      await fs.unlink(path);
    } catch (e) {
      // ENOENT is fine — caller wanted it gone, and it's gone.
      if ((e as { code?: string }).code !== 'ENOENT') {
        this.logger.warn(`Failed to delete ${path}: ${(e as Error).message}`);
      }
    }
  }

  /** Resolve the absolute path for a backup artifact. Public so the
   *  restore CLI can use the same convention. */
  pathFor(key: string): string {
    // Defensive: refuse path traversal. Keys are app-generated UUIDs
    // so this should never trip in practice.
    if (key.includes('..') || key.includes('/') || key.includes('\\')) {
      throw new Error(`Invalid backup key: ${key}`);
    }
    return join(this.baseDir, `${key}.dump`);
  }

  /** Operator-readable summary for the ops UI. */
  describe(): { provider: 'local'; baseDir: string } {
    return { provider: 'local', baseDir: this.baseDir };
  }
}
