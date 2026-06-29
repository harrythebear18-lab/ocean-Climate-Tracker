import * as https from 'https';
import * as http from 'http';
import { WebSocket } from 'ws';
import { ClimateStation, ClimateMeasurement, Storm, StormTrackPoint, LightningStrike, DataSource } from '../src/types';
import { fetchUrl } from './httpUtil';

function safeNum(val: any): number | undefined {
  if (val === null || val === undefined || val === '') return undefined;
  const n = typeof val === 'number' ? val : parseFloat(val);
  return isNaN(n) ? undefined : n;
}

// ─── Global Weather Station Fetcher (METAR) ───
// Uses aviationweather.gov METAR API for worldwide airport weather observations

export class WeatherFetcher {
  static async fetchNWS(): Promise<{
    stations: ClimateStation[];
    measurements: Map<string, ClimateMeasurement>;
  }> {
    const stations: ClimateStation[] = [];
    const measurements = new Map<string, ClimateMeasurement>();

    try {
      // Fetch all recent METARs globally (up to 400 per request)
      // Split by longitude bands to get more coverage
      const bands = [
        { bbox: '-180,-90,-30,90' },   // Western hemisphere
        { bbox: '-30,-90,60,90' },     // Europe/Africa
        { bbox: '60,-90,180,90' },     // Asia/Pacific
      ];

      const seenIds = new Set<string>();

      for (const band of bands) {
        try {
          const raw = await fetchUrl(
            `https://aviationweather.gov/api/data/metar?format=json&taf=false&hours=1&bbox=${band.bbox}`,
            20000
          );
          const data = JSON.parse(raw);
          if (!Array.isArray(data)) continue;

          for (const obs of data) {
            const lat = safeNum(obs.lat);
            const lon = safeNum(obs.lon);
            if (lat === undefined || lon === undefined) continue;

            const icaoId = obs.icaoId;
            if (!icaoId || seenIds.has(icaoId)) continue;
            seenIds.add(icaoId);

            const id = `metar_${icaoId}`;
            const ts = typeof obs.obsTime === 'number'
              ? obs.obsTime * 1000
              : new Date(obs.reportTime || Date.now()).getTime();

            const station: ClimateStation = {
              id,
              name: obs.name || icaoId,
              type: 'weather_station',
              source: 'NWS_WEATHER' as DataSource,
              lat,
              lon,
              elevation: safeNum(obs.elev),
              lastUpdate: ts,
              active: true,
            };

            // METAR: temp in C, wind in knots, altim in hPa (or inHg)
            const windSpeedKt = safeNum(obs.wspd);
            const altim = safeNum(obs.altim);
            const airTemp = safeNum(obs.temp);
            const windDir = safeNum(obs.wdir);

            // Skip stations with no actual weather data
            if (airTemp === undefined && windSpeedKt === undefined && windDir === undefined && altim === undefined) {
              continue;
            }

            const m: ClimateMeasurement = {
              stationId: id,
              timestamp: ts,
              airTemp,
              windSpeed: windSpeedKt !== undefined ? windSpeedKt * 0.514444 : undefined, // knots → m/s
              windDir,
              pressure: altim !== undefined ? (altim > 100 ? altim : altim * 33.8639) : undefined, // hPa or inHg → hPa
            };

            stations.push(station);
            measurements.set(id, m);
          }
        } catch (e) {
          console.error(`METAR fetch error (bbox=${band.bbox}):`, (e as Error).message);
        }
      }

      console.log(`METAR weather data fetched: ${stations.length} global stations`);
    } catch (e) {
      console.error('METAR weather fetch failed:', e);
    }

    return { stations, measurements };
  }
}

// ─── API Credentials (from environment variables) ───

const XWEATHER_CLIENT_ID = process.env.XWEATHER_CLIENT_ID || '';
const XWEATHER_CLIENT_SECRET = process.env.XWEATHER_CLIENT_SECRET || '';
const METEOMATICS_USERNAME = process.env.METEOMATICS_USERNAME || '';
const METEOMATICS_PASSWORD = process.env.METEOMATICS_PASSWORD || '';

