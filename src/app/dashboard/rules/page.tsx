export const dynamic = 'force-dynamic';

import { db } from '@/db/client';
import { rules } from '@/db/schema';
import { HARD_RULES, SOFT_RULES } from '@/config/rules';

interface RuleRow {
  id: string;
  type: string;
  description: string;
  check: string;
  enabled: boolean;
}

export default async function RulesPage() {
  let allRules: RuleRow[];

  try {
    const rows = await db.select().from(rules);
    if (rows.length > 0) {
      allRules = rows;
    } else {
      allRules = [...HARD_RULES, ...SOFT_RULES].map((r) => ({ ...r, enabled: true }));
    }
  } catch {
    allRules = [...HARD_RULES, ...SOFT_RULES].map((r) => ({ ...r, enabled: true }));
  }

  const hardRules = allRules.filter((r) => r.type === 'hard');
  const softRules = allRules.filter((r) => r.type === 'soft');

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Reglas</h1>

      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">Reglas estrictas</h2>
        <p className="text-sm text-gray-500 mb-4">Incumplimiento = rechazo automático del mercado</p>
        <div className="space-y-3">
          {hardRules.map((rule) => (
            <div
              key={rule.id}
              className={`bg-white border rounded-lg p-4 ${
                rule.enabled ? 'border-gray-200' : 'border-gray-100 opacity-50'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-0.5 rounded text-xs font-mono font-medium bg-red-100 text-red-700">
                  {rule.id}
                </span>
                {!rule.enabled && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
                    deshabilitada
                  </span>
                )}
                <span className="text-sm font-medium text-gray-800">{rule.description}</span>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed whitespace-pre-wrap">{rule.check}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">Advertencias</h2>
        <p className="text-sm text-gray-500 mb-4">Penalizan el score pero no rechazan</p>
        <div className="space-y-3">
          {softRules.map((rule) => (
            <div
              key={rule.id}
              className={`bg-white border rounded-lg p-4 ${
                rule.enabled ? 'border-gray-200' : 'border-gray-100 opacity-50'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-0.5 rounded text-xs font-mono font-medium bg-yellow-100 text-yellow-700">
                  {rule.id}
                </span>
                {!rule.enabled && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
                    deshabilitada
                  </span>
                )}
                <span className="text-sm font-medium text-gray-800">{rule.description}</span>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed whitespace-pre-wrap">{rule.check}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
