import { join } from "https://deno.land/std@0.224.0/path/mod.ts";
import { z } from "zod";
import { getDb, withTx } from "./db.ts";
import { makeLogger } from "../log.ts";
import { settingsGet } from "./repo/settings.ts";
import { getConfig } from "../config.ts";

const log = makeLogger("db.gc");

/**
 * Runs Garbage Collection (Retention) according to DATA_SCHEMA §7.
 * Should be called periodically (e.g. boot-idle).
 */
export async function runGc(): Promise<void> {
  const db = getDb();
  const settings = settingsGet();
  const runsPerProject = settings.retention.runsPerProject;

  log.info("Starting Retention GC...");

  // 1. Delete runs beyond runsPerProject per project, except pinned
  try {
    withTx((tx) => {
      // Find runs to delete: runs that are unpinned and rank > runsPerProject within their project
      const rankedRows = tx.prepare(`
        WITH RankedRuns AS (
          SELECT r.id as run_id,
                 ROW_NUMBER() OVER(PARTITION BY c.project_id ORDER BY r.started_at DESC) as rn,
                 COALESCE(m.pinned, 0) as is_pinned
          FROM runs r
          JOIN conversations c ON r.conversation_id = c.id
          LEFT JOIN messages m ON r.message_id = m.id
        )
        SELECT run_id FROM RankedRuns 
        WHERE rn > ? AND is_pinned = 0
      `).all(runsPerProject);
      const runsToDelete = z.array(z.object({ run_id: z.string() })).parse(rankedRows);

      if (runsToDelete.length > 0) {
        const stmt = tx.prepare(`DELETE FROM runs WHERE id = ?`);
        for (const row of runsToDelete) {
          stmt.run(row.run_id);
        }
        log.info(
          `GC: deleted ${runsToDelete.length} unpinned runs beyond limit (${runsPerProject})`,
        );
      }
    });
  } catch (err) {
    log.error("GC failed pruning runs", { error: String(err) });
  }

  // 2. Prune old events (older than 14 days)
  try {
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - fourteenDaysMs;
    const res = db.prepare(`DELETE FROM events WHERE ts < ?`).run(cutoff);
    if (res.changes > 0) {
      log.info(`GC: pruned ${res.changes} events older than 14 days`);
    }
  } catch (err) {
    log.error("GC failed pruning events", { error: String(err) });
  }

  // 3. Delete orphaned artifact files (DB wins)
  try {
    const cfg = getConfig();
    const artifactsDir = join(cfg.DATA_DIR, "artifacts");

    // Ensure dir exists
    try {
      await Deno.stat(artifactsDir);
    } catch {
      await Deno.mkdir(artifactsDir, { recursive: true });
    }

    const filesOnDisk = new Set<string>();
    for await (const entry of Deno.readDir(artifactsDir)) {
      if (entry.isFile) {
        filesOnDisk.add(entry.name);
      }
    }

    const dbArtifacts = z.array(z.object({ id: z.string(), format: z.string() })).parse(
      db.prepare(`SELECT id, format FROM artifacts`).all(),
    );
    const filesInDb = new Set<string>();

    for (const row of dbArtifacts) {
      filesInDb.add(`${row.id}.${row.format}`);
    }

    let orphanedDeleted = 0;
    for (const filename of filesOnDisk) {
      if (!filesInDb.has(filename)) {
        await Deno.remove(join(artifactsDir, filename)).catch(() => {});
        orphanedDeleted++;
      }
    }

    // Also check for DB artifacts missing on disk and delete DB row (reconcile both ways)
    let missingFilesDeleted = 0;
    withTx((tx) => {
      const stmt = tx.prepare(`DELETE FROM artifacts WHERE id = ?`);
      for (const row of dbArtifacts) {
        const filename = `${row.id}.${row.format}`;
        if (!filesOnDisk.has(filename)) {
          stmt.run(row.id);
          missingFilesDeleted++;
        }
      }
    });

    if (orphanedDeleted > 0 || missingFilesDeleted > 0) {
      log.info(
        `GC: orphaned artifacts sync (deleted ${orphanedDeleted} files, removed ${missingFilesDeleted} missing db rows)`,
      );
    }
  } catch (err) {
    log.error("GC failed syncing artifacts", { error: String(err) });
  }

  // 4. VACUUM if freelist > 20%
  try {
    const { page_count: pageCount } = z.object({ page_count: z.number() }).parse(
      db.prepare(`PRAGMA page_count`).get(),
    );
    const { freelist_count: freelistCount } = z.object({ freelist_count: z.number() }).parse(
      db.prepare(`PRAGMA freelist_count`).get(),
    );
    if (pageCount > 0 && freelistCount / pageCount > 0.20) {
      log.info(`GC: VACUUMing database (freelist ${freelistCount}/${pageCount})`);
      db.prepare(`VACUUM`).run();
    }
  } catch (err) {
    log.error("GC failed vacuum", { error: String(err) });
  }
}
