import { useEffect, useState, useCallback, useRef } from 'react';
import { ClimateStation, ClimateMeasurement, ClimateStats, TrafficDataPoint, ClimateAlert, IntegrityUpdate } from '../types';

interface ElectronAPI {
  onClimateUpdate: (callback: (update: {
    stations: ClimateStation[];
    measurements: [string, ClimateMeasurement][];
    stats: ClimateStats;
    timestamp: number;
    pendingFetches: number;
  }) => void) => void;
  onTrafficUpdate: (callback: (data: TrafficDataPoint) => void) => void;
  onAlert: (callback: (alert: ClimateAlert) => void) => void;
  onIntegrityUpdate: (callback: (update: IntegrityUpdate) => void) => void;
  whitelistStation: (stationId: string) => Promise<void>;
  unwhitelistStation: (stationId: string) => Promise<void>;
  getWhitelist: () => Promise<string[]>;
  snoozeAlerts: (minutes: number) => Promise<void>;
  isSnoozed: () => Promise<boolean>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export function useClimateData() {
  const [stations, setStations] = useState<ClimateStation[]>([]);
  const [measurements, setMeasurements] = useState<Map<string, ClimateMeasurement>>(new Map());
  const [stats, setStats] = useState<ClimateStats | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [pendingFetches, setPendingFetches] = useState(0);
  const [lastUpdateTimestamp, setLastUpdateTimestamp] = useState<number | undefined>(undefined);
  const [trafficHistory, setTrafficHistory] = useState<TrafficDataPoint[]>([]);
  const [alerts, setAlerts] = useState<ClimateAlert[]>([]);
  const [integrity, setIntegrity] = useState<IntegrityUpdate | null>(null);
  const [newStations, setNewStations] = useState<ClimateStation[]>([]);
  const knownStationIds = useRef<Set<string>>(new Set());
  const [whitelist, setWhitelist] = useState<string[]>([]);
  const [snoozeUntil, setSnoozeUntil] = useState<number | null>(null);
  const whitelistRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) {
      console.error('Electron API not available');
      return;
    }

    api.onClimateUpdate((update) => {
      setStations(update.stations);
      setMeasurements(new Map(update.measurements));
      setStats(update.stats);
      setPendingFetches(update.pendingFetches);
      setLastUpdateTimestamp(update.timestamp);
      setIsConnected(true);

      // Track newly seen stations
      const fresh = update.stations.filter((s) => !knownStationIds.current.has(s.id));
      if (fresh.length > 0) {
        setNewStations((prev) => {
          const existing = new Set(prev.map((s) => s.id));
          const additions = fresh.filter((s) => !existing.has(s.id));
          return [...prev, ...additions].slice(-200);
        });
      }
      for (const s of update.stations) knownStationIds.current.add(s.id);
    });

    api.onTrafficUpdate((data) => {
      setTrafficHistory((prev) => {
        const next = [...prev, data];
        if (next.length > 60) next.shift();
        return next;
      });
    });

    api.onAlert((alert) => {
      if (whitelistRef.current.has(alert.stationId)) return;
      setAlerts((prev) => {
        const next = [alert, ...prev];
        if (next.length > 50) next.pop();
        return next;
      });
    });

    api.onIntegrityUpdate((update) => {
      setNewStations((prev) => {
        const existing = new Set(prev.map((s) => s.id));
        const additions = (update.newStations ?? []).filter((s) => !existing.has(s.id));
        const merged = [...prev, ...additions].slice(-200);
        setIntegrity({ ...update, newStations: merged });
        return merged;
      });
    });

    api.getWhitelist().then((list) => {
      setWhitelist(list);
      whitelistRef.current = new Set(list);
    });

    return () => {
      // IPC listeners persist for app lifetime
    };
  }, []);

  const refreshIntegrity = useCallback(async () => {
    // Integrity is pushed via IPC, no explicit refresh needed
  }, []);

  const clearAlerts = useCallback(() => {
    setAlerts([]);
  }, []);

  const snoozeAlerts = useCallback(async (minutes: number) => {
    const api = window.electronAPI;
    if (!api) return;
    if (minutes > 0) {
      setSnoozeUntil(Date.now() + minutes * 60 * 1000);
    } else {
      setSnoozeUntil(null);
    }
    await api.snoozeAlerts(minutes);
  }, []);

  const whitelistStation = useCallback(async (stationId: string) => {
    const api = window.electronAPI;
    if (!api) return;
    whitelistRef.current.add(stationId);
    setWhitelist(Array.from(whitelistRef.current));
    setAlerts((prev) => prev.filter((a) => a.stationId !== stationId));
    await api.whitelistStation(stationId);
  }, []);

  const unwhitelistStation = useCallback(async (stationId: string) => {
    const api = window.electronAPI;
    if (!api) return;
    whitelistRef.current.delete(stationId);
    setWhitelist(Array.from(whitelistRef.current));
    await api.unwhitelistStation(stationId);
  }, []);

  return {
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
    refreshIntegrity,
    clearAlerts,
    snoozeAlerts,
    whitelistStation,
    unwhitelistStation,
  };
}
