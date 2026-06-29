import './httpUtil'; // Must be first — sets global DNS servers
import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { ClimateMonitor } from './climateMonitor';
import { ClimateStation, ClimateMeasurement, ClimateStats, TrafficDataPoint, ClimateAlert, IntegrityUpdate } from '../src/types';

let mainWindow: BrowserWindow | null = null;
let climateMonitor: ClimateMonitor;

function createWindow() {
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#0a0e17',
    title: 'ClimateOcean Tracker',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 12, y: 12 } : undefined,
    vibrancy: isMac ? 'under-window' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const rendererPath = path.join(__dirname, '../../dist-renderer/index.html');
  const isDev = !app.isPackaged && process.env.NODE_ENV === 'development' && !fs.existsSync(rendererPath);

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(rendererPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: 'ClimateOcean Tracker',
      applicationVersion: app.getVersion(),
      copyright: '© 2026',
      credits: 'NOAA NDBC · Argo · ICOS · Blitzortung · NHC',
    });
  }

  climateMonitor = new ClimateMonitor(
    (stations: ClimateStation[], measurements: [string, ClimateMeasurement][], stats: ClimateStats) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('climate:update', {
        stations,
        measurements,
        stats,
        timestamp: Date.now(),
        pendingFetches: climateMonitor.getPendingCount(),
      });
    },
    (dataPoint: TrafficDataPoint) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('traffic:update', dataPoint);
    },
    (alert: ClimateAlert) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('alert:new', alert);
    },
    (integrityUpdate: IntegrityUpdate) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('integrity:update', integrityUpdate);
    }
  );

  createWindow();
  climateMonitor.start();
});


ipcMain.handle('alerts:whitelist', async (_event, stationId: string) => {
  climateMonitor.whitelistStation(stationId);
});

ipcMain.handle('alerts:unwhitelist', async (_event, stationId: string) => {
  climateMonitor.unwhitelistStation(stationId);
});

ipcMain.handle('alerts:getWhitelist', async () => {
  return climateMonitor.getWhitelistedStations();
});

ipcMain.handle('alerts:snooze', async (_event, minutes: number) => {
  climateMonitor.setSnooze(minutes * 60 * 1000);
});

ipcMain.handle('alerts:isSnoozed', async () => {
  return climateMonitor.isSnoozed();
});

app.on('window-all-closed', () => {
  if (climateMonitor) climateMonitor.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