// ─── Storm Fetcher (Aggregated: Vaisala XWeather + Meteomatics + NHC) ───

export class StormFetcher {
  static async fetchActiveStorms(): Promise<Storm[]> {
    const sources: Promise<Storm[]>[] = [];

    if (XWEATHER_CLIENT_ID && XWEATHER_CLIENT_SECRET) {
      sources.push(this.fetchXWeatherStorms());
    }
    if (METEOMATICS_USERNAME && METEOMATICS_PASSWORD) {
      sources.push(this.fetchMeteomaticsStorms());
    }
    // NHC + NWS alerts are always included as free sources
    sources.push(this.fetchNHCStorms());
    sources.push(this.fetchNWSAlertStorms());

    const results = await Promise.allSettled(sources);
    let allStorms: Storm[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') allStorms.push(...r.value);
    }

    allStorms = this.dedupStorms(allStorms);

    const srcNames: string[] = [];
    if (XWEATHER_CLIENT_ID) srcNames.push('XWeather');
    if (METEOMATICS_USERNAME) srcNames.push('Meteomatics');
    srcNames.push('NHC');
    srcNames.push('NWS-Alerts');
    console.log(`Storms fetched: ${allStorms.length} active (sources: ${srcNames.join(', ')})`);

    return allStorms;
  }

  private static async fetchXWeatherStorms(): Promise<Storm[]> {
    const storms: Storm[] = [];
    try {
      const raw = await fetchUrl(
        `https://data.api.xweather.com/tropicalcyclones/search?filter=profile.isActive:1&client_id=${XWEATHER_CLIENT_ID}&client_secret=${XWEATHER_CLIENT_SECRET}&limit=50`,
        20000
      );
      const data = JSON.parse(raw);
      const items = data.response || [];
      for (const item of items) {
        const profile = item.profile || {};
        const track = item.track || [];
        const current = track[track.length - 1] || {};
        const lat = safeNum(current.lat) ?? safeNum(profile.position?.lat);
        const lon = safeNum(current.lon) ?? safeNum(profile.position?.lon);
        if (lat === undefined || lon === undefined) continue;

        const ts = profile.lifespan?.endTimestamp ?? Date.now();
        const stormTrack: StormTrackPoint[] = track.map((t: any) => ({
          lat: safeNum(t.lat), lon: safeNum(t.lon),
          timestamp: safeNum(t.timestamp) ?? ts,
          windSpeedKt: safeNum(t.windSpeedKTS),
          pressureMB: safeNum(t.pressureMB),
          forecastHour: safeNum(t.forecastHour),
        }));
        const forecastTrack: StormTrackPoint[] = (item.forecast || []).map((t: any) => ({
          lat: safeNum(t.lat), lon: safeNum(t.lon),
          timestamp: safeNum(t.timestamp) ?? ts,
          windSpeedKt: safeNum(t.windSpeedKTS),
          pressureMB: safeNum(t.pressureMB),
          forecastHour: safeNum(t.forecastHour),
        }));

        storms.push({
          id: `xw_${item.id || profile.name}`,
          name: profile.name || 'Unknown',
          basin: profile.basinCurrent || profile.basinOrigin || '',
          type: 'tropical_cyclone',
          classification: profile.maxStormType || '',
          intensity: profile.maxStormCat || '',
          lat, lon,
          windSpeedKt: profile.windSpeed?.maxKTS,
          pressureMB: profile.pressure?.minMB,
          lastUpdate: ts,
          track: stormTrack,
          forecastTrack,
        });
      }
      console.log(`XWeather storms: ${storms.length}`);
    } catch (e) {
      console.error('XWeather storm fetch failed:', (e as Error).message);
    }
    return storms;
  }

