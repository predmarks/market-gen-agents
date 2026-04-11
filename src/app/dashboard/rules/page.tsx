export const dynamic = 'force-dynamic';

import { loadRules, type Rule } from '@/config/rules';
import { db } from '@/db/client';
import { rules } from '@/db/schema';
import { Card, CardContent } from '@/components/ui/card';

interface RuleRow extends Rule {
  enabled: boolean;
}

export default async function RulesPage() {
  let allRules: RuleRow[];

  try {
    // Show ALL rules (including disabled) so editors can manage them
    const rows = await db.select().from(rules);
    if (rows.length > 0) {
      allRules = rows.map((r) => ({ id: r.id, type: r.type as 'hard' | 'soft', description: r.description, check: r.check, enabled: r.enabled }));
    } else {
      const { hard, soft } = await loadRules();
      allRules = [...hard, ...soft].map((r) => ({ ...r, enabled: true }));
    }
  } catch {
    const { hard, soft } = await loadRules();
    allRules = [...hard, ...soft].map((r) => ({ ...r, enabled: true }));
  }

  const hardRules = allRules.filter((r) => r.type === 'hard');
  const softRules = allRules.filter((r) => r.type === 'soft');

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Reglas</h1>

      <div className="mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-3">Reglas estrictas</h2>
        <p className="text-sm text-muted-foreground mb-4">Incumplimiento = rechazo automático del mercado</p>
        <div className="space-y-3">
          {hardRules.map((rule) => (
            <Card
              key={rule.id}
              className={rule.enabled ? '' : 'opacity-50'}
            >
              <CardContent>
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 rounded text-xs font-mono font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                    {rule.id}
                  </span>
                  {!rule.enabled && (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                      deshabilitada
                    </span>
                  )}
                  <span className="text-sm font-medium text-foreground">{rule.description}</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{rule.check}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-foreground mb-3">Advertencias</h2>
        <p className="text-sm text-muted-foreground mb-4">Penalizan el score pero no rechazan</p>
        <div className="space-y-3">
          {softRules.map((rule) => (
            <Card
              key={rule.id}
              className={rule.enabled ? '' : 'opacity-50'}
            >
              <CardContent>
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 rounded text-xs font-mono font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">
                    {rule.id}
                  </span>
                  {!rule.enabled && (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                      deshabilitada
                    </span>
                  )}
                  <span className="text-sm font-medium text-foreground">{rule.description}</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{rule.check}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
