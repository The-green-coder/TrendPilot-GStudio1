
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

// Curated list of proxies that handle "Simple Requests" well (No Preflight/CORS issues)
const PROXIES: ProxyDef[] = [
    {
        name: 'allorigins',
        buildUrl: (target: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`
    },
    {
        name: 'thingproxy',
        buildUrl: (target: string) => `https://thingproxy.freeboard.io/fetch/${target}`
    }
];

// Keep track of which proxy is currently working to speed up subsequent requests
let activeProxyIndex = 0;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const MarketDataService = {
  
  async fetchHistory(ticker: string, range: string = '5y', interval: string = '1d'): Promise<MarketDataPoint[]> {
    const cleanTicker = ticker.trim().toUpperCase();
    let lastError: any;

    // Try proxies starting from the last known good one (activeProxyIndex)
    // We loop through the list once.
    for (let i = 0; i < PROXIES.length; i++) {
        const proxyIndex = (activeProxyIndex + i) % PROXIES.length;
        const proxy = PROXIES[proxyIndex];
        
        // Try Yahoo Hosts
        for (const host of YAHOO_HOSTS) {
            try {
                // Add random timestamp to prevent caching of error pages by the proxy
                const cacheBuster = `&_=${Date.now()}`;
                const targetUrl = `${host}${cleanTicker}?interval=${interval}&range=${range}${cacheBuster}`;
                const fetchUrl = proxy.buildUrl(targetUrl);

                // console.log(`[MarketData] Fetching ${cleanTicker} via ${proxy.name}...`);

                const response = await fetch(fetchUrl, {
                    method: 'GET',
                    credentials: 'omit', // Critical: treats as Simple Request, skips CORS Preflight
                    // No custom headers allowed for Simple Request
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const text = await response.text();
                
                // Strict validation
                if (!text || text.length < 10) throw new Error("Empty response");
                if (text.trim().startsWith('<')) throw new Error("Received HTML error page");
                
                let json;
                try {
                    json = JSON.parse(text);
                } catch (e) {
                    throw new Error("Invalid JSON structure");
                }
                
                if (json.chart?.error) {
                    throw new Error(`API Error: ${JSON.stringify(json.chart.error)}`);
                }

                const result = json.chart?.result?.[0];
                if (!result) throw new Error('No result object in JSON');

                const timestamps = result.timestamp;
                const quote = result.indicators.quote[0];
                
                if (!timestamps || !quote) {
                    return []; // Valid symbol, just no data
                }

                const data: MarketDataPoint[] = [];
                const closes = quote.close;
                const opens = quote.open;
                const highs = quote.high;
                const lows = quote.low;
                const volumes = quote.volume;

                for (let j = 0; j < timestamps.length; j++) {
                    // Yahoo often returns nulls for some intervals
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
                
                // Success! Update the active proxy index so future requests use this reliable one first.
                activeProxyIndex = proxyIndex;
                
                return data;

            } catch (error: any) {
                // console.warn(`Failed ${cleanTicker} via ${proxy.name}: ${error.message}`);
                lastError = error;
                // Don't sleep here; fast fail to next proxy/host
            }
        }
        // Small delay before switching proxies entirely to avoid burst-limit on the next proxy
        await sleep(200);
    }

    console.error(`All proxies failed for ${cleanTicker}. Last error:`, lastError);
    throw lastError || new Error("Network/Proxy Error");
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
