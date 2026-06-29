# 🌊 ClimateOcean Tracker

A real-time planetary climate and ocean monitoring dashboard built with Electron, React, and Leaflet. Aggregates live data from multiple scientific sources to visualize ocean conditions, weather stations, vessel traffic, storm tracks, and lightning strikes on an interactive dark-themed world map.

## Features

### Live Data Sources
- **NOAA NDBC** — Ocean buoy stations (wave height, water temp, wind, pressure)
- **Argo Floats** — Global ocean profiling floats (temperature/salinity at depth)
- **PMEL CO2 Moorings** — Ocean carbon flux stations
- **Aviation METAR** — Global airport weather observations
- **NHC** — Active tropical cyclone tracks (free, no API key)
- **Blitzortung.org** — Real-time lightning detection via WebSocket (free, no API key)
- **Axiom Overwatch** — AIS vessel positions (tankers, cargo, bulk carriers, LNG)

### Map Overlays
- **Shipping Lanes** — 10 major global maritime routes (Trans-Pacific, Suez, Cape Horn, Northern Sea Route, etc.) with traffic-level coloring
- **Storm Tracks** — Active tropical cyclones with forecast tracks and intensity
- **Lightning Strikes** — Real-time strike locations with polarity, age-faded
- **AIS Vessels** — Ship positions colored by type, with speed/course/destination tooltips
- **Density Heatmap** — Station density visualization
- **Bathymetry** — ETOPO1 ocean depth rendering

### Additional Features
- **Integrity Dashboard** — Cross-verification of sensor data, anomaly detection, station health monitoring
- **Alert System** — Threshold-based alerts with whitelist/snooze controls
- **Traffic Graph** — Historical data throughput visualization
- **Stats Bar** — Live station counts, connection status, pending fetches

## Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| Windows  | ✅ Full | NSIS installer via `npm run dist:win` |
| macOS    | ✅ Full | Hidden title bar, vibrancy, DMG via `npm run dist:mac` (Apple Silicon & Intel) |
| Linux    | ✅ Builds | Not explicitly tested but Electron cross-platform |

### macOS-Specific
- Hidden inset title bar with traffic light positioning
- Under-window vibrancy effect
- About panel with data source credits
- Dock activation support (re-opens window on click)

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) 18+ and npm
- Git

### Install & Run (Development)
```bash
git clone https://github.com/harrythebear18-lab/ocean-Climate-Tracker.git
cd ocean-Climate-Tracker
npm install
npm run dev
```

### Build for Production
```bash
# Build renderer + electron TypeScript
npm run build

# Package for current platform
npm run dist:win          # Windows NSIS installer
npm run dist:mac          # macOS DMG (Apple Silicon)
npm run dist:mac-intel    # macOS DMG (Intel)
npm run dist:mac-universal # macOS DMG (Universal binary)
```

Packaged apps are output to `dist-packaged/`.

## Optional API Keys

The app works out-of-the-box with free data sources (NDBC, Argo, ICOS, METAR, NHC, Blitzortung). For enhanced storm and lightning data, set these environment variables:

```bash
# Vaisala XWeather — tropical cyclone tracks & lightning strikes
export XWEATHER_CLIENT_ID="your_id"
export XWEATHER_CLIENT_SECRET="your_secret"

# Meteomatics — thunderstorm tracks & lightning list
export METEOMATICS_USERNAME="your_username"
export METEOMATICS_PASSWORD="your_password"
```

Without these, the app falls back to NHC (storms) and Blitzortung (lightning) — both free and keyless.

## Tech Stack

- **Electron** 42 — Cross-platform desktop runtime
- **React** 18 — UI framework
- **TypeScript** 5.5 — Type safety
- **Vite** 5 — Build tooling & dev server
- **Leaflet** 1.9 — Interactive mapping
- **TailwindCSS** 3.4 — Styling
- **ws** — WebSocket client (Blitzortung lightning feed)
- **Lucide React** — Icon set

## Project Structure

```
├── electron/
│   ├── main.ts            # Electron entry point, window creation
│   ├── preload.ts         # Context bridge (IPC API)
│   ├── climateMonitor.ts  # Main data orchestration loop
│   ├── dataFetcher.ts     # NDBC / Argo / ICOS station fetchers
│   ├── weatherFetcher.ts  # METAR, storm, lightning fetchers
│   ├── vesselFetcher.ts   # AIS vessel position fetcher
│   ├── bathymetryCache.ts # ETOPO1 depth grid cache
│   ├── sensorVerifier.ts  # Data integrity verification
│   ├── resultsVerifier.ts # Cross-verification logic
│   ├── heuristicWatchdog.ts # Anomaly detection
│   └── dataFlowMonitor.ts # Throughput monitoring
├── src/
│   ├── App.tsx            # Root component, layout
│   ├── types.ts           # Shared TypeScript types
│   ├── components/
│   │   ├── OceanMap.tsx   # Leaflet map with all overlays
│   │   ├── StationList.tsx# Sidebar station browser
│   │   ├── StatsBar.tsx   # Top stats bar
│   │   ├── ClimateGraph.tsx # Traffic history graph
│   │   ├── AlertPanel.tsx # Alert notifications
│   │   └── IntegrityDashboard.tsx # Sensor health panel
│   ├── data/
│   │   └── shippingLanes.ts # Static shipping lane coordinates
│   └── hooks/
│       └── useClimateData.ts # React hook for IPC data
├── build/
│   └── entitlements.mac.plist # macOS sandbox entitlements
└── package.json           # Scripts, dependencies, electron-builder config
```

## Data Sources & Attribution

| Source | Data | License | Key Required |
|--------|------|---------|--------------|
| NOAA NDBC | Buoy observations | Public domain | No |
| Argo | Ocean profiles | CC BY 4.0 | No |
| PMEL CO2 Moorings | Carbon flux | Public domain | No |
| AviationWeather.gov | METAR | Public domain | No |
| NHC | Tropical cyclones | Public domain | No |
| Blitzortung.org | Lightning | Non-commercial | No |
| Vaisala Xweather | Storms, lightning | Commercial | Yes |
| Meteomatics | Storms, lightning | Commercial | Yes |
| Axiom Overwatch | AIS vessels | API access | Yes |

## License

MIT — See [LICENSE](LICENSE) file for details.

## Credits

Built by [harrythebear18-lab](https://github.com/harrythebear18-lab)

Data provided by NOAA, NHC, Argo, ICOS, Blitzortung.org, and the global weather community.