  private static async fetchMeteomaticsStorms(): Promise<Storm[]> {
    const storms: Storm[] = [];
    try {
      const nowISO = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      const url = `https://${METEOMATICS_USERNAME}:${METEOMATICS_PASSWORD}@api.meteomatics.com/get_thunderstorm_tracks?datetime=${nowISO}&bbox=-180,-90,180,90`;
      const raw = await fetchUrl(url, 20000);
      const data = JSON.parse(raw);
      const features = data.features || [];

      const stormMap = new Map<number, any[]>();
      for (const f of features) {
        const id = f.properties?.id ?? 0;
        if (!stormMap.has(id)) stormMap.set(id, []);
        stormMap.get(id)!.push(f);
      }

      for (const [id, feats] of stormMap) {
        const current = feats.find((f: any) => f.properties?.type === 'current') || feats[0];
        const coords = current?.geometry?.coordinates;
        if (!coords) continue;

        let lat: number | undefined, lon: number | undefined;
        if (typeof coords[0] === 'number') {
          lon = coords[0]; lat = coords[1];
        } else if (Array.isArray(coords[0])) {
          const ring = coords[0];
          lon = ring.reduce((s: number, c: number[]) => s + c[0], 0) / ring.length;
          lat = ring.reduce((s: number, c: number[]) => s + c[1], 0) / ring.length;
        }
        if (lat === undefined || lon === undefined) continue;

        const severity = current?.properties?.severity || 'low';
        const tsStr = current?.properties?.timestamp;
        const ts = tsStr ? new Date(tsStr).getTime() : Date.now();

        storms.push({
          id: `meteo_tstorm_${id}`,
          name: `Thunderstorm ${id}`,
          basin: '',
          type: 'thunderstorm',
          classification: severity,
          intensity: severity,
          lat, lon,
          lastUpdate: ts,
          track: [{ lat, lon, timestamp: ts }],
          forecastTrack: [],
        });
      }
      console.log(`Meteomatics storms: ${storms.length}`);
    } catch (e) {
      console.error('Meteomatics storm fetch failed:', (e as Error).message);
    }
    return storms;
  }

  private static async fetchNHCStorms(): Promise<Storm[]> {
    const storms: Storm[] = [];
    const NHC_URLS = [
      'https://www.nhc.noaa.gov/CurrentStorms.json',
      'https://nhc.noaa.gov/CurrentStorms.json',
    ];

    let raw: string | null = null;
    for (const url of NHC_URLS) {
      try {
        raw = await fetchUrl(url, 15000);
        if (raw) break;
      } catch (e) {
        console.error(`NHC fetch failed (${url}):`, (e as Error).message);
      }
    }
    if (!raw) return storms;

    try {
      const data = JSON.parse(raw);
      const activeStorms = data.activeStorms || data.ActiveStorms || [];
      for (const s of activeStorms) {
        // NHC JSON uses latitude_numeric/longitude_numeric, not lat/lon
        const lat = safeNum(s.latitude_numeric) ?? safeNum(s.lat);
        const lon = safeNum(s.longitude_numeric) ?? safeNum(s.lon);
        if (lat === undefined || lon === undefined) continue;

        const ts = s.lastUpdate ? new Date(s.lastUpdate).getTime() : Date.now();
        const intensityNum = safeNum(s.intensity);
        const pressureNum = safeNum(s.pressure);
        storms.push({
          id: `nhc_${s.id}`,
          name: s.name || 'Unknown',
          basin: s.binNumber?.startsWith('EP') ? 'East Pacific' : s.binNumber?.startsWith('AT') ? 'Atlantic' : '',
          type: 'tropical_cyclone',
          classification: s.classification || '',
          intensity: intensityNum !== undefined ? `${intensityNum} kt` : '',
          lat, lon,
          windSpeedKt: intensityNum,
          pressureMB: pressureNum,
          movementDir: safeNum(s.movementDir) !== undefined ? String(s.movementDir) : undefined,
          movementSpeedKt: safeNum(s.movementSpeed),
          lastUpdate: ts,
          track: [{ lat, lon, timestamp: ts, windSpeedKt: intensityNum, pressureMB: pressureNum }],
          forecastTrack: [],
        });
      }
      console.log(`NHC storms: ${storms.length}`);
    } catch (e) {
      console.error('NHC storm parse error:', (e as Error).message);
    }
    return storms;
  }

