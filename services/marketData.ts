
import { MarketDataPoint } from '../types';

export interface MarketDataCache {
  [ticker: string]: MarketDataPoint[];
}

// Host rotation
const YAHOO_HOSTS = [
    'https://query2.finance.yahoo.com/v8/finance/chart/',
    'https://query1.finance.yahoo.com/v8/finance/chart/'
];

// Proxy rotation strategies
// We use multiple proxies because Yahoo Finance rate limits or blocks them frequently.
const PROXIES = [
    {
        name: 'codetabs',
        url: (target: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`
    },
    {
        name: 'corsproxy',
        url: (target: string) => `https://corsproxy.io/?${encodeURIComponent(target)}`
    },
    {
        name: 'allorigins',
        url: (target: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`
    },
    {
        name: 'thingproxy',
        url: (target: string) => `https://thingproxy.freeboard.io/fetch/${target}`
    }
];

export const MarketDataService = {
  
  async fetchHistory(ticker: string, range: string = '5y', interval: string = '1d'): Promise<MarketDataPoint[]> {
    let lastError: any;
    const cleanTicker = ticker.trim().toUpperCase();
    
    // Add cache buster to prevent sticky 403s/CORS errors from proxies
    const cacheBuster = `&_cb=${Date.now()}`;

    // Try every combination of Proxy and Host until success
    for (const proxy of PROXIES) {
        for (const host of YAHOO_HOSTS) {
            try {
                // Yahoo API parameters
                // includeAdjustedClose=true is standard, sometimes helps with data consistency
                const targetUrl = `${host}${cleanTicker}?interval=${interval}&range=${range}&events=history&includeAdjustedClose=true${cacheBuster}`;
                const fetchUrl = proxy.url(targetUrl);
                
                // console.log(`Attempting fetch via ${proxy.name}:`, fetchUrl);

                const response = await fetch(fetchUrl, {
                    cache: 'no-store', // Prevent caching of failed CORS responses
                    headers: {
                        'Accept': 'application/json'
                    }
                });
                
                if (response.status === 403 || response.status === 401) {
                    throw new Error(`Blocked (${response.status}) by provider via ${proxy.name}`);
                }

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status} via ${proxy.name}`);
                }
                
                // Robust parsing: Get text first, validate it looks like JSON
                const text = await response.text();
                if (!text || text.trim().length === 0) throw new Error("Empty response");
                
                // Common proxy error pages or Yahoo blocks
                if (text.includes("Will be right back") || text.includes("Oath") || text.includes("999 Unable to process")) {
                     throw new Error("Yahoo Rate Limit/Block detected");
                }
                
                let json;
                try {
                    json = JSON.parse(text);
                } catch (e) {
                    // console.warn("JSON Parse failed", text.substring(0, 100));
                    throw new Error(`JSON Parse Error: ${e instanceof Error ? e.message : String(e)}`);
                }
                
                if (json.chart?.error) {
                    throw new Error(JSON.stringify(json.chart.error));
                }

                const result = json.chart?.result?.[0];
                if (!result) throw new Error('No data found in response structure');

                const timestamps = result.timestamp;
                const quote = result.indicators.quote[0];
                
                if (!timestamps || !quote) return [];

                const opens = quote.open;
                const highs = quote.high;
                const lows = quote.low;
                const closes = quote.close;
                const volumes = quote.volume;

                const data: MarketDataPoint[] = [];
                for (let i = 0; i < timestamps.length; i++) {
                    // Filter out nulls
                    if (timestamps[i] && closes[i] !== null && closes[i] !== undefined) {
                        const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
                        data.push({
                            date,
                            open: Number((opens[i] || closes[i]).toFixed(2)),
                            high: Number((highs[i] || closes[i]).toFixed(2)),
                            low: Number((lows[i] || closes[i]).toFixed(2)),
                            close: Number(closes[i].toFixed(2)),
                            volume: volumes[i] || 0
                        });
                    }
                }
                
                if (data.length === 0) throw new Error("Parsed data is empty");

                // If success, return immediately
                return data;

            } catch (error) {
                lastError = error;
                // Continue loop to next proxy/host
                // console.warn(`Failed via ${proxy.name} on ${host}:`, error);
            }
        }
    }

    console.error(`All fetch attempts failed for ${cleanTicker}. Last error:`, lastError);
    throw lastError;
  },

  /**
   * Calculates Simple Moving Average
   * @param data Array of MarketDataPoints
   * @param period Period for SMA
   * @param priceField Optional field to use (default: close)
   */
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
