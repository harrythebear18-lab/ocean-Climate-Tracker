import { Vessel } from '../src/types';

const AXIOM_API = 'https://www.axiomoverwatch.io/api/v1/positions/latest';

export class VesselFetcher {
  static async fetchVessels(): Promise<Vessel[]> {
    const url = `${AXIOM_API}?west=-180&south=-90&east=180&north=90`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });
      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`Axiom API returned ${res.status}`);
      }

      const data = await res.json() as {
        type: string;
        features: Array<{
          type: string;
          geometry: { type: string; coordinates: [number, number] };
          properties: {
            imo: string;
            name: string;
            vessel_type: string;
            flag: string | null;
            speed: number | null;
            course: number | null;
            draft: number | null;
            destination: string | null;
            nav_status: string | null;
            timestamp: string;
          };
        }>;
      };

      const vessels: Vessel[] = [];
      for (const f of data.features) {
        const [lon, lat] = f.geometry.coordinates;
        if (typeof lat !== 'number' || typeof lon !== 'number') continue;
        vessels.push({
          imo: f.properties.imo,
          name: f.properties.name || 'Unknown',
          lat,
          lon,
          speed: f.properties.speed ?? undefined,
          course: f.properties.course ?? undefined,
          draft: f.properties.draft ?? undefined,
          vesselType: f.properties.vessel_type ?? undefined,
          flag: f.properties.flag ?? undefined,
          navStatus: f.properties.nav_status ?? undefined,
          destination: f.properties.destination ?? undefined,
          timestamp: new Date(f.properties.timestamp).getTime(),
        });
      }

      console.log(`Vessels fetched: ${vessels.length} from Axiom Overwatch`);
      return vessels;
    } catch (e) {
      clearTimeout(timeout);
      console.error(`Vessel fetch failed:`, e);
      return [];
    }
  }
}
