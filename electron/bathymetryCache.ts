import * as https from 'https';

// Coarse global bathymetry grid (1-degree resolution from ETOPO1)
// Fetched once, cached for the app lifetime
const GRID_RESOLUTION = 2; // degrees
const GRID_LAT_SIZE = 180 / GRID_RESOLUTION;  // 90
const GRID_LON_SIZE = 360 / GRID_RESOLUTION;  // 180

let bathymetryGrid: Float32Array | null = null;
let fetchPromise: Promise<void> | null = null;

function fetchUrl(url: string, timeout = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout, rejectUnauthorized: false } as any, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location!, timeout).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

export async function ensureBathymetryGrid(): Promise<void> {
  if (bathymetryGrid || fetchPromise) {
    await fetchPromise;
    return;
  }

  fetchPromise = fetchGrid();
  await fetchPromise;
}

async function fetchGrid(): Promise<void> {
  try {
    // Fetch ETOPO1 ~2-degree grid from NOAA ERDDAP
    // Grid is 10800x21600 at 0.0167deg; stride 120 ≈ 2-degree resolution = 90x180 points
    const urls = [
      'https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.json?altitude%5B0:120:10799%5D%5B0:120:21599%5D',
      'https://upwell.pfeg.noaa.gov/erddap/griddap/etopo180.json?altitude%5B0:120:10799%5D%5B0:120:21599%5D',
    ];

    let raw: string | null = null;
    for (const url of urls) {
      try {
        console.log(`Fetching bathymetry grid...`);
        raw = await fetchUrl(url, 60000);
        if (raw) break;
      } catch (e) {
        console.error(`Bathymetry grid fetch failed (${url}):`, (e as Error).message);
      }
    }

    if (!raw) {
      console.error('All bathymetry grid URLs failed — depth checks will be skipped');
      return;
    }

    const data = JSON.parse(raw);

    const table = data.table;
    const latCol = table.columnNames.indexOf('latitude');
    const lonCol = table.columnNames.indexOf('longitude');
    const zCol = table.columnNames.indexOf('altitude');

    if (latCol < 0 || lonCol < 0 || zCol < 0) {
      console.error('Bathymetry grid: unexpected column names', table.columnNames);
      return;
    }

    const grid = new Float32Array(GRID_LAT_SIZE * GRID_LON_SIZE);
    grid.fill(NaN);

    for (const row of table.rows) {
      const lat = row[latCol];
      const lon = row[lonCol];
      const z = row[zCol];
      if (typeof lat !== 'number' || typeof lon !== 'number' || typeof z !== 'number') continue;

      const latIdx = Math.round((lat + 90) / GRID_RESOLUTION);
      const lonIdx = Math.round((lon + 180) / GRID_RESOLUTION);
      if (latIdx < 0 || latIdx >= GRID_LAT_SIZE || lonIdx < 0 || lonIdx >= GRID_LON_SIZE) continue;

      grid[latIdx * GRID_LON_SIZE + lonIdx] = z;
    }

    bathymetryGrid = grid;
    const validCount = grid.filter((v) => !isNaN(v)).length;
    console.log(`Bathymetry grid loaded: ${validCount} points (${GRID_LAT_SIZE}x${GRID_LON_SIZE})`);
  } catch (e) {
    console.error('Bathymetry grid fetch failed:', (e as Error).message);
  }
}

export function getOceanDepth(lat: number, lon: number): number | undefined {
  if (!bathymetryGrid) return undefined;

  // Normalize longitude to -180..180
  let normLon = lon;
  while (normLon > 180) normLon -= 360;
  while (normLon < -180) normLon += 360;

  const latIdx = Math.round((lat + 90) / GRID_RESOLUTION);
  const lonIdx = Math.round((normLon + 180) / GRID_RESOLUTION);

  if (latIdx < 0 || latIdx >= GRID_LAT_SIZE || lonIdx < 0 || lonIdx >= GRID_LON_SIZE) return undefined;

  const depth = bathymetryGrid[latIdx * GRID_LON_SIZE + lonIdx];
  if (isNaN(depth)) return undefined;

  // ETOPO1: positive = above sea level, negative = below sea level
  // Return ocean depth as positive number (0 if on land)
  return depth < 0 ? -depth : 0;
}
