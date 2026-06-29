import { DataFlowHealth, DataSource } from '../types';
import { Database, CheckCircle, AlertTriangle, XCircle, Clock, Waves, Droplets, Wind, Thermometer, Cloud, Zap } from 'lucide-react';

interface Props {
  dataFlowHealth: DataFlowHealth[];
}

function statusIcon(status: string) {
  switch (status) {
    case 'verified':
      return <CheckCircle size={12} className="text-emerald-400" />;
    case 'warning':
      return <AlertTriangle size={12} className="text-yellow-400" />;
    case 'failed':
      return <XCircle size={12} className="text-red-400" />;
    default:
      return <Clock size={12} className="text-cyber-text-dim" />;
  }
}

const sourceIcons: Partial<Record<DataSource, typeof Waves>> = {
  NOAA_NDBC: Waves,
  ARGO: Droplets,
  NOAA_ERDDAP: Waves,
  GTSPP: Droplets,
  TAO_PIRATA: Waves,
  PMEL_CO2: Wind,
  NWS_WEATHER: Cloud,
  NHC_STORM: Cloud,
  BLITZORTUNG_LIGHTNING: Zap,
};

const sourceColors: Partial<Record<DataSource, string>> = {
  NOAA_NDBC: '#00ffcc',
  ARGO: '#06b6d4',
  NOAA_ERDDAP: '#3b82f6',
  GTSPP: '#8b5cf6',
  TAO_PIRATA: '#f59e0b',
  PMEL_CO2: '#ec4899',
  NWS_WEATHER: '#84cc16',
  NHC_STORM: '#ef4444',
  BLITZORTUNG_LIGHTNING: '#fbbf24',
};

function sourceIcon(source: DataSource) {
  const Icon = sourceIcons[source] ?? Thermometer;
  const color = sourceColors[source] ?? '#6b7280';
  return <Icon size={12} style={{ color }} />;
}

function statusColor(status: string): string {
  switch (status) {
    case 'verified': return 'text-emerald-400';
    case 'warning': return 'text-yellow-400';
    case 'failed': return 'text-red-400';
    default: return 'text-cyber-text-dim';
  }
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1048576).toFixed(1)}MB`;
}

export default function DataFlowPanel({ dataFlowHealth }: Props) {
  return (
    <div className="border-b border-cyber-border">
      <div className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <Database size={14} className="text-cyber-accent" />
          <h3 className="text-xs font-bold text-cyber-text">Data Flow Pipeline</h3>
        </div>

        {dataFlowHealth.length === 0 ? (
          <div className="text-xs text-cyber-text-dim italic py-2">
            No pipeline data yet.
          </div>
        ) : (
          <div className="space-y-2">
            {dataFlowHealth.map((flow) => (
              <div
                key={flow.source}
                className="bg-cyber-bg-alt px-2 py-2 rounded border border-cyber-border text-xs space-y-1"
              >
                <div className="flex items-center gap-2">
                  {statusIcon(flow.status)}
                  {sourceIcon(flow.source)}
                  <span className="text-cyber-text font-medium">{flow.sourceName || flow.source}</span>
                  <span className={`text-[10px] ${statusColor(flow.status)} uppercase ml-auto`}>
                    {flow.status}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1 text-[10px] text-cyber-text-dim">
                  <div>
                    <span className="text-cyber-text">{formatLatency(flow.fetchLatencyMs)}</span> latency
                  </div>
                  <div>
                    <span className="text-cyber-text">{flow.stationsReceived}</span> stations
                  </div>
                  <div>
                    <span className="text-cyber-text">{formatBytes(flow.payloadSizeBytes)}</span>
                  </div>
                </div>

                {(flow.duplicateCount > 0 || flow.outOfOrderCount > 0 || flow.missingFieldCount > 0) && (
                  <div className="flex gap-2 text-[10px] text-orange-400">
                    {flow.duplicateCount > 0 && <span>{flow.duplicateCount} dups</span>}
                    {flow.outOfOrderCount > 0 && <span>{flow.outOfOrderCount} reordered</span>}
                    {flow.missingFieldCount > 0 && <span>{flow.missingFieldCount} missing</span>}
                  </div>
                )}

                <div className="h-1 bg-cyber-border rounded-full overflow-hidden">
                  <div
                    className={`h-full ${
                      flow.pipelineScore >= 80 ? 'bg-emerald-500' :
                      flow.pipelineScore >= 60 ? 'bg-yellow-500' :
                      flow.pipelineScore >= 40 ? 'bg-orange-500' : 'bg-red-500'
                    } transition-all duration-500`}
                    style={{ width: `${Math.min(flow.pipelineScore, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
