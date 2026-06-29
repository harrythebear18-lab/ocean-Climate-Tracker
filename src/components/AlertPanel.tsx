import { useState, useEffect } from 'react';
import { ClimateAlert } from '../types';
import { Bell, X, AlertTriangle, BellOff, Clock, Shield, Minus, ChevronDown, Thermometer, Droplets, Wind } from 'lucide-react';

interface AlertPanelProps {
  alerts: ClimateAlert[];
  onClear: () => void;
  snoozeUntil: number | null;
  onSnooze: (minutes: number) => void;
  whitelist: string[];
  onWhitelist: (stationId: string) => void;
}

const severityColors: Record<string, string> = {
  info: 'text-ocean-cool',
  warning: 'text-cyber-warning',
  critical: 'text-cyber-danger',
};

const typeIcons: Record<string, typeof Thermometer> = {
  temp_anomaly: Thermometer,
  data_stale: Clock,
  extreme_event: AlertTriangle,
  co2_spike: Wind,
  data_gap: Droplets,
};

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function snoozeRemaining(snoozeUntil: number): string {
  const remaining = Math.ceil((snoozeUntil - Date.now()) / 60000);
  if (remaining <= 0) return '';
  return `${remaining}m left`;
}

export default function AlertPanel({ alerts, onClear, snoozeUntil, onSnooze, whitelist, onWhitelist }: AlertPanelProps) {
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const [, forceTick] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (snoozeUntil && snoozeUntil > Date.now()) {
      const interval = setInterval(() => forceTick((n) => n + 1), 1000);
      return () => clearInterval(interval);
    }
  }, [snoozeUntil]);

  const isSnoozed = snoozeUntil !== null && snoozeUntil > Date.now();

  if (hidden) {
    return (
      <button
        onClick={() => setHidden(false)}
        className="absolute top-3 right-3 z-[1000] w-8 h-8 flex items-center justify-center bg-cyber-panel/95 border border-cyber-border rounded shadow-lg backdrop-blur-sm hover:border-cyber-accent transition-colors"
        title="Show alerts"
      >
        <Bell size={14} className="text-cyber-warning" />
        {alerts.length > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center text-[8px] font-bold bg-cyber-danger text-white rounded-full">
            {alerts.length > 9 ? '9+' : alerts.length}
          </span>
        )}
      </button>
    );
  }

  if (alerts.length === 0 && !isSnoozed && whitelist.length === 0) {
    return null;
  }

  return (
    <div className={`absolute top-3 right-3 z-[1000] w-72 bg-cyber-panel/95 border border-cyber-border rounded shadow-lg backdrop-blur-sm ${minimized ? '' : 'max-h-[60%] overflow-y-auto'}`}>
      <div className="flex items-center justify-between p-2 border-b border-cyber-border sticky top-0 bg-cyber-panel z-10">
        <div className="flex items-center gap-1.5">
          {isSnoozed ? (
            <>
              <BellOff size={12} className="text-cyber-text-dim" />
              <span className="text-[10px] uppercase tracking-wider text-cyber-text-dim">
                Snoozed ({snoozeRemaining(snoozeUntil!)})
              </span>
            </>
          ) : (
            <>
              <Bell size={12} className="text-cyber-warning" />
              <span className="text-[10px] uppercase tracking-wider text-cyber-text-dim">
                Alerts ({alerts.length})
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setShowSnoozeMenu(!showSnoozeMenu)}
              className="text-cyber-text-dim hover:text-cyber-accent transition-colors"
              title="Snooze alerts"
            >
              <Clock size={12} />
            </button>
            {showSnoozeMenu && (
              <div className="absolute right-0 top-5 z-[1001] bg-cyber-bg border border-cyber-border rounded shadow-lg py-1 min-w-[90px]">
                {isSnoozed && (
                  <button
                    onClick={() => { onSnooze(0); setShowSnoozeMenu(false); }}
                    className="w-full text-left px-2 py-1 text-[10px] text-cyber-text hover:bg-cyber-border/50 transition-colors"
                  >
                    Resume now
                  </button>
                )}
                {[5, 15, 30, 60].map((mins) => (
                  <button
                    key={mins}
                    onClick={() => { onSnooze(mins); setShowSnoozeMenu(false); }}
                    className="w-full text-left px-2 py-1 text-[10px] text-cyber-text hover:bg-cyber-border/50 transition-colors"
                  >
                    {mins} min
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setMinimized(!minimized)}
            className="text-cyber-text-dim hover:text-cyber-accent transition-colors"
            title={minimized ? 'Expand' : 'Minimize'}
          >
            {minimized ? <ChevronDown size={12} /> : <Minus size={12} />}
          </button>
          <button
            onClick={onClear}
            className="text-cyber-text-dim hover:text-cyber-danger transition-colors"
            title="Clear alerts"
          >
            <X size={12} />
          </button>
          <button
            onClick={() => setHidden(true)}
            className="text-cyber-text-dim hover:text-cyber-danger transition-colors"
            title="Hide panel"
          >
            <X size={12} className="opacity-50" />
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          {whitelist.length > 0 && (
            <div className="p-2 border-b border-cyber-border/50">
              <div className="flex items-center gap-1 mb-1">
                <Shield size={10} className="text-green-400" />
                <span className="text-[9px] uppercase tracking-wider text-cyber-text-dim">Trusted Stations</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {whitelist.slice(0, 5).map((id) => (
                  <span key={id} className="text-[9px] px-1.5 py-0.5 bg-green-400/10 text-green-400/80 rounded border border-green-400/20 truncate max-w-[100px]">
                    {id}
                  </span>
                ))}
                {whitelist.length > 5 && (
                  <span className="text-[9px] text-cyber-text-dim">+{whitelist.length - 5} more</span>
                )}
              </div>
            </div>
          )}

          {alerts.length > 0 && (
            <div className="divide-y divide-cyber-border/50">
              {alerts.map((alert) => {
                const Icon = typeIcons[alert.type] || AlertTriangle;
                const color = severityColors[alert.severity] || 'text-cyber-warning';
                return (
                  <div key={alert.id} className={`p-2 hover:bg-cyber-bg/50 transition-colors ${alert.severity === 'critical' ? 'bg-red-500/5' : ''}`}>
                    <div className="flex items-start gap-1.5">
                      <Icon size={10} className={`${color} flex-shrink-0 mt-0.5`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <div className="text-[10px] text-cyber-text font-medium truncate">
                            {alert.severity === 'critical' ? '⚠ ' : ''}{alert.stationName}
                          </div>
                          <button
                            onClick={() => onWhitelist(alert.stationId)}
                            className="text-cyber-text-dim hover:text-green-400 transition-colors flex-shrink-0"
                            title={`Trust ${alert.stationName}`}
                          >
                            <Shield size={10} />
                          </button>
                        </div>
                        <div className="text-[9px] text-cyber-text-dim leading-tight">
                          {alert.message}
                        </div>
                        <div className="text-[8px] text-cyber-text-dim/50 mt-0.5">
                          {alert.source.replace('_', ' ')} - {timeAgo(alert.timestamp)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
