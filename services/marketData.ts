
import { MarketDataPoint } from '../types';

const YAHOO_BASE = 'https://query2.finance.yahoo.com/v8/finance/chart/';

interface ProxyStrategy {
    name: string;
    fetch: (targetUrl: string) => Promise<string>;
}

// 1. CorsProxy.io (Fastest, Direct)
const fetchCorsProxy = async (target: string): Promise<string> => {
    const url = `https://corsproxy.io/?${encodeURIComponent(target)}`;
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`CorsProxy HTTP ${res.status}`);
    return await res.text();
};

// 2. AllOrigins Raw (Reliable)
const fetchAllOriginsRaw = async (target: string): Promise<string> => {
    const url = `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`;
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`AllOrigins Raw HTTP ${res.status}`);
    return await res.text();
};

// 3. AllOrigins JSON (Wrapper, most compatible)
const fetchAllOriginsJSON = async (target: string): Promise<string> => {
    const url = `https://api.allorigins.win/get?url=${encodeURIComponent(target)}&rand=${Date.now()}`;
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`AllOrigins JSON HTTP ${res.status}`);
    const data = await res.json();
    if (!data.contents) throw new Error('AllOrigins no contents');
    return data.contents; 
};

// 4. CodeTabs (Backup)
const fetchCodeTabs = async (target: string): Promise<string> => {
    const url = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`;
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`CodeTabs HTTP ${res.status}`);
    return await res.text();
};

const PROXIES: ProxyStrategy[] = [
    { name: 'corsproxy', fetch: fetchCorsProxy },
    { name: 'allorigins-raw', fetch: fetchAllOriginsRaw },
    { name: 'allorigins-json', fetch: fetchAllOriginsJSON },
    { name: 'codetabs', fetch: fetchCodeTabs },
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const MarketDataService = {
  
  async fetchHistory(ticker: string, range: string = '5y', interval: string = '1d'): Promise<MarketDataPoint[]> {
    // Strict cleaning
    const cleanTicker = ticker.trim().toUpperCase().replace(/[^A-Z0-9^.-]/g, '');
    
    // Yahoo URL (Minimal parameters to avoid blocking)
    const targetUrl = `${YAHOO_BASE}${cleanTicker}?interval=${interval}&range=${range}`;
    
    let lastError: any;

    // Try each proxy strategy in order
    for (const proxy of PROXIES) {
        try {
            // Fetch via Proxy
            const responseText = await proxy.fetch(targetUrl);

            // Validation 1: Empty
            if (!responseText || responseText.length < 50) {
                 throw new Error("Empty response");
            }
            
            // Validation 2: HTML/Error Page
            if (responseText.trim().toLowerCase().startsWith('<')) {
                throw new Error("HTML/Error Page detected");
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
                    return []; 
                }
                throw new Error(`Yahoo API Error: ${JSON.stringify(json.chart.error)}`);
            }

            const result = json.chart?.result?.[0];
            if (!result) throw new Error('No result object');

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
            await sleep(500); // Short cooldown before next proxy
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
