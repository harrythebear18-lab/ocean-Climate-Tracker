import { ClimateStation, ClimateMeasurement, CrossVerification, NearbyComparison, PhysicalCheck, StatisticalCheck, TemporalCheck, CrossSourceCheck, VerificationFlag, IntegrityStatus, ClimateAlert } from '../src/types';
import { ensureBathymetryGrid, getOceanDepth } from './bathymetryCache';

const PHYSICAL_BOUNDS: Record<string, { min: number; max: number }> = {
  waterTemp: { min: -5, max: 50 },
  airTemp: { min: -80, max: 60 },
  windSpeed: { min: 0, max: 120 },
  waveHeight: { min: 0, max: 30 },
  pressure: { min: 850, max: 1100 },
  salinity: { min: 0, max: 45 },
  co2: { min: 300, max: 600 },
  chl: { min: 0, max: 50 },
  currentSpeed: { min: 0, max: 300 },
  oxygen: { min: 0, max: 400 },
  nitrate: { min: 0, max: 50 },
  ph: { min: 6, max: 9 },
};

const MAX_RATE_OF_CHANGE: Record<string, number> = {
  waterTemp: 5,    // °C per interval
  airTemp: 15,     // °C per interval
  windSpeed: 50,   // m/s per interval
  waveHeight: 10,  // m per interval
  pressure: 20,    // hPa per interval
  salinity: 5,     // PSU per interval
  co2: 30,         // ppm per interval
};

const NEARBY_RADIUS_KM = 500;
const TEMP_TOLERANCE = 5;     // °C
const SALINITY_TOLERANCE = 3; // PSU
const CO2_TOLERANCE = 30;     // ppm
const DENSITY_TOLERANCE = 2;  // kg/m³

// ─── Seawater Density (UNESCO EOS-80 simplified) ───
function seawaterDensity(tempC: number, salinity: number, depthM: number): number {
  const T = tempC;
  const S = salinity;
  const P = depthM / 10; // decibars approx

  const A = 999.842594 + 6.793952e-2 * T - 9.095290e-3 * T * T
    + 1.001685e-4 * T * T * T - 1.120083e-6 * T * T * T * T + 6.536332e-9 * T * T * T * T * T;
  const B = 8.24493e-1 - 4.0899e-3 * T + 7.6438e-5 * T * T - 8.2467e-7 * T * T * T + 5.3875e-9 * T * T * T * T;
  const C = -5.72466e-3 + 1.0227e-4 * T - 1.6546e-6 * T * T;
  const D = 4.8314e-4;

  const rho0 = A + B * S + C * S * 1.5 + D * S * S;
  const kw = 19652.21 + 148.4206 * T - 2.327105 * T * T + 1.360477e-2 * T * T * T - 5.155288e-5 * T * T * T * T;
  const aw = 54.6746 - 0.60245 * T + 1.0099e-2 * T * T - 6.167e-5 * T * T * T;
  const bw = 7.944e-2 + 1.6483e-2 * T - 5.3009e-4 * T * T;

  const pTerm = P / (kw + aw * P + bw * P * P);
  return rho0 / (1 - pTerm / 10);
}

interface MeasurementHistory {
  previousMeasurements: Map<string, ClimateMeasurement>;
  fieldStats: Map<string, { values: number[]; mean: number; stdDev: number }>;
}

export class ResultsVerifier {
  private history: MeasurementHistory = {
    previousMeasurements: new Map(),
    fieldStats: new Map(),
  };
  private onAlert: (alert: ClimateAlert) => void;

  constructor(onAlert: (alert: ClimateAlert) => void) {
    this.onAlert = onAlert;
  }

