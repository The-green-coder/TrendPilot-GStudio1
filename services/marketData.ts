
import { MarketDataPoint } from '../types';

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';

interface ProxyStrategy {
    name: string;
    fetch: (targetUrl: string) => Promise<string>;
}

// 1. AllOrigins (Wrapper Strategy) - Most Reliable
// Returns JSON: { contents: "actual_response_string", status: { ... } }
const fetchAllOrigins = async (target: string): Promise<string> => {
    const url = `https://api.allorigins.win/get?url=${encodeURIComponent(target)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`AllOrigins HTTP ${res.status}`);
    const wrapper = await res.json();
    if (!wrapper.contents) throw new Error("AllOrigins no content");
    return wrapper.contents; 
};

// 2. CorsProxy.io (Direct Strategy) - Fastest
const fetchCorsProxy = async (target: string): Promise<string> => {
    const url = `https://corsproxy.io/?${encodeURIComponent(target)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CorsProxy HTTP ${res.status}`);
    return await res.text();
};

// 3. CodeTabs (Direct Strategy) - Backup
const fetchCodeTabs = async (target: string): Promise<string> => {
    const url = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CodeTabs HTTP ${res.status}`);
    return await res.text();
};

const PROXIES: ProxyStrategy[] = [
    { name: 'allorigins', fetch: fetchAllOrigins },
    { name: 'corsproxy', fetch: fetchCorsProxy },
    { name: 'codetabs', fetch: fetchCodeTabs },
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const MarketDataService = {
  
  async fetchHistory(ticker: string, range: string = '5y', interval: string = '1d'): Promise<MarketDataPoint[]> {
    const cleanTicker = ticker.trim().toUpperCase().replace(/[^A-Z0-9^.-]/g, '');
    
    // Yahoo URL Construction
    // timestamps prevent caching
    const targetUrl = `${YAHOO_BASE}${cleanTicker}?interval=${interval}&range=${range}&events=div,splits&includeAdjustedClose=true&_=${Date.now()}`;
    
    let lastError: any;

    // Try each proxy strategy in order
    for (const proxy of PROXIES) {
        try {
            // console.log(`[MarketData] Fetching ${cleanTicker} via ${proxy.name}...`);
            
            // 1. Fetch raw string using specific proxy strategy
            const responseText = await proxy.fetch(targetUrl);

            // 2. Validation
            if (!responseText || responseText.length < 50 || responseText.trim().startsWith('<')) {
                throw new Error("Invalid/HTML response");
            }

            // 3. Parse Yahoo JSON
            let json;
            try {
                json = JSON.parse(responseText);
            } catch (e) {
                throw new Error("JSON Parse Error");
            }

            // 4. Check Yahoo Logic Errors
            if (json.chart?.error) {
                // If symbol is not found, DO NOT retry. It's a waste of time.
                const code = json.chart.error.code;
                if (code === 'Not Found' || code === 'Not Found: No data found, symbol may be delisted') {
                    console.warn(`Symbol ${cleanTicker} not found on Yahoo Finance.`);
                    return []; // Return empty to indicate "Finished but empty"
                }
                throw new Error(`Yahoo API Error: ${JSON.stringify(json.chart.error)}`);
            }

            const result = json.chart?.result?.[0];
            if (!result) throw new Error('No result object in Yahoo response');

            // 5. Transform Data
            const timestamps = result.timestamp;
            const quote = result.indicators.quote[0];
            
            if (!timestamps || !quote) {
                return []; 
            }

            const data: MarketDataPoint[] = [];
            const closes = quote.close;
            const opens = quote.open;
            const highs = quote.high;
            const lows = quote.low;
            const volumes = quote.volume;

            for (let j = 0; j < timestamps.length; j++) {
                // Filter out nulls (common in Yahoo data)
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
            // console.warn(`Proxy ${proxy.name} failed for ${cleanTicker}:`, error.message);
            lastError = error;
            // Wait slightly before switching proxies to be polite
            await sleep(200);
        }
    }

    console.error(`All proxies failed for ${cleanTicker}. Last Error:`, lastError);
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
