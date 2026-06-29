export type DataSource = 'NOAA_NDBC' | 'ARGO' | 'BGC_ARGO' | 'NOAA_ERDDAP' | 'GTSPP' | 'TAO_PIRATA' | 'PMEL_CO2' | 'NWS_WEATHER' | 'NHC_STORM' | 'BLITZORTUNG_LIGHTNING';

export type StationType = 'buoy' | 'argo_float' | 'bgc_argo_float' | 'carbon_station' | 'weather_station' | 'storm' | 'lightning';

export type IntegrityStatus = 'verified' | 'warning' | 'failed' | 'stale' | 'unknown' | 'invalidated';

export interface ClimateStation {
  id: string;
  name: string;
  type: StationType;
  source: DataSource;
  lat: number;
  lon: number;
  elevation?: number;
  depth?: number;
  country?: string;
  region?: string;
  owner?: string;
  lastUpdate: number;
  active: boolean;
  invalidated?: boolean;
  invalidationReason?: string;
}

export interface ClimateMeasurement {
  stationId: string;
  timestamp: number;
  waterTemp?: number;
  airTemp?: number;
  windSpeed?: number;
  windDir?: number;
  waveHeight?: number;
  wavePeriod?: number;
  pressure?: number;
  salinity?: number;
  co2?: number;
  chl?: number;
  currentSpeed?: number;
  currentDir?: number;
  depth?: number;
  oxygen?: number;
  nitrate?: number;
  ph?: number;
}

export interface StormTrackPoint {
  lat: number;
  lon: number;
  timestamp: number;
  windSpeedKt?: number;
  pressureMB?: number;
  category?: string;
  forecastHour?: number;
}

export interface Storm {
  id: string;
  name: string;
  basin: string;
  type: string;
  classification: string;
  intensity: string;
  lat: number;
  lon: number;
  windSpeedKt?: number;
  pressureMB?: number;
  movementDir?: string;
  movementSpeedKt?: number;
  lastUpdate: number;
  track: StormTrackPoint[];
  forecastTrack: StormTrackPoint[];
}

export interface LightningStrike {
  id: string;
  lat: number;
  lon: number;
  timestamp: number;
  amplitude?: number;
  polarity?: 'positive' | 'negative';
}

export interface Vessel {
  imo: string;
  name: string;
  lat: number;
  lon: number;
  speed?: number;
  course?: number;
  draft?: number;
  vesselType?: string;
  flag?: string;
  navStatus?: string;
  destination?: string;
  timestamp: number;
}

export interface CfVariableMap {
  field: keyof ClimateMeasurement;
  standardName: string;
  longName: string;
  units: string;
}

export const CF_VARIABLE_MAP: CfVariableMap[] = [
  { field: 'waterTemp', standardName: 'sea_surface_temperature', longName: 'Sea Surface Temperature', units: 'degree_C' },
  { field: 'airTemp', standardName: 'air_temperature', longName: 'Air Temperature', units: 'degree_C' },
  { field: 'windSpeed', standardName: 'wind_speed', longName: 'Wind Speed', units: 'm s-1' },
  { field: 'windDir', standardName: 'wind_from_direction', longName: 'Wind From Direction', units: 'degrees_true' },
  { field: 'waveHeight', standardName: 'sea_surface_wave_significant_height', longName: 'Significant Wave Height', units: 'm' },
  { field: 'wavePeriod', standardName: 'sea_surface_swell_wave_period', longName: 'Dominant Wave Period', units: 's' },
  { field: 'pressure', standardName: 'air_pressure_at_sea_level', longName: 'Air Pressure at Sea Level', units: 'hPa' },
  { field: 'salinity', standardName: 'sea_water_practical_salinity', longName: 'Practical Salinity', units: 'PSU' },
  { field: 'co2', standardName: 'mole_fraction_of_carbon_dioxide_in_air', longName: 'CO2 Mole Fraction', units: 'ppm' },
  { field: 'currentSpeed', standardName: 'sea_water_speed', longName: 'Sea Water Speed', units: 'cm s-1' },
  { field: 'currentDir', standardName: 'direction_of_sea_water_velocity', longName: 'Direction of Sea Water Velocity', units: 'degrees_true' },
  { field: 'depth', standardName: 'depth', longName: 'Depth', units: 'm' },
];

// ─── Sensor Verification Layer ───

export interface SensorHealth {
  stationId: string;
  status: IntegrityStatus;
  integrityScore: number;
  lastTransmission: number;
  expectedIntervalMs: number;
  actualIntervalMs: number;
  transmissionCount: number;
  missedTransmissions: number;
  transmissionRegularity: number;
  fieldsExpected: string[];
  fieldsReceived: string[];
  fieldsMissing: string[];
  driftDetected: boolean;
  driftDetails: string[];
  calibrationStatus: 'ok' | 'drift' | 'unknown';
  consecutiveFailures: number;
  uptimePercent: number;
  checks: SensorCheck[];
}

export interface SensorCheck {
  check: string;
  status: IntegrityStatus;
  message: string;
  value?: string;
}

// ─── Data Flow Verification Layer ───

