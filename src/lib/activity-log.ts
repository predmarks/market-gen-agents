import { db } from '@/db/client';
import { activityLog } from '@/db/schema';

export function inngestRunUrl(functionId: string, runId: string): string {
  if (process.env.NODE_ENV !== 'production') {
    return `http://localhost:8288/runs/${runId}`;
  }
  return `https://app.inngest.com/env/production/functions/${functionId}/logs/${runId}`;
}

export async function logActivity(
  action: string,
  opts: {
    entityType: string;
    entityId?: string;
    entityLabel?: string;
    detail?: Record<string, unknown>;
    source?: 'chat' | 'ui' | 'pipeline';
  },
): Promise<string | null> {
  try {
    const [row] = await db.insert(activityLog).values({
      action,
      entityType: opts.entityType,
      entityId: opts.entityId,
      entityLabel: opts.entityLabel,
      detail: opts.detail,
      source: opts.source ?? 'ui',
    }).returning({ id: activityLog.id });
    return row.id;
  } catch (err) {
    console.error('[activity-log] Failed to log:', action, err);
    return null;
  }
}
