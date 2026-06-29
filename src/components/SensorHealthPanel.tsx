import { SensorHealth } from '../types';
import { Radio, CheckCircle, AlertTriangle, XCircle, Clock } from 'lucide-react';

interface Props {
  sensorHealth: [string, SensorHealth][];
}

function statusIcon(status: string) {
  switch (status) {
    case 'verified':
      return <CheckCircle size={12} className="text-emerald-400" />;
    case 'warning':
      return <AlertTriangle size={12} className="text-yellow-400" />;
    case 'failed':
      return <XCircle size={12} className="text-red-400" />;
    case 'stale':
      return <Clock size={12} className="text-orange-400" />;
    default:
      return <Radio size={12} className="text-cyber-text-dim" />;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'verified': return 'text-emerald-400';
    case 'warning': return 'text-yellow-400';
    case 'failed': return 'text-red-400';
    case 'stale': return 'text-orange-400';
    default: return 'text-cyber-text-dim';
  }
}

function formatAge(ms: number): string {
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export default function SensorHealthPanel({ sensorHealth }: Props) {
  const sensors = sensorHealth.map(([id, h]) => ({ id, ...h }));
  const sorted = sensors.sort((a, b) => {
    const order: Record<string, number> = { failed: 0, stale: 1, warning: 2, unknown: 3, verified: 4 };
    return (order[a.status] ?? 5) - (order[b.status] ?? 5);
  });

  const flagged = sorted.filter((s) => s.status !== 'verified').slice(0, 20);
  const verifiedCount = sorted.filter((s) => s.status === 'verified').length;

  return (
    <div className="border-b border-cyber-border">
      <div className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <Radio size={14} className="text-cyber-accent" />
          <h3 className="text-xs font-bold text-cyber-text">Sensor Health</h3>
          <span className="text-xs text-cyber-text-dim ml-auto">
            {verifiedCount}/{sorted.length} verified
          </span>
        </div>

        {flagged.length === 0 ? (
          <div className="text-xs text-cyber-text-dim italic py-2">
            All sensors transmitting normally.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
            {flagged.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2 text-xs bg-cyber-bg-alt px-2 py-1.5 rounded border border-cyber-border"
              >
                {statusIcon(s.status)}
                <div className="flex-1 min-w-0">
                  <div className="text-cyber-text truncate">{s.stationId}</div>
                  <div className="text-cyber-text-dim text-[10px]">
                    {formatAge(Date.now() - s.lastTransmission)} · {s.transmissionCount} tx
                    {s.driftDetected && ' · drift detected'}
                    {s.calibrationStatus === 'drift' && ' · needs cal'}
                  </div>
                </div>
                <span className={`text-[10px] ${statusColor(s.status)} uppercase`}>
                  {s.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