  async verify(
    stations: ClimateStation[],
    measurements: Map<string, ClimateMeasurement>
  ): Promise<CrossVerification[]> {
    const results: CrossVerification[] = [];
    const stationMap = new Map(stations.map((s) => [s.id, s]));

    // Ensure bathymetry grid is loaded for depth checks
    await ensureBathymetryGrid();

    // Build spatial index for nearby comparisons
    const spatialIndex = this.buildSpatialIndex(stations, measurements);

    // Update field statistics
    this.updateFieldStats(measurements);

    for (const station of stations) {
      const m = measurements.get(station.id);
      if (!m) continue;

      const flags: VerificationFlag[] = [];
      const nearbyComparisons: NearbyComparison[] = [];
      const physicalChecks: PhysicalCheck[] = [];
      const crossSourceChecks: CrossSourceCheck[] = [];
      const isArgo = station.source === 'ARGO' || station.source === 'BGC_ARGO';

      // ── Layer 0: Data Completeness ──
      const sensorFields = ['waterTemp', 'airTemp', 'windSpeed', 'windDir', 'waveHeight', 'wavePeriod', 'pressure', 'salinity', 'co2', 'chl', 'currentSpeed', 'currentDir', 'oxygen', 'nitrate', 'ph'];
      const hasAnyData = sensorFields.some((f) => (m as any)[f] !== undefined);
      if (!hasAnyData) {
        flags.push({
          type: 'missing_data',
          severity: 'warning',
          message: `${station.name}: no sensor data values in measurement`,
          field: 'all',
        });
      }

      // ── Layer 1: Physical Plausibility ──
      for (const [field, bounds] of Object.entries(PHYSICAL_BOUNDS)) {
        const val = (m as any)[field] as number | undefined;
        if (val === undefined) continue;

        const passed = val >= bounds.min && val <= bounds.max;
        const check: PhysicalCheck = {
          field,
          value: val,
          min: bounds.min,
          max: bounds.max,
          passed,
          message: passed
            ? `${val.toFixed(2)} within [${bounds.min}, ${bounds.max}]`
            : `${val.toFixed(2)} outside valid range [${bounds.min}, ${bounds.max}]`,
        };
        physicalChecks.push(check);

        if (!passed) {
          flags.push({
            type: 'physical_implausible',
            severity: 'critical',
            message: `${station.name}: ${field} = ${val.toFixed(2)} outside physical bounds [${bounds.min}, ${bounds.max}]`,
            field,
          });
          this.fireAlert(station, 'physical_implausible', `${field}=${val.toFixed(1)} outside physical bounds`, 'critical', field);
        }
      }

      // ── Layer 2: Statistical Outlier Detection ──
      const field = 'waterTemp';
      const val = m.waterTemp;
      const stats = this.history.fieldStats.get(field);
      let statisticalCheck: StatisticalCheck;

      if (val !== undefined && stats && stats.values.length >= 5) {
        const zScore = stats.stdDev > 0 ? (val - stats.mean) / stats.stdDev : 0;
        const absZ = Math.abs(zScore);
        const status: IntegrityStatus = absZ < 2 ? 'verified' : absZ < 3 ? 'warning' : 'failed';
        statisticalCheck = {
          status,
          zScore,
          mean: stats.mean,
          stdDev: stats.stdDev,
          sampleSize: stats.values.length,
          message: `z=${zScore.toFixed(2)} (mean=${stats.mean.toFixed(1)}, σ=${stats.stdDev.toFixed(1)}, n=${stats.values.length})`,
        };

        if (absZ >= 3) {
          flags.push({
            type: 'statistical_outlier',
            severity: 'critical',
            message: `${station.name}: ${field} is a statistical outlier (z=${zScore.toFixed(2)})`,
            field,
          });
          this.fireAlert(station, 'statistical_outlier', `waterTemp z-score=${zScore.toFixed(1)} (extreme outlier)`, 'critical', field);
        } else if (absZ >= 2) {
          flags.push({
            type: 'statistical_outlier',
            severity: 'warning',
            message: `${station.name}: ${field} statistical outlier (z=${zScore.toFixed(2)})`,
            field,
          });
          this.fireAlert(station, 'statistical_outlier', `waterTemp z-score=${zScore.toFixed(1)}`, 'warning', field);
        }
      } else {
        statisticalCheck = {
          status: 'unknown',
          zScore: 0,
          mean: 0,
          stdDev: 0,
          sampleSize: stats?.values.length ?? 0,
          message: 'Insufficient data for statistical analysis',
        };
      }

      // ── Layer 3: Temporal Consistency ──
      const prev = this.history.previousMeasurements.get(station.id);
      let temporalCheck: TemporalCheck;

      if (prev?.waterTemp !== undefined && val !== undefined) {
        const rate = Math.abs(val - prev.waterTemp);
        const maxRate = MAX_RATE_OF_CHANGE['waterTemp'] ?? 10;
        const status: IntegrityStatus = rate <= maxRate ? 'verified' : rate <= maxRate * 2 ? 'warning' : 'failed';
        temporalCheck = {
          status,
          previousValue: prev.waterTemp,
          currentValue: val,
          rateOfChange: rate,
          maxExpectedRate: maxRate,
          message: `Δ=${rate.toFixed(2)}°C (max expected: ${maxRate}°C/interval)`,
        };

        if (rate > maxRate * 2) {
          flags.push({
            type: 'temporal_jump',
            severity: 'critical',
            message: `${station.name}: waterTemp jumped ${rate.toFixed(1)}°C (max expected: ${maxRate}°C)`,
            field: 'waterTemp',
          });
          this.fireAlert(station, 'temporal_jump', `waterTemp jumped ${rate.toFixed(1)}°C between readings`, 'critical', 'waterTemp');
        } else if (rate > maxRate) {
          flags.push({
            type: 'temporal_jump',
            severity: 'warning',
            message: `${station.name}: waterTemp rate of change ${rate.toFixed(1)}°C exceeds expected ${maxRate}°C`,
            field: 'waterTemp',
          });
          this.fireAlert(station, 'temporal_jump', `waterTemp rate ${rate.toFixed(1)}°C exceeds expected`, 'warning', 'waterTemp');
        }
      } else {
        temporalCheck = {
          status: 'unknown',
          currentValue: val ?? 0,
          rateOfChange: 0,
          maxExpectedRate: MAX_RATE_OF_CHANGE['waterTemp'] ?? 10,
          message: 'No previous measurement for temporal comparison',
        };
      }

      // ── Layer 4: Spatial Cross-Validation (nearby stations) ──
      if (val !== undefined) {
        const nearby = spatialIndex.get(station.id) ?? [];
        const myDepth = m?.depth;

        // For Argo: prefer comparing with other Argo floats first, then local buoys
        // For non-Argo: compare with Argo references and same-source neighbors
        let neighbors = nearby;
        if (isArgo) {
          // Sort: Argo neighbors first (especially similar depth), then buoys
          neighbors = nearby.slice().sort((a, b) => {
            const aArgo = a.station.source === 'ARGO' ? 0 : 1;
            const bArgo = b.station.source === 'ARGO' ? 0 : 1;
            if (aArgo !== bArgo) return aArgo - bArgo;
            // Among Argo, prefer similar depth
            if (aArgo === 0 && myDepth !== undefined) {
              const aDepthDiff = Math.abs((a.measurement.depth ?? 0) - myDepth);
              const bDepthDiff = Math.abs((b.measurement.depth ?? 0) - myDepth);
              return aDepthDiff - bDepthDiff;
            }
            return a.distanceKm - b.distanceKm;
          });
        }

        for (const n of neighbors.slice(0, 5)) {
          const theirTemp = n.measurement.waterTemp;
          if (theirTemp === undefined) continue;

          const delta = Math.abs(val - theirTemp);
          // Depth-aware tolerance: if comparing deep Argo with surface buoy, widen tolerance
          const myD = m?.depth ?? 0;
          const theirD = n.measurement.depth ?? 0;
          const depthDiff = Math.abs(myD - theirD);
          const depthToleranceBonus = depthDiff > 100 ? 8 : depthDiff > 20 ? 4 : 0;
          const effectiveTolerance = TEMP_TOLERANCE + depthToleranceBonus;
          const withinTolerance = delta <= effectiveTolerance;
          nearbyComparisons.push({
            stationId: n.station.id,
            stationName: n.station.name,
            source: n.station.source,
            distanceKm: n.distanceKm,
            field: 'waterTemp',
            theirValue: theirTemp,
            ourValue: val,
            delta,
            withinTolerance,
          });

          if (!withinTolerance && n.distanceKm < 200) {
            // Argo fidelity: if the nearby station is Argo, trust Argo and flag the non-Argo station
            // If this station IS Argo, only flag if the neighbor is also Argo at similar depth
            const neighborIsArgo = n.station.source === 'ARGO' || n.station.source === 'BGC_ARGO';
            const shouldFlag = isArgo
              ? (neighborIsArgo && depthDiff < 50)  // Argo only flagged by similar-depth Argo
              : true;

            if (shouldFlag) {
              const severity = neighborIsArgo ? 'critical' : 'warning';
              const reason = neighborIsArgo
                ? `Argo reference mismatch: Δ${delta.toFixed(1)}°C vs Argo ${n.station.name}`
                : `Δ${delta.toFixed(1)}°C over ${n.distanceKm.toFixed(0)}km`;

              flags.push({
                type: neighborIsArgo ? 'argo_reference_mismatch' : 'cross_source_mismatch',
                severity,
                message: `${station.name} vs ${n.station.name}: ${reason}`,
                field: 'waterTemp',
              });
              this.fireAlert(
                station,
                neighborIsArgo ? 'cross_source_mismatch' : 'cross_source_mismatch',
                neighborIsArgo
                  ? `waterTemp differs by ${delta.toFixed(1)}°C from Argo reference ${n.station.name} (${n.distanceKm.toFixed(0)}km away)`
                  : `waterTemp differs by ${delta.toFixed(1)}°C from ${n.station.name} (${n.distanceKm.toFixed(0)}km away)`,
                severity,
                'waterTemp'
              );
            }
          }
        }
      }

      // ── Layer 4b: Air Temp Spatial Cross-Validation (for weather stations) ──
      const airTempVal = m.airTemp;
      if (airTempVal !== undefined) {
        const nearby = spatialIndex.get(station.id) ?? [];
        const airNeighbors = nearby.filter((n) => n.measurement.airTemp !== undefined).slice(0, 5);

        for (const n of airNeighbors) {
          const theirAirTemp = n.measurement.airTemp!;
          const delta = Math.abs(airTempVal - theirAirTemp);
          const airTolerance = 10; // wider tolerance for air temp (terrain, elevation effects)
          const withinTolerance = delta <= airTolerance;
          nearbyComparisons.push({
            stationId: n.station.id,
            stationName: n.station.name,
            source: n.station.source,
            distanceKm: n.distanceKm,
            field: 'airTemp',
            theirValue: theirAirTemp,
            ourValue: airTempVal,
            delta,
            withinTolerance,
          });

          if (!withinTolerance && n.distanceKm < 200) {
            flags.push({
              type: 'cross_source_mismatch',
              severity: 'warning',
              message: `${station.name} vs ${n.station.name}: airTemp Δ${delta.toFixed(1)}°C over ${n.distanceKm.toFixed(0)}km`,
              field: 'airTemp',
            });
            this.fireAlert(
              station,
              'cross_source_mismatch',
              `airTemp differs by ${delta.toFixed(1)}°C from ${n.station.name} (${n.distanceKm.toFixed(0)}km away)`,
              'warning',
              'airTemp'
            );
            break;
          }
        }
      }

      // ── Layer 5: Cross-Source Agreement ──
      if (val !== undefined) {
        const sameArea = nearbyComparisons.filter((n) => n.source !== station.source && n.withinTolerance);
        if (sameArea.length > 0) {
          const values = [val, ...sameArea.map((n) => n.theirValue)];
          const sources = [station.source, ...sameArea.map((n) => n.source)];
          const spread = Math.max(...values) - Math.min(...values);
          const agreement = spread <= TEMP_TOLERANCE;
          crossSourceChecks.push({
            field: 'waterTemp',
            sources: sources.map((s) => s.toString()),
            values,
            spread,
            agreement,
            message: agreement
              ? `${sources.length} sources agree within ${spread.toFixed(1)}°C`
              : `Cross-source spread ${spread.toFixed(1)}°C exceeds tolerance`,
          });
        }
      }

      // ── Layer 6: Bathymetry / Depth Consistency ──
      const oceanDepth = getOceanDepth(station.lat, station.lon);
      if (oceanDepth !== undefined) {
        // Argo floats should be in deep water (>50m with grid tolerance)
        if (station.type === 'argo_float' && oceanDepth < 50) {
          flags.push({
            type: 'bathymetry_mismatch',
            severity: 'warning',
            message: `Argo float ${station.name} in shallow water (${oceanDepth.toFixed(0)}m) — expected deep ocean (>200m)`,
            field: 'depth',
          });
        }
        // Buoys reporting water temp should be in water (depth > 0)
        if (station.type === 'buoy' && oceanDepth === 0) {
          flags.push({
            type: 'bathymetry_mismatch',
            severity: 'critical',
            message: `Buoy ${station.name} appears to be on land (bathymetry elevation >= 0)`,
            field: 'depth',
          });
        }
        // Measurement depth should not exceed ocean depth (with tolerance for coarse grid)
        if (m.depth !== undefined && m.depth > oceanDepth + 500) {
          flags.push({
            type: 'bathymetry_mismatch',
            severity: 'warning',
            message: `Measurement depth ${m.depth.toFixed(0)}m exceeds ocean depth ${oceanDepth.toFixed(0)}m by >500m`,
            field: 'depth',
          });
        }
      }

      // ── Layer 7: Density Cross-Validation ──
      if (m.waterTemp !== undefined && m.salinity !== undefined) {
        const myDepth = m.depth ?? station.depth ?? 0;
        const myOceanDepth = getOceanDepth(station.lat, station.lon) ?? 0;
        const myDensity = seawaterDensity(m.waterTemp, m.salinity, myDepth);

        // Sanity: density should be physically plausible for the water column
        // Surface density typically 1020-1030, deep water up to ~1050
        if (myDensity < 990 || myDensity > 1090) {
          flags.push({
            type: 'density_anomaly',
            severity: 'critical',
            message: `Density ${myDensity.toFixed(1)} kg/m³ is physically implausible (temp=${m.waterTemp.toFixed(1)}°C, sal=${m.salinity.toFixed(1)}, depth=${myDepth.toFixed(0)}m)`,
            field: 'density',
          });
        }

        // If we know the ocean depth, check that measurement depth makes sense
        if (myOceanDepth > 0 && myDepth > myOceanDepth + 500) {
          flags.push({
            type: 'density_anomaly',
            severity: 'warning',
            message: `Measurement at ${myDepth.toFixed(0)}m but ocean floor is ${myOceanDepth.toFixed(0)}m — density may be unreliable`,
            field: 'density',
          });
        }

        // Compare density with nearby stations that also have temp+salinity
        // Argo-first sorting: Argo floats check each other first, then non-Argo
        let densityNeighbors = (spatialIndex.get(station.id) ?? [])
          .filter((n) => n.measurement.waterTemp !== undefined && n.measurement.salinity !== undefined);

        if (isArgo) {
          densityNeighbors = densityNeighbors.sort((a, b) => {
            const aArgo = a.station.source === 'ARGO' ? 0 : 1;
            const bArgo = b.station.source === 'ARGO' ? 0 : 1;
            if (aArgo !== bArgo) return aArgo - bArgo;
            // Among Argo, prefer similar depth
            if (aArgo === 0) {
              const aDepthDiff = Math.abs((a.measurement.depth ?? 0) - myDepth);
              const bDepthDiff = Math.abs((b.measurement.depth ?? 0) - myDepth);
              return aDepthDiff - bDepthDiff;
            }
            return a.distanceKm - b.distanceKm;
          });
        } else {
          // Non-Argo: prefer Argo references first (they're the gold standard)
          densityNeighbors = densityNeighbors.sort((a, b) => {
            const aArgo = a.station.source === 'ARGO' ? 0 : 1;
            const bArgo = b.station.source === 'ARGO' ? 0 : 1;
            if (aArgo !== bArgo) return aArgo - bArgo;
            return a.distanceKm - b.distanceKm;
          });
        }

        for (const n of densityNeighbors.slice(0, 5)) {
          const theirDepth = n.measurement.depth ?? n.station.depth ?? 0;
          const theirOceanDepth = getOceanDepth(n.station.lat, n.station.lon) ?? 0;
          const theirDensity = seawaterDensity(n.measurement.waterTemp!, n.measurement.salinity!, theirDepth);
          const densityDelta = Math.abs(myDensity - theirDensity);

          // Depth-aware tolerance: bigger depth differences allow wider density spread
          const depthDiff = Math.abs(myDepth - theirDepth);
          const densityTol = DENSITY_TOLERANCE + (depthDiff > 100 ? 3 : depthDiff > 20 ? 1.5 : 0);

          // Also account for ocean depth difference — stations over different bathymetry
          // (e.g. shelf vs deep ocean) will naturally have different water masses
          const oceanDepthDiff = Math.abs(myOceanDepth - theirOceanDepth);
          const bathyTol = oceanDepthDiff > 500 ? 2 : oceanDepthDiff > 100 ? 1 : 0;
          const totalTol = densityTol + bathyTol;

          if (densityDelta > totalTol && n.distanceKm < 200) {
            const isArgo = station.source === 'ARGO' || station.source === 'BGC_ARGO';
            const neighborIsArgo = n.station.source === 'ARGO' || n.station.source === 'BGC_ARGO';
            const shouldFlag = isArgo
              ? (neighborIsArgo && depthDiff < 50)
              : true;

            if (shouldFlag) {
              flags.push({
                type: 'density_anomaly',
                severity: neighborIsArgo ? 'critical' : 'warning',
                message: `Density ${myDensity.toFixed(1)} vs ${n.station.name} ${theirDensity.toFixed(1)} kg/m³ (Δ${densityDelta.toFixed(1)}, ${n.distanceKm.toFixed(0)}km, depth Δ${depthDiff.toFixed(0)}m)`,
                field: 'density',
              });
              this.fireAlert(
                station,
                'cross_source_mismatch',
                `Seawater density differs by ${densityDelta.toFixed(1)} kg/m³ from ${n.station.name} (${n.distanceKm.toFixed(0)}km away)`,
                neighborIsArgo ? 'critical' : 'warning',
                'density'
              );
            }
            break;
          }
        }
      }

      // ── Compute verification score ──
      let score = 100;
      for (const f of flags) {
        if (f.severity === 'critical') score -= 25;
        else if (f.severity === 'warning') score -= 10;
      }
      score = Math.max(0, Math.min(100, score));

      const status: IntegrityStatus =
        flags.some((f) => f.severity === 'critical') ? 'failed' :
        flags.some((f) => f.severity === 'warning') ? 'warning' :
        'verified';

      results.push({
        stationId: station.id,
        stationName: station.name,
        source: station.source,
        lat: station.lat,
        lon: station.lon,
        status,
        verificationScore: score,
        measurement: m,
        nearbyComparisons,
        physicalPlausibility: physicalChecks,
        statisticalOutlier: statisticalCheck,
        temporalConsistency: temporalCheck,
        crossSourceAgreement: crossSourceChecks,
        flags,
      });
    }

    // Update previous measurements
    this.history.previousMeasurements = new Map(measurements);

    return results;
  }

