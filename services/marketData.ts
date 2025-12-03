
import { MarketDataPoint } from '../types';

export interface MarketDataCache {
  [ticker: string]: MarketDataPoint[];
}

const YAHOO_HOSTS = [
    'https://query1.finance.yahoo.com/v8/finance/chart/',
    'https://query2.finance.yahoo.com/v8/finance/chart/'
];

interface ProxyDef {
    name: string;
    buildUrl: (target: string) => string;
}

// RESTORED: CodeTabs and CorsProxy are the most reliable for Yahoo, 
// BUT they must be used slowly (Serial processing) to avoid blocks.
const PROXIES: ProxyDef[] = [
    {
        name: 'codetabs',
        buildUrl: (target: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`
    },
    {
        name: 'corsproxy',
        buildUrl: (target: string) => `https://corsproxy.io/?${encodeURIComponent(target)}`
    },
    {
        name: 'allorigins',
        buildUrl: (target: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`
    }
];

let activeProxyIndex = 0;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const MarketDataService = {
  
  async fetchHistory(ticker: string, range: string = '5y', interval: string = '1d'): Promise<MarketDataPoint[]> {
    const cleanTicker = ticker.trim().toUpperCase();
    let lastError: any;

    // Retry loop
    for (let i = 0; i < PROXIES.length; i++) {
        const proxyIndex = (activeProxyIndex + i) % PROXIES.length;
        const proxy = PROXIES[proxyIndex];
        
        for (const host of YAHOO_HOSTS) {
            try {
                // Cache busting to ensure fresh data
                const cacheBuster = `&_=${Date.now()}`;
                const targetUrl = `${host}${cleanTicker}?interval=${interval}&range=${range}${cacheBuster}`;
                const fetchUrl = proxy.buildUrl(targetUrl);

                // console.log(`[MarketData] Fetching ${cleanTicker} via ${proxy.name}...`);

                const response = await fetch(fetchUrl, {
                    method: 'GET',
                    credentials: 'omit', // Standard "Simple Request" to avoid CORS Preflight
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const text = await response.text();
                
                // Strict validation: Check for HTML error pages masquerading as 200 OK
                if (!text || text.length < 50 || text.trim().startsWith('<')) {
                    throw new Error("Invalid response (HTML/Empty)");
                }
                
                let json;
                try {
                    json = JSON.parse(text);
                } catch (e) {
                    throw new Error("JSON Parse Error");
                }
                
                if (json.chart?.error) {
                    throw new Error(`Yahoo API Error: ${JSON.stringify(json.chart.error)}`);
                }

                const result = json.chart?.result?.[0];
                if (!result) throw new Error('No result object');

                const timestamps = result.timestamp;
                const quote = result.indicators.quote[0];
                
                if (!timestamps || !quote) {
                    return []; // Valid symbol, no data
                }

                const data: MarketDataPoint[] = [];
                const closes = quote.close;
                const opens = quote.open;
                const highs = quote.high;
                const lows = quote.low;
                const volumes = quote.volume;

                for (let j = 0; j < timestamps.length; j++) {
                    if (timestamps[j] && closes[j] !== null && closes[j] !== undefined) {
                        data.push({
                            date: new Date(timestamps[j] * 1000).toISOString().split('T')[0],
                            open: Number((opens[j] || closes[j]).toFixed(2)),
                            high: Number((highs[j] || closes[j]).toFixed(2)),
                            low: Number((lows[j] || closes[j]).toFixed(2)),
                            close: Number(closes[j].toFixed(2)),
                            volume: volumes[j] || 0
                        });
                    }
                }

                if (data.length === 0) throw new Error("Parsed data is empty");
                
                // Success - Remember this proxy works
                activeProxyIndex = proxyIndex;
                
                return data;

            } catch (error: any) {
                lastError = error;
                // Continue to next host/proxy
            }
        }
        
        // Wait before switching proxies
        await sleep(500);
    }

    console.error(`Failed to fetch ${cleanTicker}:`, lastError);
    throw lastError || new Error("Network Error");
  },

  calculateSMA(data: MarketDataPoint[], period: number, priceField: keyof MarketDataPoint = 'close'): { date: string; value: number }[] {
    const sma: { date: string; value: number }[] = [];
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) {
        sma.push({ date: data[i].date, value: NaN }); 
        continue;
      }

      let sum = 0;
      for (let j = 0; j < period; j++) {
        const val = data[i - j][priceField] as number;
        sum += val;
      }
      sma.push({ date: data[i].date, value: sum / period });
    }
    return sma;
  }
};
