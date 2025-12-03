
import { MarketDataPoint } from '../types';

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';

interface ProxyStrategy {
    name: string;
    fetch: (targetUrl: string) => Promise<string>;
}

// 1. CorsProxy.io (Direct Strategy) - Often the fastest
const fetchCorsProxy = async (target: string): Promise<string> => {
    const url = `https://corsproxy.io/?${encodeURIComponent(target)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CorsProxy HTTP ${res.status}`);
    return await res.text();
};

// 2. AllOrigins Raw (Direct Strategy) - Reliable
const fetchAllOriginsRaw = async (target: string): Promise<string> => {
    const url = `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`AllOrigins HTTP ${res.status}`);
    return await res.text();
};

// 3. ThingProxy (Direct Strategy) - Good Backup
const fetchThingProxy = async (target: string): Promise<string> => {
    const url = `https://thingproxy.freeboard.io/fetch/${target}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ThingProxy HTTP ${res.status}`);
    return await res.text();
};

const PROXIES: ProxyStrategy[] = [
    { name: 'corsproxy', fetch: fetchCorsProxy },
    { name: 'allorigins-raw', fetch: fetchAllOriginsRaw },
    { name: 'thingproxy', fetch: fetchThingProxy },
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const MarketDataService = {
  
  async fetchHistory(ticker: string, range: string = '5y', interval: string = '1d'): Promise<MarketDataPoint[]> {
    const cleanTicker = ticker.trim().toUpperCase().replace(/[^A-Z0-9^.-]/g, '');
    
    // Simplified Yahoo URL to reduce chance of blocking (removed events/adjustedClose)
    const targetUrl = `${YAHOO_BASE}${cleanTicker}?interval=${interval}&range=${range}`;
    
    let lastError: any;

    // Try each proxy strategy in order
    for (const proxy of PROXIES) {
        try {
            // Random delay 100-300ms to be polite and avoid local burst
            await sleep(100 + Math.random() * 200);

            const responseText = await proxy.fetch(targetUrl);

            // Validation: Check for empty or HTML response
            if (!responseText || responseText.length < 50) {
                 throw new Error("Empty response");
            }
            if (responseText.trim().startsWith('<') || responseText.includes('<!DOCTYPE html>')) {
                throw new Error("HTML/Error Page detected (Proxy blocked)");
            }

            // Parse Yahoo JSON
            let json;
            try {
                json = JSON.parse(responseText);
            } catch (e) {
                throw new Error("JSON Parse Failed");
            }

            // Logic Error Check
            if (json.chart?.error) {
                const code = json.chart.error.code;
                if (code === 'Not Found' || code === 'Not Found: No data found, symbol may be delisted') {
                    console.warn(`Symbol ${cleanTicker} not found on Yahoo Finance.`);
                    return []; 
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
            
            return data;

        } catch (error: any) {
            // console.warn(`Proxy ${proxy.name} failed for ${cleanTicker}:`, error.message);
            lastError = error;
        }
    }

    // console.error(`All proxies failed for ${cleanTicker}. Last Error:`, lastError);
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