  private static dedupStorms(storms: Storm[]): Storm[] {
    const result: Storm[] = [];
    for (const s of storms) {
      const isDup = result.some((r) => {
        if (r.name === s.name && r.basin === s.basin && r.basin) return true;
        const dist = Math.sqrt((r.lat - s.lat) ** 2 + (r.lon - s.lon) ** 2) * 111;
        return dist < 50;
      });
      if (!isDup) result.push(s);
    }
    return result;
  }

  private static async fetchNWSAlertStorms(): Promise<Storm[]> {
    const storms: Storm[] = [];
    try {
      const raw = await fetchUrl(
        'https://api.weather.gov/alerts/active?event=Hurricane%20Warning,Hurricane%20Watch,Tropical%20Storm%20Warning,Tropical%20Storm%20Watch,Severe%20Thunderstorm%20Warning,Tornado%20Warning,Tornado%20Watch',
        20000
      );
      const data = JSON.parse(raw);
      const features = data.features || [];

      for (const f of features) {
        const props = f.properties || {};
        const geom = f.geometry;
        if (!geom || !geom.coordinates) continue;

        // Get centroid of polygon
        let lat: number | undefined, lon: number | undefined;
        const coords = geom.coordinates;
        if (geom.type === 'Polygon' && Array.isArray(coords[0])) {
          const ring = coords[0];
          lon = ring.reduce((s: number, c: number[]) => s + c[0], 0) / ring.length;
          lat = ring.reduce((s: number, c: number[]) => s + c[1], 0) / ring.length;
        } else if (geom.type === 'Point' && typeof coords[0] === 'number') {
          lon = coords[0]; lat = coords[1];
        }
        if (lat === undefined || lon === undefined) continue;

        const event = props.event || 'Severe Weather';
        const severity = props.severity || 'Minor';
        const ts = props.sent ? new Date(props.sent).getTime() : Date.now();

        storms.push({
          id: `nws_${props.id || Math.random().toString(36).slice(2)}`,
          name: event,
          basin: '',
          type: event.includes('Tornado') ? 'tornado' : event.includes('Tropical') || event.includes('Hurricane') ? 'tropical_cyclone' : 'thunderstorm',
          classification: severity,
          intensity: severity,
          lat, lon,
          lastUpdate: ts,
          track: [{ lat, lon, timestamp: ts }],
          forecastTrack: [],
        });
      }
      console.log(`NWS alert storms: ${storms.length}`);
    } catch (e) {
      console.error('NWS alert storm fetch failed:', (e as Error).message);
    }
    return storms;
  }
}

// ─── Lightning Fetcher (Aggregated: Vaisala XWeather + Meteomatics + Blitzortung) ───

function lzwDecode(b: Buffer): string {
  const bytes = b.toString('binary');
  let c = bytes[0];
  let f = c;
  const g: string[] = [c];
  const e: Record<number, string> = {};
  let h = 256;
  let o = h;
  for (let i = 1; i < bytes.length; i++) {
    const a = bytes.charCodeAt(i);
    let val: string;
    if (a < 256) { val = bytes[a] ?? f + c; } else { val = e[a] ?? f + c; }
    g.push(val);
    c = val[0];
    e[o] = f + c;
    o++;
    f = val;
  }
  return g.join('');
}

export class LightningFetcher {
  private static blitzStrikes: LightningStrike[] = [];
  private static ws: WebSocket | null = null;
  private static connected = false;
  private static reconnectTimer: NodeJS.Timeout | null = null;
  private static reconnectDelay = 5000;
  private static errorLogged = false;

