import { useState, useEffect } from 'react';
import { ClimateStats } from '../types';
import { Waves, Thermometer, Globe, Server, Activity, Wind, Zap, Loader, Droplets, Clock, Plane, FlaskConical } from 'lucide-react';

interface StatsBarProps {
  stats: ClimateStats | null;
  isConnected: boolean;
  pendingFetches?: number;
  lastUpdateTimestamp?: number;
  fetchIntervalMs?: number;
}

export default function StatsBar({ stats, isConnected, pendingFetches, lastUpdateTimestamp, fetchIntervalMs = 4 * 60 * 1000 }: StatsBarProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsedMs = lastUpdateTimestamp ? now - lastUpdateTimestamp : 0;
  const remainingMs = Math.max(0, fetchIntervalMs - elapsedMs);
  const remainingMin = Math.floor(remainingMs / 60000);
  const remainingSec = Math.floor((remainingMs % 60000) / 1000);
  const countdownStr = `${remainingMin}:${remainingSec.toString().padStart(2, '0')}`;
  const elapsedMin = Math.floor(elapsedMs / 60000);
  const elapsedSec = Math.floor((elapsedMs % 60000) / 1000);
  const elapsedStr = `${elapsedMin}:${elapsedSec.toString().padStart(2, '0')}`;

  const isOverdue = elapsedMs > fetchIntervalMs;
  const items = [
    {
      icon: Server,
      label: 'Total Stations',
      value: stats?.totalStations ?? 0,
      color: 'text-cyber-accent',
    },
    {
      icon: Activity,
      label: 'Active',
      value: stats?.activeStations ?? 0,
      color: 'text-green-400',
    },
    {
      icon: Waves,
      label: 'Buoys',
      value: stats?.buoys ?? 0,
      color: 'text-ocean-cool',
    },
    {
      icon: Droplets,
      label: 'Argo Floats',
      value: stats?.argoFloats ?? 0,
      color: 'text-blue-400',
    },
    {
      icon: FlaskConical,
      label: 'BGC Argo',
      value: stats?.bgcArgoFloats ?? 0,
      color: 'text-cyan-400',
    },
    {
      icon: Wind,
      label: 'Carbon Stations',
      value: stats?.carbonStations ?? 0,
      color: 'text-purple-400',
    },
    {
      icon: Plane,
      label: 'Weather Stations',
      value: stats?.weatherStations ?? 0,
      color: 'text-lime-400',
    },
    {
      icon: Thermometer,
      label: 'Avg Water Temp',
      value: stats ? `${stats.avgWaterTemp.toFixed(1)}°C` : '--',
      color: 'text-ocean-warm',
    },
    {
      icon: Thermometer,
      label: 'Avg Air Temp',
      value: stats && stats.avgAirTemp !== 0 ? `${stats.avgAirTemp.toFixed(1)}°C` : '--',
      color: 'text-lime-400',
    },
    {
      icon: Globe,
      label: 'Avg CO2',
      value: stats && stats.avgCO2 > 0 ? `${stats.avgCO2.toFixed(0)}ppm` : '--',
      color: 'text-cyber-warning',
    },
    {
      icon: Zap,
      label: 'Status',
      value: isConnected ? 'LIVE' : 'CONNECTING',
      color: isConnected ? 'text-green-400' : 'text-cyber-warning',
    },
  ];

  return (
    <div className="flex items-center justify-between bg-cyber-panel border-b border-cyber-border px-4 py-2 h-14">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-cyber-accent status-pulse text-cyber-accent" />
          <span className="text-cyber-accent font-bold text-sm tracking-wider">
            CLIMATE
          </span>
          <span className="text-cyber-text-dim text-xs">OCEAN TRACKER</span>
        </div>
      </div>

      <div className="flex items-center gap-5">
        {items.map((item, i) => {
          const Icon = item.icon;
          return (
            <div key={i} className="flex items-center gap-2">
              <Icon size={14} className={item.color} />
              <div className="flex flex-col">
                <span className="text-[10px] text-cyber-text-dim uppercase tracking-wider">
                  {item.label}
                </span>
                <span className={`text-sm font-bold ${item.color}`}>
                  {item.value}
                </span>
              </div>
            </div>
          );
        })}
        {pendingFetches !== undefined && pendingFetches > 0 && (
          <div className="flex items-center gap-2">
            <Loader size={14} className="text-cyber-warning animate-spin" />
            <div className="flex flex-col">
              <span className="text-[10px] text-cyber-text-dim uppercase tracking-wider">
                Fetching
              </span>
              <span className="text-sm font-bold text-cyber-warning">
                {pendingFetches}
              </span>
            </div>
          </div>
        )}
        {lastUpdateTimestamp && (
          <div className="flex items-center gap-2">
            <Clock size={14} className={isOverdue ? 'text-red-400' : 'text-cyber-accent'} />
            <div className="flex flex-col">
              <span className="text-[10px] text-cyber-text-dim uppercase tracking-wider">
                {isOverdue ? 'Overdue' : 'Next Fetch'}
              </span>
              <span className={`text-sm font-bold ${isOverdue ? 'text-red-400' : 'text-cyber-accent'}`}>
                {isOverdue ? elapsedStr : countdownStr}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
