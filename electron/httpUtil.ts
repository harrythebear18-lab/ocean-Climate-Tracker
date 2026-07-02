import * as https from 'https';
import * as http from 'http';
import * as dns from 'dns';

// ─── Custom DNS Resolver ───
// Use public DNS servers for reliable resolution
const DNS_SERVERS = [
  '8.8.8.8',       // Google Primary
  '1.1.1.1',       // Cloudflare Primary
  '8.8.4.4',       // Google Secondary
  '1.0.0.1',       // Cloudflare Secondary
  '9.9.9.9',       // Quad9
  '208.67.222.222', // OpenDNS Primary
];

const dnsResolvers = DNS_SERVERS.map(server => {
  const resolver = new dns.Resolver();
  resolver.setServers([server]);
  return resolver;
});

const dnsCache = new Map<string, { ip: string; expires: number }>();
const DNS_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function resolveHostname(hostname: string): Promise<string> {
  const cached = dnsCache.get(hostname);
  if (cached && cached.expires > Date.now()) {
    return cached.ip;
  }

  // Try each DNS server in sequence (first one that succeeds wins)
  for (const resolver of dnsResolvers) {
    try {
      const ip = await new Promise<string>((resolve, reject) => {
        resolver.resolve4(hostname, (err, addrs) => {
          if (err || !addrs || addrs.length === 0) {
            reject(err || new Error('No addresses'));
          } else {
            resolve(addrs[0]);
          }
        });
      });
      dnsCache.set(hostname, { ip, expires: Date.now() + DNS_TTL_MS });
      return ip;
    } catch {
      continue; // Try next DNS server
    }
  }

  // All public DNS failed — fallback to system DNS
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, (err, address) => {
      if (err) reject(err);
      else {
        dnsCache.set(hostname, { ip: address, expires: Date.now() + DNS_TTL_MS });
        resolve(address);
      }
    });
  });
}

// ─── HTTP Fetch with Custom DNS ───

export function fetchUrl(url: string, timeout = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;

    resolveHostname(parsed.hostname).then((ip) => {
      const options: https.RequestOptions = {
        timeout,
        hostname: ip, // Use resolved IP instead of hostname
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'Accept': 'application/json, application/geo+json, text/plain, */*',
          'User-Agent': 'ClimateTracker/1.0 (climate monitoring application)',
          'Host': parsed.hostname, // Set Host header to original hostname
        },
        rejectUnauthorized: false,
      };

      const req = mod.request(options, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let location = res.headers.location;
          if (location.startsWith('/')) {
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

      req.end();
    }).catch(reject);
  });
}