export interface DataFlowHealth {
  source: DataSource;
  sourceName: string;
  status: IntegrityStatus;
  pipelineScore: number;
  lastFetchTime: number;
  fetchLatencyMs: number;
  avgLatencyMs: number;
  payloadSizeBytes: number;
  stationsExpected: number;
  stationsReceived: number;
  completenessPercent: number;
  duplicateCount: number;
  outOfOrderCount: number;
  missingFieldCount: number;
  totalPackets: number;
  droppedPackets: number;
  pipelineChecks: PipelineCheck[];
  latencyHistory: number[];
}

export interface PipelineCheck {
  check: string;
  status: IntegrityStatus;
  message: string;
}

// ─── Results Verification Layer ───

export interface CrossVerification {
  stationId: string;
  stationName: string;
  source: DataSource;
  lat: number;
  lon: number;
  status: IntegrityStatus;
  verificationScore: number;
  measurement: ClimateMeasurement;
  nearbyComparisons: NearbyComparison[];
  physicalPlausibility: PhysicalCheck[];
  statisticalOutlier: StatisticalCheck;
  temporalConsistency: TemporalCheck;
  crossSourceAgreement: CrossSourceCheck[];
  flags: VerificationFlag[];
}

export interface NearbyComparison {
  stationId: string;
  stationName: string;
  source: DataSource;
  distanceKm: number;
  field: string;
  theirValue: number;
  ourValue: number;
  delta: number;
  withinTolerance: boolean;
}

export interface PhysicalCheck {
  field: string;
  value: number;
  min: number;
  max: number;
  passed: boolean;
  message: string;
}

export interface StatisticalCheck {
  status: IntegrityStatus;
  zScore: number;
  mean: number;
  stdDev: number;
  sampleSize: number;
  message: string;
}

export interface TemporalCheck {
  status: IntegrityStatus;
  previousValue?: number;
  currentValue: number;
  rateOfChange: number;
  maxExpectedRate: number;
  message: string;
}

export interface CrossSourceCheck {
  field: string;
  sources: string[];
  values: number[];
  spread: number;
  agreement: boolean;
  message: string;
}

export interface VerificationFlag {
  type: 'sensor_drift' | 'data_gap' | 'statistical_outlier' | 'physical_implausible' | 'cross_source_mismatch' | 'temporal_jump' | 'pipeline_error' | 'calibration_issue' | 'stuck_sensor' | 'field_correlation' | 'regional_anomaly' | 'cluster_outlier' | 'data_uniformity' | 'argo_reference_mismatch' | 'bathymetry_mismatch' | 'density_anomaly' | 'missing_data';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  field?: string;
}

// ─── Aggregate Integrity ───

export interface IntegritySummary {
  overallScore: number;
  sensorLayerScore: number;
  dataFlowLayerScore: number;
  resultsLayerScore: number;
  totalSensorsMonitored: number;
  sensorsVerified: number;
  sensorsWarning: number;
  sensorsFailed: number;
  pipelinesActive: number;
  pipelinesDegraded: number;
  resultsValidated: number;
  resultsFlagged: number;
  totalFlags: number;
  criticalFlags: number;
  warningFlags: number;
  dataPointsVerified: number;
  crossSourceMatches: number;
  crossSourceMismatches: number;
}

// ─── Stats & Updates ───

export interface ClimateStats {
  totalStations: number;
  activeStations: number;
  buoys: number;
  argoFloats: number;
  bgcArgoFloats: number;
  carbonStations: number;
  weatherStations: number;
  avgWaterTemp: number;
  avgAirTemp: number;
  maxWaterTemp: number;
  minWaterTemp: number;
  avgCO2: number;
  avgWaveHeight: number;
  anomalies: number;
  dataFreshness: number;
}

export interface MonitorUpdate {
  stations: ClimateStation[];
  measurements: [string, ClimateMeasurement][];
  stats: ClimateStats;
  timestamp: number;
  pendingFetches: number;
  storms?: Storm[];
  lightningStrikes?: LightningStrike[];
}

export interface IntegrityUpdate {
  sensorHealth: [string, SensorHealth][];
  dataFlowHealth: DataFlowHealth[];
  crossVerifications: CrossVerification[];
  summary: IntegritySummary;
  timestamp: number;
  storms?: Storm[];
  lightningStrikes?: LightningStrike[];
  vessels?: Vessel[];
  newStations?: ClimateStation[];
}

export interface TrafficDataPoint {
  timestamp: number;
  totalStations: number;
  activeStations: number;
  newMeasurements: number;
  avgWaterTemp: number;
  avgCO2: number;
  integrityScore: number;
  sensorsVerified: number;
  sensorsFlagged: number;
}

export interface ClimateAlert {
  id: string;
  timestamp: number;
  type: 'sensor_drift' | 'data_gap' | 'statistical_outlier' | 'physical_implausible' | 'cross_source_mismatch' | 'temporal_jump' | 'pipeline_error' | 'calibration_issue' | 'new_sensor' | 'sensor_offline' | 'stuck_sensor' | 'field_correlation' | 'regional_anomaly' | 'cluster_outlier' | 'data_uniformity';
  stationId: string;
  stationName: string;
  source: DataSource;
  lat: number;
  lon: number;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  field?: string;
}

