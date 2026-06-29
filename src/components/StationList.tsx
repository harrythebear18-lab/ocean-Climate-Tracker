import { useState, useMemo } from 'react';
import { ClimateStation, ClimateMeasurement, StationType, IntegrityStatus, CrossVerification } from '../types';
import { Search, Waves, Droplets, Wind, Clock, Thermometer, Cloud, Zap, Filter, Ship } from 'lucide-react';

interface StationListProps {
  stations: ClimateStation[];
  measurements: Map<string, ClimateMeasurement>;
  selectedStation: ClimateStation | null;
  onSelectStation: (station: ClimateStation | null) => void;
  typeFilters?: Set<StationType>;
  statusFilters?: Set<IntegrityStatus>;
  onToggleTypeFilter?: (t: StationType) => void;
  onToggleStatusFilter?: (s: IntegrityStatus) => void;
  verMap?: Map<string, CrossVerification>;
  showVessels?: boolean;
  onToggleVessels?: () => void;
  vesselCount?: number;
}

const sourceColors: Record<string, string> = {
  NOAA_NDBC: '#00ffcc',
  ARGO: '#06b6d4',
  BGC_ARGO: '#22d3ee',
  NOAA_ERDDAP: '#3b82f6',
  GTSPP: '#8b5cf6',
  TAO_PIRATA: '#f59e0b',
  PMEL_CO2: '#ec4899',
  NWS_WEATHER: '#84cc16',
  NHC_STORM: '#ef4444',
  BLITZORTUNG_LIGHTNING: '#fbbf24',
};

const typeIcons: Record<string, typeof Waves> = {
  buoy: Waves,
  argo_float: Droplets,
  bgc_argo_float: Droplets,
  carbon_station: Wind,
  weather_station: Cloud,
  storm: Cloud,
  lightning: Zap,
};

const allTypes: StationType[] = ['buoy', 'argo_float', 'bgc_argo_float', 'carbon_station', 'weather_station', 'storm', 'lightning'];
const allStatuses: IntegrityStatus[] = ['verified', 'warning', 'failed', 'stale', 'unknown', 'invalidated'];

const statusColors: Record<IntegrityStatus, string> = {
  verified: '#10b981',
  warning: '#f59e0b',
  failed: '#ef4444',
  stale: '#f97316',
  unknown: '#6b7280',
  invalidated: '#dc2626',
};