  static async fetchRecent(): Promise<LightningStrike[]> {
    const sources: Promise<LightningStrike[]>[] = [];

    if (XWEATHER_CLIENT_ID && XWEATHER_CLIENT_SECRET) {
      sources.push(this.fetchXWeatherLightning());
    }
    if (METEOMATICS_USERNAME && METEOMATICS_PASSWORD) {
      sources.push(this.fetchMeteomaticsLightning());
    }
    // Blitzortung is always included as a free source
    if (!this.connected) this.connectBlitzortung();
    sources.push(this.getBlitzortungStrikes());
    // Also try REST fallback for Blitzortung data
    sources.push(this.fetchBlitzortungRest());

    const results = await Promise.allSettled(sources);
    let allStrikes: LightningStrike[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') allStrikes.push(...r.value);
    }

    allStrikes = this.dedupStrikes(allStrikes);

    const now = Date.now();
    allStrikes = allStrikes.filter((s) => s.timestamp >= now - 30 * 60 * 1000);
    if (allStrikes.length > 5000) allStrikes = allStrikes.slice(-5000);

    const srcNames: string[] = [];
    if (XWEATHER_CLIENT_ID) srcNames.push('XWeather');
    if (METEOMATICS_USERNAME) srcNames.push('Meteomatics');
    srcNames.push('Blitzortung');
    if (allStrikes.length > 0) console.log(`Lightning fetched: ${allStrikes.length} strikes (sources: ${srcNames.join(', ')})`);

    return allStrikes;
  }

  private static async fetchXWeatherLightning(): Promise<LightningStrike[]> {
    const strikes: LightningStrike[] = [];
    try {
      // Fetch lightning summary for global recent strikes
      const raw = await fetchUrl(
        `https://data.api.xweather.com/lightning/summary?client_id=${XWEATHER_CLIENT_ID}&client_secret=${XWEATHER_CLIENT_SECRET}&limit=1000`,
        20000
      );
      const data = JSON.parse(raw);
      const items = data.response || [];
      for (const item of items) {
        const ob = item.ob || {};
        const loc = item.loc || {};
        const lat = safeNum(loc.lat);
        const lon = safeNum(loc.lon);
        if (lat === undefined || lon === undefined) continue;

        const ts = safeNum(ob.timestamp) ?? Date.now();
        const pulse = ob.pulse || {};
        strikes.push({
          id: `xw_ltg_${ts}_${lat.toFixed(3)}_${lon.toFixed(3)}`,
          lat, lon,
          timestamp: ts,
          amplitude: safeNum(pulse.peakAmp) ?? safeNum(ob.peakAmp),
          polarity: (pulse.polarity || ob.polarity) > 0 ? 'positive' : 'negative',
        });
      }
      console.log(`XWeather lightning: ${strikes.length}`);
    } catch (e) {
      console.error('XWeather lightning fetch failed:', (e as Error).message);
    }
    return strikes;
  }

  private static async fetchMeteomaticsLightning(): Promise<LightningStrike[]> {
    const strikes: LightningStrike[] = [];
    try {
      const now = new Date();
      const start = new Date(now.getTime() - 5 * 60 * 1000);
      const startISO = start.toISOString().replace(/\.\d{3}Z$/, 'Z');
      const endISO = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
      const url = `https://${METEOMATICS_USERNAME}:${METEOMATICS_PASSWORD}@api.meteomatics.com/get_lightning_list?time_range=${startISO}--${endISO}&bounding_box=-180,-90,180,90&format=json`;
      const raw = await fetchUrl(url, 20000);
      const data = JSON.parse(raw);
      const list = data.lightning_list || data.list || data || [];
      if (Array.isArray(list)) {
        for (const item of list) {
          const lat = safeNum(item.lat);
          const lon = safeNum(item.lon);
          if (lat === undefined || lon === undefined) continue;
          const ts = item.timestamp ? new Date(item.timestamp).getTime() : Date.now();
          strikes.push({
            id: `meteo_ltg_${ts}_${lat.toFixed(3)}_${lon.toFixed(3)}`,
            lat, lon,
            timestamp: ts,
            amplitude: safeNum(item.intensity) ?? safeNum(item.peakCurrent),
            polarity: safeNum(item.type) === 1 ? 'positive' : 'negative',
          });
        }
      }
      console.log(`Meteomatics lightning: ${strikes.length}`);
    } catch (e) {
      console.error('Meteomatics lightning fetch failed:', (e as Error).message);
    }
    return strikes;
  }

  private static async getBlitzortungStrikes(): Promise<LightningStrike[]> {
    const now = Date.now();
    this.blitzStrikes = this.blitzStrikes.filter((s) => s.timestamp >= now - 30 * 60 * 1000);
    if (this.blitzStrikes.length > 5000) this.blitzStrikes = this.blitzStrikes.slice(-5000);
    return this.blitzStrikes;
  }

