import { CrossVerification, VerificationFlag } from '../types';
import { GitCompare, AlertTriangle, AlertCircle, Info, CheckCircle } from 'lucide-react';

interface Props {
  crossVerifications: CrossVerification[];
}

function flagIcon(severity: string) {
  switch (severity) {
    case 'critical':
      return <AlertCircle size={12} className="text-red-400" />;
    case 'warning':
      return <AlertTriangle size={12} className="text-yellow-400" />;
    default:
      return <Info size={12} className="text-cyber-accent" />;
  }
}

function flagColor(severity: string): string {
  switch (severity) {
    case 'critical': return 'text-red-400';
    case 'warning': return 'text-yellow-400';
    default: return 'text-cyber-accent';
  }
}

export default function CrossVerificationPanel({ crossVerifications }: Props) {
  const flagged = crossVerifications.filter((v) => v.flags.length > 0);
  const invalidated = crossVerifications.filter((v) => v.status === 'invalidated');
  const sorted = [...flagged].sort((a, b) => {
    const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    const aMax = Math.min(...a.flags.map((f) => severityOrder[f.severity] ?? 3));
    const bMax = Math.min(...b.flags.map((f) => severityOrder[f.severity] ?? 3));
    return aMax - bMax;
  });

  return (
    <div className="border-b border-cyber-border">
      <div className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <GitCompare size={14} className="text-cyber-accent" />
          <h3 className="text-xs font-bold text-cyber-text">Cross-Verification</h3>
          <span className="text-xs text-cyber-text-dim ml-auto">
            {crossVerifications.length - flagged.length}/{crossVerifications.length} clean
          </span>
        </div>

        {invalidated.length > 0 && (
          <div className="mb-2 px-2 py-1 bg-red-900/20 border border-red-800/40 rounded text-[10px] text-red-400">
            {invalidated.length} station{invalidated.length !== 1 ? 's' : ''} auto-invalidated — awaiting next data transmission to re-verify
          </div>
        )}

        {sorted.length === 0 ? (
          <div className="text-xs text-cyber-text-dim italic py-2 flex items-center gap-1.5">
            <CheckCircle size={12} className="text-emerald-400" />
            All measurements pass verification.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
            {sorted.slice(0, 20).map((v) => (
              <div
                key={v.stationId}
                className="bg-cyber-bg-alt px-2 py-1.5 rounded border border-cyber-border text-xs space-y-1"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-cyber-text font-medium truncate">{v.stationId}</span>
                  {v.status === 'invalidated' && (
                    <span className="text-[8px] text-red-500 font-bold bg-red-900/30 px-1 rounded">INVALIDATED</span>
                  )}
                  <span className="text-[10px] text-cyber-text-dim ml-auto">
                    {v.verificationScore.toFixed(0)}/100
                  </span>
                </div>

                {v.flags.map((f: VerificationFlag, i: number) => (
                  <div key={i} className="flex items-start gap-1.5">
                    {flagIcon(f.severity)}
                    <div className="flex-1 min-w-0">
                      <span className={`text-[10px] ${flagColor(f.severity)} uppercase`}>
                        {f.type.replace(/_/g, ' ')}
                      </span>
                      {f.field && (
                        <span className="text-[10px] text-cyber-text-dim"> · {f.field}</span>
                      )}
                      <div className="text-[10px] text-cyber-text-dim">{f.message}</div>
                    </div>
                  </div>
                ))}

                {v.crossSourceAgreement.length > 0 && (
                  <div className="flex gap-2 text-[10px] pt-0.5 border-t border-cyber-border">
                    {v.crossSourceAgreement.map((cs, i) => (
                      <span
                        key={i}
                        className={cs.agreement ? 'text-emerald-400' : 'text-red-400'}
                      >
                        {cs.sources.join(' vs ')}: {cs.agreement ? 'match' : `Δ${cs.spread.toFixed(1)}`}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