export default function StationList({
  stations,
  measurements,
  selectedStation,
  onSelectStation,
  typeFilters,
  statusFilters,
  onToggleTypeFilter,
  onToggleStatusFilter,
  verMap,
  showVessels,
  onToggleVessels,
  vesselCount,
}: StationListProps) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'name' | 'source' | 'temp'>('recent');
  const [filterSource, setFilterSource] = useState<string>('all');

  const filtered = useMemo(() => {
    let result = stations.filter((s) => {
      if (filterSource !== 'all' && s.source !== filterSource) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.source.toLowerCase().includes(q) ||
        s.region?.toLowerCase().includes(q) ||
        s.country?.toLowerCase().includes(q)
      );
    });

    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'source':
          return a.source.localeCompare(b.source);
        case 'temp': {
          const ta = measurements.get(a.id)?.waterTemp ?? -999;
          const tb = measurements.get(b.id)?.waterTemp ?? -999;
          return tb - ta;
        }
        case 'recent':
        default:
          return b.lastUpdate - a.lastUpdate;
      }
    });

    return result;
  }, [stations, search, sortBy, filterSource, measurements]);

  const sources = ['all', ...Array.from(new Set(stations.map((s) => s.source)))];
  const activeFilterCount = (typeFilters?.size ?? 0) + (statusFilters?.size ?? 0);

  return (
    <div className="flex flex-col h-full bg-cyber-panel border-r border-cyber-border">
      <div className="p-3 border-b border-cyber-border">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-bold text-cyber-accent uppercase tracking-wider">
            Stations
          </h2>
          <div className="flex items-center gap-2">
            {activeFilterCount > 0 && (
              <button
                onClick={() => {
                  onToggleTypeFilter && allTypes.forEach((t) => typeFilters?.has(t) && onToggleTypeFilter(t));
                  onToggleStatusFilter && allStatuses.forEach((s) => statusFilters?.has(s) && onToggleStatusFilter(s));
                }}
                className="text-[9px] text-orange-400 hover:text-orange-300 transition-colors"
              >
                Clear filters ({activeFilterCount})
              </button>
            )}
            <span className="text-xs text-cyber-text-dim">
              {filtered.length}
            </span>
          </div>
        </div>

        <div className="relative mb-2">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-cyber-text-dim"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, source, region..."
            className="w-full bg-cyber-bg border border-cyber-border rounded pl-7 pr-2 py-1.5 text-xs text-cyber-text placeholder:text-cyber-text-dim focus:outline-none focus:border-cyber-accent-dim"
          />
        </div>

        <div className="flex gap-1 mb-2">
          {sources.map((s) => (
            <button
              key={s}
              onClick={() => setFilterSource(s)}
              className={`px-2 py-1 text-[9px] rounded uppercase tracking-wider transition-colors ${
                filterSource === s
                  ? 'bg-cyber-accent/20 text-cyber-accent border border-cyber-accent/30'
                  : 'text-cyber-text-dim hover:text-cyber-text border border-transparent'
              }`}
            >
              {s === 'all' ? 'ALL' : s.replace('_', ' ')}
            </button>
          ))}
        </div>

        <div className="flex gap-1">
          {(['recent', 'name', 'source', 'temp'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`px-2 py-1 text-[10px] rounded uppercase tracking-wider transition-colors ${
                sortBy === s
                  ? 'bg-cyber-accent/20 text-cyber-accent border border-cyber-accent/30'
                  : 'text-cyber-text-dim hover:text-cyber-text border border-transparent'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Type filters */}
        {onToggleTypeFilter && (
          <div className="mt-2 mb-1">
            <div className="flex items-center gap-1 mb-1">
              <Filter size={9} className="text-cyber-text-dim" />
              <span className="text-[9px] text-cyber-text-dim uppercase tracking-wider">Type</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {allTypes.map((t) => {
                const Icon = typeIcons[t] || Waves;
                const active = typeFilters?.has(t) ?? false;
                return (
                  <button
                    key={t}
                    onClick={() => onToggleTypeFilter(t)}
                    className={`flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded transition-colors ${
                      active
                        ? 'bg-cyber-accent/20 text-cyber-accent border border-cyber-accent/30'
                        : 'text-cyber-text-dim hover:text-cyber-text border border-transparent'
                    }`}
                  >
                    <Icon size={9} />
                    {t === 'bgc_argo_float' ? 'BGC Argo' : t.replace('_', ' ')}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Vessel layer toggle */}
        {onToggleVessels && (
          <div className="mt-2 mb-1">
            <div className="flex items-center gap-1 mb-1">
              <Filter size={9} className="text-cyber-text-dim" />
              <span className="text-[9px] text-cyber-text-dim uppercase tracking-wider">Overlay Layers</span>
            </div>
            <div className="flex flex-wrap gap-1">
              <button
                onClick={onToggleVessels}
                className={`flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded transition-colors ${
                  showVessels
                    ? 'bg-cyber-accent/20 text-cyber-accent border border-cyber-accent/30'
                    : 'text-cyber-text-dim hover:text-cyber-text border border-transparent'
                }`}
              >
                <Ship size={9} />
                AIS Vessels{vesselCount ? ` (${vesselCount})` : ''}
              </button>
            </div>
          </div>
        )}

        {/* Status filters */}
        {onToggleStatusFilter && (
          <div className="mt-2 mb-1">
            <div className="flex items-center gap-1 mb-1">
              <Filter size={9} className="text-cyber-text-dim" />
              <span className="text-[9px] text-cyber-text-dim uppercase tracking-wider">Status</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {allStatuses.map((s) => {
                const active = statusFilters?.has(s) ?? false;
                return (
                  <button
                    key={s}
                    onClick={() => onToggleStatusFilter(s)}
                    className={`flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded transition-colors ${
                      active
                        ? 'border border-cyber-accent/30 text-cyber-text'
                        : 'text-cyber-text-dim hover:text-cyber-text border border-transparent'
                    }`}
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ backgroundColor: statusColors[s] }}
                    />
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-xs text-cyber-text-dim">
            No stations found
          </div>
        ) : (
          filtered.map((station) => {
            const isSelected = selectedStation?.id === station.id;
            const color = sourceColors[station.source] || '#00ffcc';
            const Icon = typeIcons[station.type] || Waves;
            const m = measurements.get(station.id);

            return (
              <div
                key={station.id}
                onClick={() => onSelectStation(station)}
                className={`px-3 py-2 border-b border-cyber-border/50 cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-cyber-accent/10 border-l-2 border-l-cyber-accent'
                    : 'hover:bg-cyber-border/30 border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Icon size={10} style={{ color }} className="flex-shrink-0" />
                      <span className="text-xs font-medium text-cyber-text truncate">
                        {station.name}
                      </span>
                    </div>

                    <div className="text-[10px] text-cyber-text-dim ml-3 truncate">
                      {station.source.replace('_', ' ')}
                      {station.country ? ` - ${station.country}` : ''}
                    </div>

                    {m && (
                      <div className="text-[10px] text-cyber-text-dim ml-3 mt-0.5 flex gap-2">
                        {m.waterTemp !== undefined && (
                          <span style={{ color: tempColor(m.waterTemp) }}>
                            {m.waterTemp.toFixed(1)}°C
                          </span>
                        )}
                        {(m.depth !== undefined || station.depth !== undefined) && (
                          <span className="text-purple-400">
                            {(m?.depth ?? station.depth)!.toFixed(0)}m
                          </span>
                        )}
                        {m.salinity !== undefined && (
                          <span className="text-ocean-cool">
                            {m.salinity.toFixed(1)} PSU
                          </span>
                        )}
                        {m.co2 !== undefined && (
                          <span className="text-cyber-warning">
                            {m.co2.toFixed(0)}ppm
                          </span>
                        )}
                        {m.waveHeight !== undefined && (
                          <span className="text-ocean-cool">
                            {m.waveHeight.toFixed(1)}m
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{
                        backgroundColor: station.invalidated ? '#dc2626' : (station.active ? color : '#5a6478'),
                        boxShadow: station.invalidated ? '0 0 4px #dc2626' : (station.active ? `0 0 4px ${color}` : 'none'),
                      }}
                    />
                    {station.invalidated && (
                      <span className="text-[8px] text-red-600 font-bold">INVALID</span>
                    )}
                    <span className="text-[9px] text-cyber-text-dim flex items-center gap-0.5">
                      <Clock size={8} />
                      {timeAgo(station.lastUpdate)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function tempColor(temp: number): string {
  if (temp < 0) return '#2563eb';
  if (temp < 10) return '#06b6d4';
  if (temp < 20) return '#10b981';
  if (temp < 28) return '#f59e0b';
  return '#ef4444';
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
