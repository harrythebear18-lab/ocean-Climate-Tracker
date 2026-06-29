import { IntegrityUpdate, IntegritySummary, ClimateStation } from '../types';
import SensorHealthPanel from './SensorHealthPanel';
import DataFlowPanel from './DataFlowPanel';
import CrossVerificationPanel from './CrossVerificationPanel';
import { Shield, Activity, AlertTriangle, CheckCircle, XCircle, Layers, Radar } from 'lucide-react';

interface Props {
  integrity: IntegrityUpdate | null;
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-yellow-400';
  if (score >= 40) return 'text-orange-400';
  return 'text-red-400';
}

function scoreBg(score: number): string {
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-yellow-500';
  if (score >= 40) return 'bg-orange-500';
  return 'bg-red-500';
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-cyber-text-dim">{label}</span>
        <span className={scoreColor(score)}>{score.toFixed(1)}</span>
      </div>
      <div className="h-1.5 bg-cyber-border rounded-full overflow-hidden">
        <div
          className={`h-full ${scoreBg(score)} transition-all duration-500`}
          style={{ width: `${Math.min(score, 100)}%` }}
        />
      </div>
    </div>
  );
}

export default function IntegrityDashboard({ integrity }: Props) {
  const summary: IntegritySummary | null = integrity?.summary ?? null;

  if (!summary) {
    return (
      <div className="h-full flex items-center justify-center text-cyber-text-dim text-sm">
        <div className="text-center space-y-2">
          <Shield size={32} className="mx-auto opacity-30" />
          <p>Waiting for integrity data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      {/* Overall Score */}
      <div className="p-3 border-b border-cyber-border">
        <div className="flex items-center gap-2 mb-3">
          <Shield size={16} className="text-cyber-accent" />
          <h2 className="text-sm font-bold text-cyber-text">Integrity Dashboard</h2>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="text-center">
            <div className={`text-2xl font-bold ${scoreColor(summary.overallScore)}`}>
              {summary.overallScore.toFixed(0)}
            </div>
            <div className="text-xs text-cyber-text-dim">Overall</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-cyber-text">
              {summary.totalSensorsMonitored}
            </div>
            <div className="text-xs text-cyber-text-dim">Sensors</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-cyber-text">
              {summary.dataPointsVerified}
            </div>
            <div className="text-xs text-cyber-text-dim">Data Pts</div>
          </div>
        </div>

        <div className="space-y-2">
          <ScoreBar label="Sensor Layer" score={summary.sensorLayerScore} />
          <ScoreBar label="Data Flow Layer" score={summary.dataFlowLayerScore} />
          <ScoreBar label="Results Layer" score={summary.resultsLayerScore} />
        </div>
      </div>

      {/* Quick Stats */}
      <div className="p-3 border-b border-cyber-border grid grid-cols-2 gap-2 text-xs">
        <div className="flex items-center gap-1.5">
          <CheckCircle size={12} className="text-emerald-400" />
          <span className="text-cyber-text-dim">Verified:</span>
          <span className="text-cyber-text">{summary.sensorsVerified}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={12} className="text-yellow-400" />
          <span className="text-cyber-text-dim">Warning:</span>
          <span className="text-cyber-text">{summary.sensorsWarning}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <XCircle size={12} className="text-red-400" />
          <span className="text-cyber-text-dim">Failed:</span>
          <span className="text-cyber-text">{summary.sensorsFailed}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Activity size={12} className="text-cyber-accent" />
          <span className="text-cyber-text-dim">Pipelines:</span>
          <span className="text-cyber-text">{summary.pipelinesActive}/{summary.pipelinesActive + summary.pipelinesDegraded}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Layers size={12} className="text-cyber-accent" />
          <span className="text-cyber-text-dim">Cross-source:</span>
          <span className="text-cyber-text">{summary.crossSourceMatches}/{summary.crossSourceMatches + summary.crossSourceMismatches}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={12} className="text-orange-400" />
          <span className="text-cyber-text-dim">Flags:</span>
          <span className="text-cyber-text">{summary.totalFlags}</span>
          {summary.criticalFlags > 0 && (
            <span className="text-red-400">({summary.criticalFlags} crit)</span>
          )}
        </div>
      </div>

      {/* New Sensors Detected */}
      {integrity?.newStations && integrity.newStations.length > 0 && (
        <div className="p-3 border-b border-cyber-border">
          <div className="flex items-center gap-2 mb-2">
            <Radar size={14} className="text-cyan-400 animate-pulse" />
            <h3 className="text-xs font-bold text-cyber-text">
              New Sensors ({integrity.newStations.length})
            </h3>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
            {integrity.newStations.slice(0, 50).map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between text-xs bg-cyber-bg/50 rounded px-2 py-1.5 border border-cyber-border/50"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    s.type === 'argo_float' ? 'bg-cyan-400' :
                    s.type === 'buoy' ? 'bg-teal-400' :
                    s.type === 'weather_station' ? 'bg-lime-400' :
                    s.type === 'carbon_station' ? 'bg-pink-400' :
                    'bg-blue-400'
                  }`} />
                  <div className="min-w-0">
                    <div className="text-cyber-text truncate font-medium">{s.name}</div>
                    <div className="text-cyber-text-dim text-[10px]">
                      {s.type.replace(/_/g, ' ')} · {s.source.replace(/_/g, ' ')}
                    </div>
                  </div>
                </div>
                <div className="text-cyber-text-dim text-[10px] flex-shrink-0 ml-2">
                  {s.lat.toFixed(1)}°, {s.lon.toFixed(1)}°
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sub-panels */}
      <SensorHealthPanel sensorHealth={integrity?.sensorHealth ?? []} />
      <DataFlowPanel dataFlowHealth={integrity?.dataFlowHealth ?? []} />
      <CrossVerificationPanel crossVerifications={integrity?.crossVerifications ?? []} />
    </div>
  );
}
