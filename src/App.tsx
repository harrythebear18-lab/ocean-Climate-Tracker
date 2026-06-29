import { useState, useCallback, useMemo } from 'react';
import { useClimateData } from './hooks/useClimateData';
import OceanMap from './components/OceanMap';
import StationList from './components/StationList';
import IntegrityDashboard from './components/IntegrityDashboard';
import StatsBar from './components/StatsBar';
import ClimateGraph from './components/ClimateGraph';
import AlertPanel from './components/AlertPanel';
import { ClimateStation, SensorHealth, CrossVerification, Storm, LightningStrike, Vessel, StationType, IntegrityStatus } from './types';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function App() {
  const {
    stations,
    measurements,
    stats,
    isConnected,
    pendingFetches,
    lastUpdateTimestamp,
    trafficHistory,
    alerts,
    integrity,
    whitelist,
    snoozeUntil,
    clearAlerts,
    snoozeAlerts,
    whitelistStation,
  } = useClimateData();

  const [selectedStation, setSelectedStation] = useState<ClimateStation | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showIntegrity, setShowIntegrity] = useState(true);
  const [showVessels, setShowVessels] = useState(false);

  const sensorHealthMap = useMemo(() => {
    const m = new Map<string, SensorHealth>();
    if (integrity?.sensorHealth) {
      for (const [id, health] of integrity.sensorHealth) {
        m.set(id, health);
      }
    }
    return m;
  }, [integrity]);

  const crossVerifications = useMemo(() => {
    return integrity?.crossVerifications ?? [];
  }, [integrity]);

  const storms = useMemo(() => integrity?.storms ?? [], [integrity]);
  const lightningStrikes = useMemo(() => integrity?.lightningStrikes ?? [], [integrity]);
  const vessels = useMemo(() => integrity?.vessels ?? [], [integrity]);

  const [typeFilters, setTypeFilters] = useState<Set<StationType>>(new Set());
  const [statusFilters, setStatusFilters] = useState<Set<IntegrityStatus>>(new Set());

  const toggleTypeFilter = useCallback((t: StationType) => {
    setTypeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  const toggleStatusFilter = useCallback((s: IntegrityStatus) => {
    setStatusFilters((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }, []);

  const verMap = useMemo(() => {
    const m = new Map<string, CrossVerification>();
    for (const v of crossVerifications) m.set(v.stationId, v);
    return m;
  }, [crossVerifications]);

  const filteredStations = useMemo(() => {
    if (showVessels) return [];
    return stations.filter((s) => {
      if (typeFilters.size > 0 && !typeFilters.has(s.type)) return false;
      if (statusFilters.size > 0) {
        const ver = verMap.get(s.id);
        const status: IntegrityStatus = s.invalidated ? 'invalidated' : ver?.status ?? 'unknown';
        if (!statusFilters.has(status)) return false;
      }
      return true;
    });
  }, [stations, typeFilters, statusFilters, verMap, showVessels]);

  const handleSelectStation = useCallback(
    (station: ClimateStation | null) => {
      setSelectedStation((prev) => (prev?.id === station?.id ? null : station));
    },
    []
  );

  return (
    <div className={`flex flex-col h-screen w-screen bg-cyber-bg ${(window as any).electronAPI?.platform === 'darwin' ? 'platform-darwin' : ''}`}>
      {/* macOS title bar drag region */}
      <div className="mac-titlebar-drag" />

      {/* Top stats bar */}
      <StatsBar stats={stats} isConnected={isConnected} pendingFetches={pendingFetches} lastUpdateTimestamp={lastUpdateTimestamp} />

      {/* Climate graph */}
      <ClimateGraph data={trafficHistory} />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar - Station list */}
        {showSidebar ? (
          <div className="w-72 flex-shrink-0">
            <StationList
              stations={filteredStations}
              measurements={measurements}
              selectedStation={selectedStation}
              onSelectStation={handleSelectStation}
              typeFilters={typeFilters}
              statusFilters={statusFilters}
              onToggleTypeFilter={toggleTypeFilter}
              onToggleStatusFilter={toggleStatusFilter}
              verMap={verMap}
              showVessels={showVessels}
              onToggleVessels={() => setShowVessels(!showVessels)}
              vesselCount={vessels.length}
            />
          </div>
        ) : null}

        {/* Sidebar toggle */}
        <button
          onClick={() => setShowSidebar(!showSidebar)}
          className="w-4 bg-cyber-border hover:bg-cyber-accent-dim transition-colors flex items-center justify-center flex-shrink-0 border-r border-cyber-border"
          title={showSidebar ? 'Hide stations' : 'Show stations'}
        >
          {showSidebar ? (
            <ChevronLeft size={12} className="text-cyber-text-dim" />
          ) : (
            <ChevronRight size={12} className="text-cyber-text-dim" />
          )}
        </button>

        {/* Center - Ocean map */}
        <div className="flex-1 relative">
          <OceanMap
            stations={filteredStations}
            measurements={measurements}
            selectedStation={selectedStation}
            onSelectStation={handleSelectStation}
            sensorHealth={sensorHealthMap}
            crossVerifications={crossVerifications}
            storms={storms}
            lightningStrikes={lightningStrikes}
            vessels={vessels}
            showVessels={showVessels}
          />
          <AlertPanel
            alerts={alerts}
            onClear={clearAlerts}
            snoozeUntil={snoozeUntil}
            onSnooze={snoozeAlerts}
            whitelist={whitelist}
            onWhitelist={whitelistStation}
          />
        </div>

        {/* Integrity panel toggle */}
        <button
          onClick={() => setShowIntegrity(!showIntegrity)}
          className="w-4 bg-cyber-border hover:bg-cyber-accent-dim transition-colors flex items-center justify-center flex-shrink-0 border-l border-cyber-border"
          title={showIntegrity ? 'Hide integrity' : 'Show integrity'}
        >
          {showIntegrity ? (
            <ChevronRight size={12} className="text-cyber-text-dim" />
          ) : (
            <ChevronLeft size={12} className="text-cyber-text-dim" />
          )}
        </button>

        {/* Right sidebar - Integrity dashboard */}
        {showIntegrity ? (
          <div className="w-80 flex-shrink-0">
            <IntegrityDashboard integrity={integrity} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
