import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { reviewJob } from '@/inngest/review-job';
import { ingestionJob } from '@/inngest/ingestion-job';
import { generationJob } from '@/inngest/generation-job';
import { suggestTopicJob } from '@/inngest/suggest-topic-job';
import { researchJob } from '@/inngest/research-job';
import { coalescenceJob } from '@/inngest/coalescence-job';
import { cronIngest } from '@/inngest/cron-ingest';
import { cronIngestLight } from '@/inngest/cron-ingest-light';
import { ingestionLightJob } from '@/inngest/ingestion-light-job';
import { resolutionJob } from '@/inngest/resolution-job';
import { cronResolution } from '@/inngest/cron-resolution';
import { newsletterJob } from '@/inngest/newsletter-job';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [reviewJob, ingestionJob, ingestionLightJob, generationJob, suggestTopicJob, researchJob, coalescenceJob, cronIngest, cronIngestLight, resolutionJob, cronResolution, newsletterJob],
});
