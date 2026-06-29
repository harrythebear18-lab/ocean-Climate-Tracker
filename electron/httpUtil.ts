import * as https from 'https';
import * as http from 'http';
import * as dns from 'dns';

// ─── Global DNS Override ───
// Force Node.js to use public DNS servers instead of flaky system DNS.
dns.setServers([
  '8.8.8.8',
  '1.1.1.1',
  '8.8.4.4',
  '1.0.0.1',
]);
dns.setDefaultResultOrder('ipv4first');

// ─── HTTP Fetch ───
// Simple fetch with redirect support — same as original but with global DNS override active.

export function fetchUrl(url: string, timeout = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const mod = isHttps ? https : http;
    const options: https.RequestOptions = {
      timeout,
      headers: {
        'Accept': 'application/json, application/geo+json, text/plain, */*',
        'User-Agent': 'ClimateTracker/1.0 (climate monitoring application)',
      },
      rejectUnauthorized: false,
    };
    const req = mod.get(url, options as any, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let location = res.headers.location;
        if (location.startsWith('/')) {
          const parsed = new URL(url);
          location = `${parsed.protocol}//${parsed.host}${location}`;
        }
        fetchUrl(location, timeout).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}
