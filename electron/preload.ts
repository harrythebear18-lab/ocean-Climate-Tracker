import { contextBridge, ipcRenderer } from 'electron';
import { ClimateStation, ClimateMeasurement, ClimateStats, TrafficDataPoint, ClimateAlert, IntegrityUpdate } from '../src/types';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  onClimateUpdate: (callback: (update: {
    stations: ClimateStation[];
    measurements: [string, ClimateMeasurement][];
    stats: ClimateStats;
    timestamp: number;
    pendingFetches: number;
  }) => void) =>
    ipcRenderer.on('climate:update', (_event, update) => callback(update)),

  onTrafficUpdate: (callback: (data: TrafficDataPoint) => void) =>
    ipcRenderer.on('traffic:update', (_event, data) => callback(data)),

  onAlert: (callback: (alert: ClimateAlert) => void) =>
    ipcRenderer.on('alert:new', (_event, alert) => callback(alert)),

  onIntegrityUpdate: (callback: (update: IntegrityUpdate) => void) =>
    ipcRenderer.on('integrity:update', (_event, update) => callback(update)),

  whitelistStation: (stationId: string): Promise<void> =>
    ipcRenderer.invoke('alerts:whitelist', stationId),

  unwhitelistStation: (stationId: string): Promise<void> =>
    ipcRenderer.invoke('alerts:unwhitelist', stationId),

  getWhitelist: (): Promise<string[]> =>
    ipcRenderer.invoke('alerts:getWhitelist'),

  snoozeAlerts: (minutes: number): Promise<void> =>
    ipcRenderer.invoke('alerts:snooze', minutes),

  isSnoozed: (): Promise<boolean> =>
    ipcRenderer.invoke('alerts:isSnoozed'),
});