  private static connectBlitzortung() {
    if (this.connected && this.ws) return;
    const servers = [
      'wss://ws1.blitzortung.org:3000/',
      'wss://ws2.blitzortung.org:3000/',
      'wss://ws3.blitzortung.org:3000/',
      'wss://ws4.blitzortung.org:3000/',
      'wss://ws5.blitzortung.org:3000/',
      'wss://ws6.blitzortung.org:3000/',
      'wss://ws7.blitzortung.org:3000/',
      'wss://ws8.blitzortung.org:3000/',
    ];
    const url = servers[Math.floor(Math.random() * servers.length)];
    try {
      this.ws = new WebSocket(url, { rejectUnauthorized: false });
      this.ws.on('open', () => {
        this.connected = true;
        this.reconnectDelay = 5000;
        this.errorLogged = false;
        this.ws?.send(JSON.stringify({ a: 111 }));
        console.log(`Blitzortung WebSocket connected to ${url}`);
      });
      this.ws.on('message', (data: Buffer) => {
        try {
          let jsonStr: string;
          if (data.length > 0 && data[0] !== 0x7b && data[0] !== 0x5b) {
            jsonStr = lzwDecode(data);
          } else {
            jsonStr = data.toString('utf8');
          }
          const strike = JSON.parse(jsonStr);
          const lat = safeNum(strike.lat);
          const lon = safeNum(strike.lon);
          if (lat === undefined || lon === undefined) return;
          const ts = typeof strike.time === 'number' ? Math.floor(strike.time / 1e6) : Date.now();
          this.blitzStrikes.push({
            id: `blitz_ltg_${ts}_${lat.toFixed(3)}_${lon.toFixed(3)}`,
            lat, lon, timestamp: ts,
            polarity: strike.pol > 0 ? 'positive' : 'negative',
          });
        } catch { /* ignore */ }
      });
      this.ws.on('close', () => {
        this.connected = false;
        this.ws = null;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connectBlitzortung(), this.reconnectDelay);
      });
      this.ws.on('error', (err: Error) => {
        if (!this.errorLogged) {
          console.error('Blitzortung WebSocket error:', err.message);
          this.errorLogged = true;
        }
        this.connected = false;
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60000);
      });
    } catch (e) {
      console.error('Blitzortung WebSocket connect failed:', e);
    }
  }

  private static async fetchBlitzortungRest(): Promise<LightningStrike[]> {
    const strikes: LightningStrike[] = [];
    try {
      // Blitzortung public data — last strikes via their public map data endpoint
      const now = Date.now();
      const raw = await fetchUrl('https://data.blitzortung.org/Data/Protected/last_strikes.php?number=500', 15000);
      const lines = raw.trim().split('\n');
      for (const line of lines) {
        try {
          const s = JSON.parse(line);
          const lat = safeNum(s.lat);
          const lon = safeNum(s.lon);
          if (lat === undefined || lon === undefined) continue;
          const ts = typeof s.time === 'number' ? Math.floor(s.time / 1e6) : now;
          strikes.push({
            id: `blitz_rest_${ts}_${lat.toFixed(3)}_${lon.toFixed(3)}`,
            lat, lon, timestamp: ts,
            polarity: s.pol > 0 ? 'positive' : 'negative',
          });
        } catch { /* skip unparseable lines */ }
      }
      console.log(`Blitzortung REST: ${strikes.length}`);
    } catch (e) {
      // This endpoint may require auth — silently skip
    }
    return strikes;
  }

  private static dedupStrikes(strikes: LightningStrike[]): LightningStrike[] {
    const result: LightningStrike[] = [];
    for (const s of strikes) {
      const isDup = result.some((r) => {
        if (Math.abs(r.timestamp - s.timestamp) > 2000) return false;
        const dist = Math.sqrt((r.lat - s.lat) ** 2 + (r.lon - s.lon) ** 2) * 111;
        return dist < 0.5;
      });
      if (!isDup) result.push(s);
    }
    return result;
  }
}
