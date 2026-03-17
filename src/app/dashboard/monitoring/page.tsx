'use client';

import { SourcingTrigger, SourcingLog, useSourcingData } from './_components/SourcingPanel';
import { MonitoringDashboard } from './_components/MonitoringDashboard';

export default function MonitoringPage() {
  const { runs, candidateCap, loading, triggering, hasRunning, handleTrigger } = useSourcingData();

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Monitoreo</h1>
        <SourcingTrigger
          candidateCap={candidateCap}
          triggering={triggering}
          hasRunning={hasRunning}
          onTrigger={handleTrigger}
        />
      </div>
      <MonitoringDashboard />
      <SourcingLog runs={runs} loading={loading} />
    </div>
  );
}
