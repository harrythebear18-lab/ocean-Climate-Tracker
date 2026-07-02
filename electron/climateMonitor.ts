import { ClimateStation, ClimateMeasurement, ClimateStats, TrafficDataPoint, ClimateAlert, DataSource, IntegritySummary, IntegrityUpdate, SensorHealth, DataFlowHealth, CrossVerification, Storm, LightningStrike, Vessel } from '../src/types';
import { ErddapFetcher } from './dataFetcher';
import { WeatherFetcher, StormFetcher, LightningFetcher } from './weatherFetcher';
import { SensorVerifier } from './sensorVerifier';
import { DataFlowMonitor } from './dataFlowMonitor';
import { ResultsVerifier } from './resultsVerifier';
import { HeuristicWatchdog } from './heuristicWatchdog';
import { VesselFetcher } from './vesselFetcher';

const STALE_DATA_MINUTES = 120;

const SOURCE_EXPECTED_INTERVAL_MS: Record<DataSource, number> = {
  NOAA_NDBC: 10 * 60 * 1000,
  ARGO: 10 * 24 * 60 * 60 * 1000,
  BGC_ARGO: 10 * 24 * 60 * 60 * 1000,
  NOAA_ERDDAP: 10 * 60 * 1000,
  GTSPP: 24 * 60 * 60 * 1000,
  TAO_PIRATA: 24 * 60 * 60 * 1000,
  PMEL_CO2: 3 * 60 * 60 * 1000,
  NWS_WEATHER: 60 * 60 * 1000,
  NHC_STORM: 2 * 60 * 1000,
  BLITZORTUNG_LIGHTNING: 60 * 1000,
};

const STALE_THRESHOLD_MS = 3 * 60 * 60 * 1000;
const INVALIDATION_RESET_MS = 2 * 60 * 60 * 1000; // Reset invalidation after 2 hours to force re-verification

export class ClimateMonitor {
  private stations: ClimateStation[] = [];
  private measurements = new Map<string, ClimateMeasurement>();
  private previousStationIds = new Set<string>();
  private onUpdate: (stations: ClimateStation[], measurements: [string, ClimateMeasurement][], stats: ClimateStats) => void;
  private onTraffic: (data: TrafficDataPoint) => void;
  private onAlert: (alert: ClimateAlert) => void;
  private onIntegrityUpdate: (update: IntegrityUpdate) => void;
  private intervalId: NodeJS.Timeout | null = null;
  private fetchInProgress = false;
  private snoozeUntil = 0;
  private whitelistedStations = new Set<string>();
  private invalidatedStations = new Map<string, { reason: string; since: number }>();
  private lastMeasurementTimestamps = new Map<string, number>();

  private sensorVerifier: SensorVerifier;
  private dataFlowMonitor: DataFlowMonitor;
  private resultsVerifier: ResultsVerifier;
  private heuristicWatchdog: HeuristicWatchdog;

  private lastIntegritySummary: IntegritySummary | null = null;
  private lastStorms: Storm[] = [];
  private lastLightning: LightningStrike[] = [];
  private lastVessels: Vessel[] = [];

  constructor(
    onUpdate: (stations: ClimateStation[], measurements: [string, ClimateMeasurement][], stats: ClimateStats) => void,
    onTraffic: (data: TrafficDataPoint) => void,
    onAlert: (alert: ClimateAlert) => void,
    onIntegrityUpdate: (update: IntegrityUpdate) => void
  ) {
    this.onUpdate = onUpdate;
    this.onTraffic = onTraffic;
    this.onAlert = onAlert;
    this.onIntegrityUpdate = onIntegrityUpdate;

    this.sensorVerifier = new SensorVerifier((alert) => this.emitAlert(alert));
    this.dataFlowMonitor = new DataFlowMonitor((alert) => this.emitAlert(alert));
    this.resultsVerifier = new ResultsVerifier((alert) => this.emitAlert(alert));
    this.heuristicWatchdog = new HeuristicWatchdog((alert) => this.emitAlert(alert));
  }

  private emitAlert(alert: ClimateAlert) {
    if (this.isSnoozed()) return;
    if (this.whitelistedStations.has(alert.stationId)) return;
    this.onAlert(alert);
  }

