import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import { ClimateStation, ClimateMeasurement, SensorHealth, CrossVerification, IntegrityStatus, StationType, Storm, LightningStrike, Vessel } from '../types';
import { Waves, Activity, Ship, Route } from 'lucide-react';
import { SHIPPING_LANES } from '../data/shippingLanes';

interface OceanMapProps {
  stations: ClimateStation[];
  measurements: Map<string, ClimateMeasurement>;
  selectedStation: ClimateStation | null;
  onSelectStation: (station: ClimateStation | null) => void;
  sensorHealth?: Map<string, SensorHealth>;
  crossVerifications?: CrossVerification[];
  storms?: Storm[];
  lightningStrikes?: LightningStrike[];
  vessels?: Vessel[];
  showVessels?: boolean;
}

const sourceColors: Record<string, string> = {
  NOAA_NDBC: '#00ffcc',
  ARGO: '#06b6d4',
  NOAA_ERDDAP: '#3b82f6',
  GTSPP: '#8b5cf6',
  TAO_PIRATA: '#f59e0b',
  PMEL_CO2: '#ec4899',
  NWS_WEATHER: '#84cc16',
  NHC_STORM: '#ef4444',
  BLITZORTUNG_LIGHTNING: '#fbbf24',
};

const statusColors: Record<IntegrityStatus, string> = {
  verified: '#10b981',
  warning: '#f59e0b',
  failed: '#ef4444',
  stale: '#f97316',
  unknown: '#6b7280',
  invalidated: '#dc2626',
};

const statusLabels: Record<IntegrityStatus, string> = {
  verified: 'Verified',
  warning: 'Warning',
  failed: 'Failed',
  stale: 'Stale',
  unknown: 'Unknown',
  invalidated: 'Invalidated',
};

const typeShapes: Record<StationType, 'circle' | 'triangle' | 'square' | 'diamond'> = {
  buoy: 'circle',
  argo_float: 'diamond',
  bgc_argo_float: 'diamond',
  carbon_station: 'square',
  weather_station: 'circle',
  storm: 'triangle',
  lightning: 'circle',
};

const typeLabels: Record<StationType, string> = {
  buoy: 'Buoy',
  argo_float: 'Argo Float',
  bgc_argo_float: 'BGC Argo Float',
  carbon_station: 'Carbon Station',
  weather_station: 'Weather Station',
  storm: 'Storm',
  lightning: 'Lightning',
};

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
  const E = -5.72466e-3 + 1.0227e-4 * T - 1.6546e-6 * T * T;

  const rho0 = A + B * S + C * S * 1.5 + D * S * S;
  // Pressure correction (simplified)
  const kw = 19652.21 + 148.4206 * T - 2.327105 * T * T + 1.360477e-2 * T * T * T - 5.155288e-5 * T * T * T * T;
  const aw = 54.6746 - 0.60245 * T + 1.0099e-2 * T * T - 6.167e-5 * T * T * T;
  const bw = 7.944e-2 + 1.6483e-2 * T - 5.3009e-4 * T * T;

  const pTerm = P / (kw + aw * P + bw * P * P);
  return rho0 / (1 - pTerm / 10);
}

// ─── Density color mapping ───
function densityColor(density: number, minD: number, maxD: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, (density - minD) / (maxD - minD || 1)));
  // Blue (low density / warm/fresh) → Cyan → Green → Yellow → Red (high density / cold/salty)
  if (t < 0.25) {
    const f = t / 0.25;
    return [20, 60 + f * 100, 200 + f * 55, 200];
  } else if (t < 0.5) {
    const f = (t - 0.25) / 0.25;
    return [20 + f * 80, 160 + f * 80, 255 - f * 100, 200];
  } else if (t < 0.75) {
    const f = (t - 0.5) / 0.25;
    return [100 + f * 155, 240 - f * 80, 155 - f * 100, 200];
  } else {
    const f = (t - 0.75) / 0.25;
    return [255, 160 - f * 120, 55 - f * 55, 200];
  }
}

