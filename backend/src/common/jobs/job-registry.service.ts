import { Injectable, Logger } from '@nestjs/common';
import type { JobHandler } from './job-handler.interface';

// ---------------------------------------------------------------------------
// JobRegistry — name → handler lookup.
//
// Handlers register themselves at boot via `register()`. The runner
// asks the registry for the handler matching a row's `name` column.
// Unknown names are surfaced loudly — that's a programmer error, not
// a delivery failure (the producer enqueued a job whose handler
// isn't compiled into this build).
//
// Registration ordering doesn't matter — handlers can register
// before or after the runner starts polling. We intentionally don't
// auto-discover via decorators because the static handler list keeps
// the wiring explicit and grep-able.
// ---------------------------------------------------------------------------

@Injectable()
export class JobRegistry {
  private readonly logger = new Logger(JobRegistry.name);
  private readonly handlers = new Map<string, JobHandler>();

  register(handler: JobHandler): void {
    if (this.handlers.has(handler.name)) {
      this.logger.warn(
        `Handler for "${handler.name}" already registered — replacing.`,
      );
    }
    this.handlers.set(handler.name, handler);
    this.logger.log(`Registered job handler: ${handler.name}`);
  }

  get(name: string): JobHandler | undefined {
    return this.handlers.get(name);
  }

  /** All registered handler names — used by the metrics endpoint. */
  list(): string[] {
    return [...this.handlers.keys()];
  }
}