  private buildSpatialIndex(
    stations: ClimateStation[],
    measurements: Map<string, ClimateMeasurement>
  ): Map<string, { station: ClimateStation; measurement: ClimateMeasurement; distanceKm: number }[]> {
    const index = new Map<string, { station: ClimateStation; measurement: ClimateMeasurement; distanceKm: number }[]>();

    for (const s1 of stations) {
      const m1 = measurements.get(s1.id);
      if (!m1) continue;
      // Include stations that have any temperature data for cross-validation
      const hasTemp = m1.waterTemp !== undefined || m1.airTemp !== undefined;
      if (!hasTemp) continue;

      const nearby: { station: ClimateStation; measurement: ClimateMeasurement; distanceKm: number }[] = [];
      for (const s2 of stations) {
        if (s1.id === s2.id) continue;
        const m2 = measurements.get(s2.id);
        if (!m2) continue;
        // Match on same temperature type for meaningful comparison
        const sameWaterTemp = m1.waterTemp !== undefined && m2.waterTemp !== undefined;
        const sameAirTemp = m1.airTemp !== undefined && m2.airTemp !== undefined;
        if (!sameWaterTemp && !sameAirTemp) continue;

        const dist = this.haversine(s1.lat, s1.lon, s2.lat, s2.lon);
        if (dist <= NEARBY_RADIUS_KM) {
          nearby.push({ station: s2, measurement: m2, distanceKm: dist });
        }
      }
      nearby.sort((a, b) => a.distanceKm - b.distanceKm);
      index.set(s1.id, nearby);
    }

    return index;
  }

  private updateFieldStats(measurements: Map<string, ClimateMeasurement>) {
    const fieldValues: number[] = [];
    for (const m of measurements.values()) {
      if (m.waterTemp !== undefined && m.waterTemp > -5 && m.waterTemp < 50) {
        fieldValues.push(m.waterTemp);
      }
    }
    if (fieldValues.length > 0) {
      const mean = fieldValues.reduce((a, b) => a + b, 0) / fieldValues.length;
      const stdDev = Math.sqrt(fieldValues.reduce((a, b) => a + (b - mean) ** 2, 0) / fieldValues.length);
      this.history.fieldStats.set('waterTemp', { values: fieldValues, mean, stdDev });
    }
  }

  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private fireAlert(
    station: ClimateStation,
    type: ClimateAlert['type'],
    message: string,
    severity: ClimateAlert['severity'],
    field?: string
  ) {
    this.onAlert({
      id: `${type}_${station.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      type,
      stationId: station.id,
      stationName: station.name,
      source: station.source,
      lat: station.lat,
      lon: station.lon,
      message,
      severity,
      field,
    });
  }
}
