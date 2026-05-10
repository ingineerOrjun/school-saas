import { Injectable } from '@nestjs/common';
import type { SnapshotMetadata } from './backup.types';

// ---------------------------------------------------------------------------
// BackupStubService — Phase 22 (Section 11) placeholder.
//
// Returns an empty snapshot list + a "not configured" capability
// flag. The Operations Center UI renders a placeholder card backed
// by this service so the panel exists from day one — and replacing
// the stub with a real implementation is one DI swap.
//
// Why a stub (not a TODO):
//   • The frontend route + types are stable, so a real implementation
//     can ship without a frontend change.
//   • The placeholder renders a useful "not configured — see docs"
//     state instead of breaking the page.
// ---------------------------------------------------------------------------

export interface BackupCapability {
  configured: boolean;
  storageProvider: string | null;
  /** "Last successful backup" timestamp shown on the card. Null when never. */
  lastSuccessAt: string | null;
  /** Operator-readable reason when the panel is in placeholder mode. */
  notice: string;
}

@Injectable()
export class BackupStubService {
  /**
   * Capability snapshot for the Operations Center card. Returns
   * `configured: false` until a real provider lands.
   */
  capability(): BackupCapability {
    return {
      configured: false,
      storageProvider: null,
      lastSuccessAt: null,
      notice:
        'Backup engine not yet configured. The disaster-recovery surface is wired (interfaces, UI placeholder, audit hooks) — pair with a storage provider implementation to enable.',
    };
  }

  /** Snapshot list — empty for the stub. */
  listSnapshots(): SnapshotMetadata[] {
    return [];
  }
}