  start() {
    this.fetchAll();
    this.intervalId = setInterval(() => this.fetchAll(), 4 * 60 * 1000);
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  getPendingCount(): number {
    return this.fetchInProgress ? 1 : 0;
  }

  whitelistStation(stationId: string) {
    this.whitelistedStations.add(stationId);
  }

  unwhitelistStation(stationId: string) {
    this.whitelistedStations.delete(stationId);
  }

  getWhitelistedStations(): string[] {
    return Array.from(this.whitelistedStations);
  }

  setSnooze(ms: number) {
    this.snoozeUntil = ms > 0 ? Date.now() + ms : 0;
  }

  isSnoozed(): boolean {
    return Date.now() < this.snoozeUntil;
  }

  private async fetchAll() {
    if (this.fetchInProgress) return;
    this.fetchInProgress = true;

    const allStations: ClimateStation[] = [];
    const allMeasurements = new Map<string, ClimateMeasurement>();
    const dataFlowResults: DataFlowHealth[] = [];

    const sourceConfigs: { source: DataSource; fetchFn: () => Promise<{ stations: ClimateStation[]; measurements: Map<string, ClimateMeasurement> }> }[] = [
      {
        source: 'NOAA_NDBC',
        fetchFn: async () => ErddapFetcher.fetchNDBC(),
      },
      {
        source: 'TAO_PIRATA',
        fetchFn: async () => ErddapFetcher.fetchTAO(),
      },
      {
        source: 'TAO_PIRATA',
        fetchFn: async () => ErddapFetcher.fetchTAOCurrents(),
      },
      {
        source: 'TAO_PIRATA',
        fetchFn: async () => ErddapFetcher.fetchTAOSalinity(),
      },
      {
        source: 'GTSPP',
        fetchFn: async () => ErddapFetcher.fetchGTSPP(),
      },
      {
        source: 'ARGO',
        fetchFn: async () => ErddapFetcher.fetchArgo(),
      },
      {
        source: 'PMEL_CO2',
        fetchFn: async () => ErddapFetcher.fetchCO2(),
      },
      {
        source: 'NWS_WEATHER',
        fetchFn: async () => WeatherFetcher.fetchNWS(),
      },
    ];

    const fetchResults = await Promise.all(
      sourceConfigs.map(async (cfg) => {
        const startTime = Date.now();
        try {
          const result = await cfg.fetchFn();
          const latency = Date.now() - startTime;
          const payloadSize = JSON.stringify(result).length;

          const flowHealth = this.dataFlowMonitor.recordFetch(
            cfg.source,
            latency,
            payloadSize,
            result.stations.length,
            result.stations.length,
            new Map(Array.from(result.measurements.entries()).map(([k, v]) => [k, { timestamp: v.timestamp, stationId: k }])),
            true
          );
          dataFlowResults.push(flowHealth);

          return result;
        } catch (e) {
          const latency = Date.now() - startTime;
          const flowHealth = this.dataFlowMonitor.recordFetch(
            cfg.source,
            latency,
            0,
            0,
            0,
            new Map(),
            false
          );
          dataFlowResults.push(flowHealth);
          return null;
        }
      })
    );

    for (const result of fetchResults) {
      if (result) {
        allStations.push(...result.stations);
        result.measurements.forEach((v, k) => allMeasurements.set(k, v));
      }
    }

    // Detect new stations
    const newStations: ClimateStation[] = [];
    for (const s of allStations) {
      if (!this.previousStationIds.has(s.id)) {
        newStations.push(s);
        this.emitAlert({
          id: `new_sensor_${s.id}_${Date.now()}`,
          timestamp: Date.now(),
          type: 'new_sensor',
          stationId: s.id,
          stationName: s.name,
          source: s.source,
          lat: s.lat,
          lon: s.lon,
          message: `New sensor detected: ${s.name} (${s.source})`,
          severity: 'info',
        });
      }
    }

    // ── Send stations & measurements to UI immediately (before verification) ──
    const quickStats = this.computeStats(allStations, allMeasurements);
    this.stations = allStations;
    this.measurements = allMeasurements;
    this.previousStationIds = new Set(allStations.map((s) => s.id));
    this.onUpdate(allStations, Array.from(allMeasurements.entries()), quickStats);

    // Send early traffic data point so climate activity graph populates immediately
    this.onTraffic({
      timestamp: Date.now(),
      totalStations: allStations.length,
      activeStations: allStations.filter((s) => s.active).length,
      newMeasurements: allMeasurements.size,
      avgWaterTemp: quickStats.avgWaterTemp,
      avgCO2: quickStats.avgCO2,
      integrityScore: 0,
      sensorsVerified: 0,
      sensorsFlagged: 0,
    });

    // ── Layer 1: Sensor Verification ──
    const sensorHealth = this.sensorVerifier.verify(allStations, allMeasurements);

    // ── Layer 2: Data Flow (already recorded above) ──

    // ── Layer 3: Results Cross-Verification ──
    const crossVerifications = await this.resultsVerifier.verify(allStations, allMeasurements);

    // ── Layer 4: Heuristic Watchdog ──
    this.heuristicWatchdog.verify(allStations, allMeasurements, crossVerifications);

    // ── Layer 5: Auto-invalidation & reset ──
    this.applyInvalidation(allStations, allMeasurements, crossVerifications);

    // ── Fetch storms, lightning & vessels (non-station data, parallel) ──
    const [storms, lightning, vessels] = await Promise.all([
      StormFetcher.fetchActiveStorms(),
      LightningFetcher.fetchRecent(),
      VesselFetcher.fetchVessels(),
    ]);
    this.lastStorms = storms;
    this.lastLightning = lightning;
    this.lastVessels = vessels;

    // ── Compute integrity summary ──
    const summary = this.computeIntegritySummary(sensorHealth, dataFlowResults, crossVerifications);
    this.lastIntegritySummary = summary;

    // Compute final stats (with verification data now available)
    const stats = this.computeStats(allStations, allMeasurements);

    // Send integrity update
    this.onIntegrityUpdate({
      sensorHealth: Array.from(sensorHealth.entries()),
      dataFlowHealth: dataFlowResults,
      crossVerifications,
      summary,
      timestamp: Date.now(),
      storms,
      lightningStrikes: lightning,
      vessels,
      newStations,
    });

    // Send traffic data point
    this.onTraffic({
      timestamp: Date.now(),
      totalStations: allStations.length,
      activeStations: allStations.filter((s) => s.active).length,
      newMeasurements: allMeasurements.size,
      avgWaterTemp: stats.avgWaterTemp,
      avgCO2: stats.avgCO2,
      integrityScore: summary.overallScore,
      sensorsVerified: summary.sensorsVerified,
      sensorsFlagged: summary.sensorsWarning + summary.sensorsFailed,
    });

    this.fetchInProgress = false;
  }

  private applyInvalidation(
    stations: ClimateStation[],
    measurements: Map<string, ClimateMeasurement>,
    crossVerifications: CrossVerification[]
  ) {
    const INVALIDATING_FLAG_TYPES = new Set([
      'cluster_outlier',
      'cross_source_mismatch',
      'regional_anomaly',
      'stuck_sensor',
    ]);

    // Step 1: Detect new invalidations from this cycle's flags
    for (const ver of crossVerifications) {
      const station = stations.find((s) => s.id === ver.stationId);
      const isArgo = station?.source === 'ARGO' || station?.source === 'BGC_ARGO';
      const isCO2 = station?.source === 'PMEL_CO2';

      // Argo floats and CO2 moorings are reference/sparse sources — don't invalidate them
      // CO2 moorings report infrequently (months) and shouldn't be flagged as stuck
      // Also only invalidate on critical severity, not mere warnings
      const invalidatingFlags = ver.flags.filter(
        (f) => !isArgo && !isCO2 && INVALIDATING_FLAG_TYPES.has(f.type) && f.severity === 'critical'
      );

      if (invalidatingFlags.length > 0) {
        const existing = this.invalidatedStations.get(ver.stationId);

        // Only invalidate if not already invalidated
        if (!existing) {
          const reason = invalidatingFlags
            .map((f) => `${f.type}: ${f.message}`)
            .join('; ');
          this.invalidatedStations.set(ver.stationId, {
            reason,
            since: Date.now(),
          });
        }
      }
    }

    // Step 2: Check if invalidated stations have fresh data or enough time has passed
    const toReset: string[] = [];
    for (const [stationId, info] of this.invalidatedStations) {
      const m = measurements.get(stationId);
      if (!m) continue;

      const prevTs = this.lastMeasurementTimestamps.get(stationId);
      const currentTs = m.timestamp;

      // Reset if fresh data arrived (timestamp changed)
      if (prevTs !== undefined && currentTs !== prevTs && currentTs > prevTs) {
        toReset.push(stationId);
        continue;
      }

      // Also reset if the station's expected interval has elapsed since invalidation
      // This prevents long-interval sources (e.g. Argo: 10 days) from staying invalidated
      // when their data simply hasn't updated yet but the invalidation was spurious
      const station = stations.find((s) => s.id === stationId);
      if (station) {
        // Use fixed 2-hour window for all stations to force periodic re-verification
        if (Date.now() - info.since > INVALIDATION_RESET_MS) {
          toReset.push(stationId);
        }
      }
    }

    // Step 3: Apply reset
    for (const stationId of toReset) {
      this.invalidatedStations.delete(stationId);
    }

    // Step 4: Update timestamp tracking for all stations
    for (const [stationId, m] of measurements) {
      this.lastMeasurementTimestamps.set(stationId, m.timestamp);
    }

    // Step 5: Mark stations as invalidated in the station objects
    for (const station of stations) {
      const inv = this.invalidatedStations.get(station.id);
      if (inv) {
        station.invalidated = true;
        station.invalidationReason = inv.reason;
      } else {
        station.invalidated = false;
        station.invalidationReason = undefined;
      }
    }

    // Step 6: Override verification status for invalidated stations
    for (const ver of crossVerifications) {
      if (this.invalidatedStations.has(ver.stationId)) {
        ver.status = 'invalidated';
        ver.verificationScore = 0;
      }
    }
  }

  private computeIntegritySummary(
    sensorHealth: Map<string, SensorHealth>,
    dataFlow: DataFlowHealth[],
    crossVerifications: CrossVerification[]
  ): IntegritySummary {
    const sensors = Array.from(sensorHealth.values());
    const sensorsVerified = sensors.filter((s) => s.status === 'verified').length;
    const sensorsWarning = sensors.filter((s) => s.status === 'warning').length;
    const sensorsFailed = sensors.filter((s) => s.status === 'failed').length;

    const sensorLayerScore = sensors.length > 0
      ? sensors.reduce((a, s) => a + s.integrityScore, 0) / sensors.length
      : 0;

    const pipelinesActive = dataFlow.filter((d) => d.status === 'verified').length;
    const pipelinesDegraded = dataFlow.filter((d) => d.status === 'warning' || d.status === 'failed').length;
    const dataFlowLayerScore = dataFlow.length > 0
      ? dataFlow.reduce((a, d) => a + d.pipelineScore, 0) / dataFlow.length
      : 0;

    const resultsValidated = crossVerifications.length;
    const resultsFlagged = crossVerifications.filter((v) => v.flags.length > 0).length;
    const resultsLayerScore = crossVerifications.length > 0
      ? crossVerifications.reduce((a, v) => a + v.verificationScore, 0) / crossVerifications.length
      : 0;

    let totalFlags = 0;
    let criticalFlags = 0;
    let warningFlags = 0;
    let crossSourceMatches = 0;
    let crossSourceMismatches = 0;

    for (const v of crossVerifications) {
      for (const f of v.flags) {
        totalFlags++;
        if (f.severity === 'critical') criticalFlags++;
        else if (f.severity === 'warning') warningFlags++;
      }
      for (const cs of v.crossSourceAgreement) {
        if (cs.agreement) crossSourceMatches++;
        else crossSourceMismatches++;
      }
    }

    const overallScore = (sensorLayerScore + dataFlowLayerScore + resultsLayerScore) / 3;

    return {
      overallScore,
      sensorLayerScore,
      dataFlowLayerScore,
      resultsLayerScore,
      totalSensorsMonitored: sensors.length,
      sensorsVerified,
      sensorsWarning,
      sensorsFailed,
      pipelinesActive,
      pipelinesDegraded,
      resultsValidated,
      resultsFlagged,
      totalFlags,
      criticalFlags,
      warningFlags,
      dataPointsVerified: this.measurements.size,
      crossSourceMatches,
      crossSourceMismatches,
    };
  }

  private computeStats(stations: ClimateStation[], measurements: Map<string, ClimateMeasurement>): ClimateStats {
    const activeStations = stations.filter((s) => s.active);
    const buoys = stations.filter((s) => s.type === 'buoy').length;
    const argoFloats = stations.filter((s) => s.type === 'argo_float').length;
    const bgcArgoFloats = stations.filter((s) => s.type === 'bgc_argo_float').length;
    const carbonStations = stations.filter((s) => s.type === 'carbon_station').length;
    const weatherStations = stations.filter((s) => s.type === 'weather_station').length;

    const waterTemps: number[] = [];
    const airTemps: number[] = [];
    const co2Values: number[] = [];
    const waveHeights: number[] = [];
    let freshCount = 0;

    for (const m of measurements.values()) {
      if (m.waterTemp !== undefined && m.waterTemp > -5 && m.waterTemp < 50) {
        waterTemps.push(m.waterTemp);
      }
      if (m.airTemp !== undefined && m.airTemp > -80 && m.airTemp < 60) {
        airTemps.push(m.airTemp);
      }
      if (m.co2 !== undefined && m.co2 > 300 && m.co2 < 600) {
        co2Values.push(m.co2);
      }
      if (m.waveHeight !== undefined && m.waveHeight >= 0 && m.waveHeight < 30) {
        waveHeights.push(m.waveHeight);
      }
      if (Date.now() - m.timestamp < STALE_DATA_MINUTES * 60 * 1000) freshCount++;
    }

    const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const max = (arr: number[]) => (arr.length > 0 ? Math.max(...arr) : 0);
    const min = (arr: number[]) => (arr.length > 0 ? Math.min(...arr) : 0);

    return {
      totalStations: stations.length,
      activeStations: activeStations.length,
      buoys,
      argoFloats,
      bgcArgoFloats,
      carbonStations,
      weatherStations,
      avgWaterTemp: avg(waterTemps),
      avgAirTemp: avg(airTemps),
      maxWaterTemp: max(waterTemps),
      minWaterTemp: min(waterTemps),
      avgCO2: avg(co2Values),
      avgWaveHeight: avg(waveHeights),
      anomalies: 0,
      dataFreshness: measurements.size > 0 ? (freshCount / measurements.size) * 100 : 0,
    };
  }
}
