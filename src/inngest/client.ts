import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'predmarks-agents',
  isDev: process.env.NODE_ENV !== 'production',
});
