import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { reviewJob } from '@/inngest/review-job';
import { ingestionJob } from '@/inngest/ingestion-job';
import { generationJob } from '@/inngest/generation-job';
import { suggestTopicJob } from '@/inngest/suggest-topic-job';
import { cronIngest } from '@/inngest/cron-ingest';
import { resolutionJob } from '@/inngest/resolution-job';
import { cronResolution } from '@/inngest/cron-resolution';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [reviewJob, ingestionJob, generationJob, suggestTopicJob, cronIngest, resolutionJob, cronResolution],
});