// ─── Build density heatmap as a canvas image for L.imageOverlay ───
function buildDensityCanvas(map: L.Map): HTMLCanvasElement | null {
  const stations = (window as any).__densityStations as { lat: number; lon: number; density: number }[];
  if (!stations || stations.length < 3) return null;

  const bounds = map.getBounds();
  const size = map.getSize();
  const canvas = document.createElement('canvas');
  canvas.width = size.x;
  canvas.height = size.y;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // latLngToContainerPoint gives pixels relative to the map container
  const points: { x: number; y: number; density: number }[] = [];
  let minD = Infinity, maxD = -Infinity;
  for (const s of stations) {
    const px = map.latLngToContainerPoint([s.lat, s.lon]);
    points.push({ x: px.x, y: px.y, density: s.density });
    if (s.density < minD) minD = s.density;
    if (s.density > maxD) maxD = s.density;
  }

  const CELL = 6;
  const cols = Math.ceil(size.x / CELL);
  const rows = Math.ceil(size.y / CELL);
  const zoom = map.getZoom();
  const RADIUS = Math.max(size.x, size.y) * (0.15 + (5 - Math.min(zoom, 5)) * 0.08);

  const imgData = ctx.createImageData(size.x, size.y);

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const cx = gx * CELL + CELL / 2;
      const cy = gy * CELL + CELL / 2;

      let weightSum = 0;
      let densitySum = 0;

      for (const p of points) {
        const dx = cx - p.x;
        const dy = cy - p.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 > RADIUS * RADIUS) continue;
        const w = 1 / (dist2 + 1);
        weightSum += w;
        densitySum += w * p.density;
      }

      if (weightSum < 0.001) continue;

      const density = densitySum / weightSum;
      const [r, g, b, a] = densityColor(density, minD, maxD);

      for (let py = 0; py < CELL && gy * CELL + py < size.y; py++) {
        for (let px = 0; px < CELL && gx * CELL + px < size.x; px++) {
          const idx = ((gy * CELL + py) * size.x + (gx * CELL + px)) * 4;
          imgData.data[idx] = r;
          imgData.data[idx + 1] = g;
          imgData.data[idx + 2] = b;
          imgData.data[idx + 3] = a;
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

// ─── Update or create the density image overlay ───
function updateDensityOverlay(map: L.Map): L.ImageOverlay | null {
  const canvas = buildDensityCanvas(map);
  if (!canvas) return null;

  const bounds = map.getBounds();
  const url = canvas.toDataURL('image/png');

  // Remove old overlay if exists
  const existing = (map as any).__densityOverlay as L.ImageOverlay | undefined;
  if (existing) {
    existing.setUrl(url);
    existing.setBounds(bounds);
    return existing;
  }

  const overlay = L.imageOverlay(url, bounds, {
    opacity: 0.7,
    interactive: false,
    className: 'density-overlay',
  });
  overlay.addTo(map);
  (map as any).__densityOverlay = overlay;
  return overlay;
}

export default function OceanMap({
  stations,
  measurements,
  selectedStation,
  onSelectStation,
  sensorHealth,
  crossVerifications,
  storms,
  lightningStrikes,
  vessels,
  showVessels: showVesselsProp,
}: OceanMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, L.CircleMarker>>(new Map());
  const pulsesRef = useRef<L.CircleMarker[]>([]);
  const stationsRef = useRef<ClimateStation[]>([]);
  const measurementsRef = useRef<Map<string, ClimateMeasurement>>(new Map());
  const animFrameRef = useRef<number | null>(null);

  const [showBathy, setShowBathy] = useState(false);
  const bathyLayerRef = useRef<L.TileLayer | null>(null);
  const [showDensity, setShowDensity] = useState(false);
  const showDensityRef = useRef(false);
  const densityLayerRef = useRef<L.ImageOverlay | null>(null);
  const showVessels = showVesselsProp ?? false;
  const vesselLayerRef = useRef<L.LayerGroup | null>(null);
  const [showShippingLanes, setShowShippingLanes] = useState(false);
  const shippingLaneLayerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [20, 0],
      zoom: 2,
      minZoom: 2,
      maxZoom: 18,
      zoomControl: true,
      attributionControl: true,
      worldCopyJump: true,
      preferCanvas: true,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 120,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    // Bathymetry / ocean depth layer (GEBCO WMS)
    bathyLayerRef.current = L.tileLayer.wms('https://wms.gebco.net/mapserv?', {
      layers: 'GEBCO_LATEST',
      attribution: 'GEBCO',
      maxZoom: 15,
      opacity: 0.7,
      format: 'image/png',
      transparent: true,
    });

    mapRef.current = map;

    // Redraw density overlay on map movement (same lifecycle as tile layers)
    const redrawDensity = () => {
      if (!showDensityRef.current) return;
      updateDensityOverlay(map);
    };
    map.on('moveend zoomend resize', redrawDensity);

    setTimeout(() => map.invalidateSize(), 100);
    setTimeout(() => map.invalidateSize(), 500);
    setTimeout(() => map.invalidateSize(), 1000);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    stationsRef.current = stations;

    // Compute density data for the heatmap overlay
    const densityData: { lat: number; lon: number; density: number }[] = [];
    for (const s of stations) {
      const m = measurements.get(s.id);
      if (m?.waterTemp !== undefined && m?.salinity !== undefined) {
        const depth = m.depth ?? s.depth ?? 0;
        const rho = seawaterDensity(m.waterTemp, m.salinity, depth);
        densityData.push({ lat: s.lat, lon: s.lon, density: rho });
      }
    }
    (window as any).__densityStations = densityData;

    // If density layer is visible, trigger a redraw
    if (showDensityRef.current && mapRef.current) {
      updateDensityOverlay(mapRef.current);
    }
  }, [stations, measurements]);

  useEffect(() => {
    measurementsRef.current = measurements;
  }, [measurements]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const verMap = new Map<string, CrossVerification>();
    if (crossVerifications) {
      for (const v of crossVerifications) verMap.set(v.stationId, v);
    }

    // Clear old markers
    markersRef.current.forEach((marker) => map.removeLayer(marker));
    markersRef.current.clear();

    for (const station of stations) {
      const latlng: L.LatLngExpression = [station.lat, station.lon];
      const m = measurements.get(station.id);
      const health = sensorHealth?.get(station.id);
      const ver = verMap.get(station.id);
      const status: IntegrityStatus = station.invalidated
        ? 'invalidated'
        : ver?.status ?? health?.status ?? 'unknown';
      const color = statusColors[status];
      const isSelected = selectedStation?.id === station.id;
      const shape = typeShapes[station.type] || 'circle';

      const radius = isSelected ? 7 : station.type === 'argo_float' ? 5 : 4;

      let marker: L.CircleMarker;
      if (shape === 'diamond') {
        marker = L.circleMarker(latlng, {
          radius,
          fillColor: color,
          color: color,
          weight: isSelected ? 2 : 1,
          opacity: 0.9,
          fillOpacity: 0.7,
          className: isSelected ? 'glow-strong' : 'glow',
        });
      } else if (shape === 'square') {
        marker = L.circleMarker(latlng, {
          radius,
          fillColor: color,
          color: color,
          weight: isSelected ? 2 : 1,
          opacity: 0.9,
          fillOpacity: 0.7,
          className: isSelected ? 'glow-strong' : 'glow',
        });
      } else {
        marker = L.circleMarker(latlng, {
          radius,
          fillColor: color,
          color: color,
          weight: isSelected ? 2 : 1,
          opacity: 0.9,
          fillOpacity: 0.7,
          className: isSelected ? 'glow-strong' : 'glow',
        });
      }
      marker.addTo(map);

      const tempStr = m?.waterTemp !== undefined ? `Water: ${m.waterTemp.toFixed(1)}°C` : '';
      const airTempStr = m?.airTemp !== undefined ? `Air: ${m.airTemp.toFixed(1)}°C` : '';
      const depthStr = m?.depth !== undefined ? `${m.depth.toFixed(0)}m depth` : (station.depth !== undefined ? `${station.depth.toFixed(0)}m depth` : '');
      const salinityStr = m?.salinity !== undefined ? `${m.salinity.toFixed(1)} PSU` : '';
      const waveStr = m?.waveHeight !== undefined ? `${m.waveHeight.toFixed(1)}m waves${m.wavePeriod !== undefined ? ' · ' + m.wavePeriod.toFixed(0) + 's period' : ''}` : '';
      const curStr = m?.currentSpeed !== undefined ? `${m.currentSpeed.toFixed(1)} cm/s` : '';
      const windStr = m?.windSpeed !== undefined ? `Wind: ${m.windSpeed.toFixed(1)}m/s${m.windDir !== undefined ? ' ' + m.windDir.toFixed(0) + '°' : ''}` : '';
      const presStr = m?.pressure !== undefined ? `Pres: ${m.pressure.toFixed(0)}hPa` : '';
      const oxyStr = m?.oxygen !== undefined ? `O₂: ${m.oxygen.toFixed(1)} µmol/kg` : '';
      const nitStr = m?.nitrate !== undefined ? `NO₃: ${m.nitrate.toFixed(1)} µmol/kg` : '';
      const phStr = m?.ph !== undefined ? `pH: ${m.ph.toFixed(2)}` : '';
      const noDataStr = (!tempStr && !airTempStr && !salinityStr && !waveStr && !curStr && !windStr && !presStr && !oxyStr && !nitStr && !phStr) ? 'No sensor data' : '';
      const scoreStr = health ? `Integrity: ${health.integrityScore.toFixed(0)}/100` : 'Integrity: N/A';
      const driftStr = health?.driftDetected ? 'DRIFT DETECTED' : '';
      const invStr = station.invalidated ? `INVALIDATED: ${station.invalidationReason ?? 'flagged by watchdog'}` : '';

      marker.bindTooltip(
        `<div style="font-family: monospace; font-size: 11px;">
          <div style="color: ${color}; font-weight: bold;">${station.name}</div>
          <div style="color: #5a6478;">${typeLabels[station.type]} · ${station.source.replace(/_/g, ' ')}</div>
          <div style="color: ${color};">${statusLabels[status]}${driftStr ? ' · ' + driftStr : ''}</div>
          ${invStr ? `<div style="color: #dc2626; font-size: 10px;">${invStr}</div>` : ''}
          <div style="color: #5a6478;">${scoreStr}</div>
          ${tempStr ? `<div style="color: ${color};">${tempStr}</div>` : ''}
          ${airTempStr ? `<div style="color: #f59e0b;">${airTempStr}</div>` : ''}
          ${depthStr ? `<div style="color: #8b5cf6;">${depthStr}</div>` : ''}
          ${salinityStr ? `<div style="color: #06b6d4;">${salinityStr}</div>` : ''}
          ${waveStr ? `<div style="color: #06b6d4;">${waveStr}</div>` : ''}
          ${curStr ? `<div style="color: #f59e0b;">${curStr}</div>` : ''}
          ${windStr ? `<div style="color: #84cc16;">${windStr}</div>` : ''}
          ${presStr ? `<div style="color: #84cc16;">${presStr}</div>` : ''}
          ${oxyStr ? `<div style="color: #22d3ee;">${oxyStr}</div>` : ''}
          ${nitStr ? `<div style="color: #22d3ee;">${nitStr}</div>` : ''}
          ${phStr ? `<div style="color: #22d3ee;">${phStr}</div>` : ''}
          ${noDataStr ? `<div style="color: #dc2626;">${noDataStr}</div>` : ''}
          ${station.country ? `<div style="color: #5a6478;">${station.country}</div>` : ''}
        </div>`,
        {
          permanent: false,
          direction: 'top',
          className: 'custom-tooltip',
        }
      );

      marker.on('click', () => onSelectStation(station));
      markersRef.current.set(station.id, marker);
    }
  }, [stations, measurements, selectedStation, onSelectStation, sensorHealth, crossVerifications]);

  // ── Storm tracks overlay ──
  const stormLayerRef = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (stormLayerRef.current) {
      map.removeLayer(stormLayerRef.current);
    }

    if (!storms || storms.length === 0) return;

    const layer = L.layerGroup();
    for (const storm of storms) {
      const color = storm.classification?.includes('HURRICANE') || storm.classification?.includes('TYPHOON')
        ? '#ef4444'
        : storm.classification?.includes('STORM')
        ? '#f59e0b'
        : '#06b6d4';

      // Current position marker
      const marker = L.circleMarker([storm.lat, storm.lon], {
        radius: 8,
        fillColor: color,
        color: '#fff',
        weight: 2,
        opacity: 0.9,
        fillOpacity: 0.8,
        className: 'glow-strong',
      });

      const intensityStr = storm.windSpeedKt ? `${storm.windSpeedKt}kt` : '';
      const pressureStr = storm.pressureMB ? `${storm.pressureMB}mb` : '';
      marker.bindTooltip(
        `<b>${storm.name}</b><br/>${storm.classification} ${storm.intensity}<br/>${intensityStr} ${pressureStr}<br/>${storm.movementDir ?? ''} ${storm.movementSpeedKt ?? ''}kt`,
        { permanent: false, direction: 'top', className: 'custom-tooltip' }
      );
      layer.addLayer(marker);

      // Track line
      if (storm.track.length > 1) {
        const trackLine = L.polyline(
          storm.track.map((p) => [p.lat, p.lon] as L.LatLngExpression),
          { color, weight: 2, opacity: 0.6, dashArray: '4,4' }
        );
        layer.addLayer(trackLine);
      }

      // Forecast track
      if (storm.forecastTrack.length > 0) {
        const forecastLine = L.polyline(
          storm.forecastTrack.map((p) => [p.lat, p.lon] as L.LatLngExpression),
          { color, weight: 1, opacity: 0.4, dashArray: '2,6' }
        );
        layer.addLayer(forecastLine);
      }
    }
    layer.addTo(map);
    stormLayerRef.current = layer;
  }, [storms]);

  // ── Lightning strikes overlay ──
  const lightningLayerRef = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (lightningLayerRef.current) {
      map.removeLayer(lightningLayerRef.current);
    }

    if (!lightningStrikes || lightningStrikes.length === 0) return;

    const layer = L.layerGroup();
    const now = Date.now();
    for (const strike of lightningStrikes) {
      const ageMin = (now - strike.timestamp) / 60000;
      if (ageMin > 30) continue;

      const opacity = Math.max(0.2, 1 - ageMin / 30);
      const color = strike.polarity === 'positive' ? '#f97316' : '#fbbf24';

      const marker = L.circleMarker([strike.lat, strike.lon], {
        radius: 3,
        fillColor: color,
        color: color,
        weight: 1,
        opacity,
        fillOpacity: opacity * 0.8,
      });
      layer.addLayer(marker);
    }
    layer.addTo(map);
    lightningLayerRef.current = layer;
  }, [lightningStrikes]);

  // ── Vessel positions overlay (AIS from Axiom Overwatch) ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (vesselLayerRef.current) {
      map.removeLayer(vesselLayerRef.current);
      vesselLayerRef.current = null;
    }

    if (!showVessels || !vessels || vessels.length === 0) return;

    const layer = L.layerGroup();
    for (const v of vessels) {
      const color = v.vesselType === 'tanker' ? '#f97316'
        : v.vesselType === 'bulk_carrier' ? '#3b82f6'
        : v.vesselType === 'container' || v.vesselType === 'cargo' ? '#22d3ee'
        : v.vesselType === 'lng_carrier' ? '#a78bfa'
        : '#64748b';

      const marker = L.circleMarker([v.lat, v.lon], {
        radius: 3,
        fillColor: color,
        color: color,
        weight: 1,
        opacity: 0.8,
        fillOpacity: 0.6,
        className: '',
      });

      const speedStr = v.speed !== undefined ? `${v.speed.toFixed(1)} kn` : '';
      const courseStr = v.course !== undefined ? `${v.course.toFixed(0)}°` : '';
      const draftStr = v.draft !== undefined ? `${v.draft.toFixed(1)}m draft` : '';
      const destStr = v.destination ? `→ ${v.destination}` : '';
      const typeStr = v.vesselType ? v.vesselType.replace(/_/g, ' ') : '';
      const flagStr = v.flag ?? '';

      marker.bindTooltip(
        `<div style="font-family: monospace; font-size: 11px;">
          <div style="color: ${color}; font-weight: bold;">${v.name}</div>
          <div style="color: #5a6478;">IMO ${v.imo} · ${typeStr} · ${flagStr}</div>
          ${speedStr ? `<div style="color: ${color};">${speedStr} ${courseStr}</div>` : ''}
          ${draftStr ? `<div style="color: #8b5cf6;">${draftStr}</div>` : ''}
          ${destStr ? `<div style="color: #5a6478;">${destStr}</div>` : ''}
          <div style="color: #5a6478;">${v.navStatus ?? ''}</div>
        </div>`,
        { permanent: false, direction: 'top', className: 'custom-tooltip' }
      );
      layer.addLayer(marker);
    }
    layer.addTo(map);
    vesselLayerRef.current = layer;
  }, [vessels, showVessels]);

  // ── Shipping lanes overlay ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (shippingLaneLayerRef.current) {
      map.removeLayer(shippingLaneLayerRef.current);
      shippingLaneLayerRef.current = null;
    }

    if (!showShippingLanes) return;

    const layer = L.layerGroup();
    for (const lane of SHIPPING_LANES) {
      const color = lane.traffic === 'high' ? '#fbbf24'
        : lane.traffic === 'medium' ? '#f472b6'
        : '#a78bfa';
      const weight = lane.traffic === 'high' ? 3 : 2;
      const opacity = lane.traffic === 'high' ? 0.85 : 0.7;

      const line = L.polyline(
        lane.coordinates as L.LatLngExpression[],
        { color, weight, opacity, dashArray: '6,4', className: '' }
      );
      line.bindTooltip(
        `<div style="font-family: monospace; font-size: 11px;">
          <div style="color: ${color}; font-weight: bold;">${lane.name}</div>
          <div style="color: #5a6478;">Traffic: ${lane.traffic}</div>
        </div>`,
        { permanent: false, direction: 'top', className: 'custom-tooltip' }
      );
      layer.addLayer(line);
    }
    layer.addTo(map);
    shippingLaneLayerRef.current = layer;
  }, [showShippingLanes]);

  // Animate pulse rings on stations with fresh data
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let frame = 0;
    const animate = () => {
      pulsesRef.current.forEach((p) => map.removeLayer(p));
      pulsesRef.current = [];

      // Only animate a subset to keep performance reasonable
      const stations = stationsRef.current;
      const step = Math.max(1, Math.floor(stations.length / 30));
      for (let i = 0; i < stations.length; i += step) {
        const s = stations[i];
        const m = measurementsRef.current.get(s.id);
        const health = sensorHealth?.get(s.id);
        if (!m) continue;

        const color = statusColors[health?.status ?? 'unknown'];
        const t = ((frame + i * 7) % 100) / 100;
        const radius = 4 + t * 12;
        const opacity = (1 - t) * 0.3;

        const pulse = L.circleMarker([s.lat, s.lon], {
          radius,
          fillColor: color,
          color: color,
          weight: 1,
          opacity: opacity,
          fillOpacity: 0,
          className: '',
        }).addTo(map);
        pulsesRef.current.push(pulse);
      }

      frame++;
      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      pulsesRef.current.forEach((p) => map.removeLayer(p));
      pulsesRef.current = [];
    };
  }, [stations, measurements, sensorHealth]);

  // Focus on selected station
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedStation) return;
    map.flyTo([selectedStation.lat, selectedStation.lon], 4, { duration: 1 });
  }, [selectedStation]);

  return (
    <div className="relative w-full h-full overflow-hidden">
      <div ref={containerRef} className="w-full h-full" />
      {/* Grid overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-[400]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(0, 255, 204, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 255, 204, 0.03) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      {/* Vignette */}
      <div
        className="absolute inset-0 pointer-events-none z-[401]"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 50%, rgba(10, 14, 23, 0.6) 100%)',
        }}
      />
      {/* Verification status legend */}
      <div className="absolute bottom-4 left-4 z-[1000] bg-cyber-panel/95 border border-cyber-border rounded px-3 py-2 backdrop-blur-sm">
        <div className="text-[9px] uppercase tracking-wider text-cyber-text-dim mb-1.5">Verification Status</div>
        <div className="flex items-center gap-2">
          {(Object.keys(statusColors) as IntegrityStatus[]).map((status) => (
            <div key={status} className="flex flex-col items-center">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: statusColors[status], boxShadow: `0 0 4px ${statusColors[status]}` }} />
              <span className="text-[8px] text-cyber-text-dim mt-0.5">{statusLabels[status]}</span>
            </div>
          ))}
        </div>
      </div>
      {/* Sensor type legend */}
      <div className="absolute bottom-4 right-4 z-[1000] bg-cyber-panel/95 border border-cyber-border rounded px-3 py-2 backdrop-blur-sm">
        <div className="text-[9px] uppercase tracking-wider text-cyber-text-dim mb-1.5">Sensor Types</div>
        <div className="space-y-1">
          {(Object.keys(typeLabels) as StationType[]).map((type) => (
            <div key={type} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#6b7280', boxShadow: '0 0 4px #6b7280' }} />
              <span className="text-[9px] text-cyber-text-dim">{typeLabels[type]}</span>
            </div>
          ))}
        </div>
      </div>
      {stations.length === 0 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-cyber-panel border border-cyber-border rounded px-4 py-2 text-xs text-cyber-text-dim z-[1000]">
          Fetching climate stations from ERDDAP...
        </div>
      )}
      {/* Bathymetry toggle */}
      <button
        onClick={() => {
          const map = mapRef.current;
          if (!map || !bathyLayerRef.current) return;
          if (showBathy) {
            bathyLayerRef.current.removeFrom(map);
          } else {
            bathyLayerRef.current.addTo(map);
          }
          setShowBathy(!showBathy);
        }}
        className={`absolute top-4 right-4 z-[1000] flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs transition-colors ${
          showBathy
            ? 'bg-cyber-accent/20 border-cyber-accent text-cyber-accent'
            : 'bg-cyber-panel/95 border-cyber-border text-cyber-text-dim hover:text-cyber-text'
        }`}
      >
        <Waves size={12} />
        Bathymetry
      </button>
      <button
        onClick={() => {
          const map = mapRef.current;
          if (!map) return;
          if (showDensity) {
            // Remove overlay
            const existing = (map as any).__densityOverlay as L.ImageOverlay | undefined;
            if (existing) {
              map.removeLayer(existing);
              delete (map as any).__densityOverlay;
            }
            showDensityRef.current = false;
          } else {
            showDensityRef.current = true;
            updateDensityOverlay(map);
          }
          setShowDensity(!showDensity);
        }}
        className={`absolute top-14 right-4 z-[1000] flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs transition-colors ${
          showDensity
            ? 'bg-cyber-accent/20 border-cyber-accent text-cyber-accent'
            : 'bg-cyber-panel/95 border-cyber-border text-cyber-text-dim hover:text-cyber-text'
        }`}
      >
        <Activity size={12} />
        Density
      </button>
      <button
        onClick={() => setShowShippingLanes(!showShippingLanes)}
        className={`absolute top-24 right-4 z-[1000] flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs transition-colors ${
          showShippingLanes
            ? 'bg-cyber-accent/20 border-cyber-accent text-cyber-accent'
            : 'bg-cyber-panel/95 border-cyber-border text-cyber-text-dim hover:text-cyber-text'
        }`}
      >
        <Route size={12} />
        Shipping Lanes
      </button>
    </div>
  );
}
