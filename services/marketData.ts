
import { MarketDataPoint } from '../types';

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';

interface ProxyStrategy {
    name: string;
    fetch: (targetUrl: string) => Promise<string>;
}

// 1. AllOrigins JSON (Wrapper Strategy) - Most CORS friendly
// Returns { contents: "string_response", ... }
const fetchAllOriginsJSON = async (target: string): Promise<string> => {
    // Cache bust with timestamp to prevent stale errors
    const url = `https://api.allorigins.win/get?url=${encodeURIComponent(target)}&rand=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`AllOrigins JSON HTTP ${res.status}`);
    const data = await res.json();
    if (!data.contents) throw new Error('AllOrigins no contents');
    return data.contents; 
};

// 2. CodeTabs (Direct Strategy) - Reliable for raw data
const fetchCodeTabs = async (target: string): Promise<string> => {
    const url = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CodeTabs HTTP ${res.status}`);
    return await res.text();
};

// 3. ThingProxy (Direct Strategy) - Backup
const fetchThingProxy = async (target: string): Promise<string> => {
    const url = `https://thingproxy.freeboard.io/fetch/${target}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ThingProxy HTTP ${res.status}`);
    return await res.text();
};

const PROXIES: ProxyStrategy[] = [
    { name: 'allorigins-json', fetch: fetchAllOriginsJSON },
    { name: 'codetabs', fetch: fetchCodeTabs },
    { name: 'thingproxy', fetch: fetchThingProxy },
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const MarketDataService = {
  
  async fetchHistory(ticker: string, range: string = '5y', interval: string = '1d'): Promise<MarketDataPoint[]> {
    // Strict cleaning
    const cleanTicker = ticker.trim().toUpperCase().replace(/[^A-Z0-9^.-]/g, '');
    
    // Simplified Yahoo URL
    const targetUrl = `${YAHOO_BASE}${cleanTicker}?interval=${interval}&range=${range}`;
    
    let lastError: any;

    // Try each proxy strategy in order
    for (const proxy of PROXIES) {
        try {
            await sleep(200 + Math.random() * 300); // Jitter to be polite

            // Fetch via Proxy
            const responseText = await proxy.fetch(targetUrl);

            // Validation 1: Empty
            if (!responseText || responseText.length < 50) {
                 throw new Error("Empty response");
            }
            
            // Validation 2: HTML/Error Page
            // Yahoo error pages often start with <!doctype html> or <html
            if (responseText.trim().toLowerCase().startsWith('<')) {
                throw new Error("HTML/Error Page detected (Proxy/Yahoo blocked)");
            }

            // Parse Yahoo JSON
            let json;
            try {
                json = JSON.parse(responseText);
            } catch (e) {
                throw new Error("JSON Parse Failed");
            }

            // Yahoo Logic Error Check
            if (json.chart?.error) {
                const code = json.chart.error.code;
                if (code === 'Not Found' || code === 'Not Found: No data found, symbol may be delisted') {
                    console.warn(`Symbol ${cleanTicker} not found on Yahoo Finance.`);
                    return []; // Return empty for valid "Not Found" to stop retries
                }
                throw new Error(`Yahoo API Error: ${JSON.stringify(json.chart.error)}`);
            }

            const result = json.chart?.result?.[0];
            if (!result) throw new Error('No result object in Yahoo response');

            const timestamps = result.timestamp;
            const quote = result.indicators.quote[0];
            
            if (!timestamps || !quote) return []; 

            const data: MarketDataPoint[] = [];
            const closes = quote.close;
            const opens = quote.open;
            const highs = quote.high;
            const lows = quote.low;
            const volumes = quote.volume;

            for (let j = 0; j < timestamps.length; j++) {
                // Yahoo sometimes returns nulls for trading halts or glitches
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
            
            // Success!
            return data;

        } catch (error: any) {
            console.warn(`Proxy ${proxy.name} failed for ${cleanTicker}: ${error.message}`);
            lastError = error;
            // Continue to next proxy...
        }
    }

    throw lastError || new Error("All proxies failed");
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
