
import { MarketDataPoint } from '../types';

export interface MarketDataCache {
  [ticker: string]: MarketDataPoint[];
}

// Host rotation
const YAHOO_HOSTS = [
    'https://query1.finance.yahoo.com/v8/finance/chart/',
    'https://query2.finance.yahoo.com/v8/finance/chart/'
];

interface ProxyDef {
    name: string;
    buildUrl: (target: string) => string;
}

// Robust Proxy List
// CodeTabs is often the most reliable for JSON, followed by AllOrigins.
const PROXIES: ProxyDef[] = [
    {
        name: 'allorigins',
        buildUrl: (target: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`
    },
    {
        name: 'codetabs',
        buildUrl: (target: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`
    },
    {
        name: 'corsproxy',
        buildUrl: (target: string) => `https://corsproxy.io/?${encodeURIComponent(target)}`
    }
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const MarketDataService = {
  
  async fetchHistory(ticker: string, range: string = '5y', interval: string = '1d'): Promise<MarketDataPoint[]> {
    let lastError: any;
    const cleanTicker = ticker.trim().toUpperCase();
    
    // Iterate through proxies
    for (const proxy of PROXIES) {
        // Iterate through Yahoo Hosts
        for (const host of YAHOO_HOSTS) {
            try {
                // Construct target URL
                const targetUrl = `${host}${cleanTicker}?interval=${interval}&range=${range}`;
                const fetchUrl = proxy.buildUrl(targetUrl);

                // console.log(`[MarketData] Fetching via ${proxy.name}:`, fetchUrl);

                const response = await fetch(fetchUrl, {
                    method: 'GET',
                    credentials: 'omit', // Prevent cookies
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const text = await response.text();
                
                // Validate response is not an error page disguised as 200 OK
                if (!text || text.length < 10) throw new Error("Empty response");
                if (text.startsWith('<')) throw new Error("Received HTML instead of JSON");
                if (text.includes("Will be right back")) throw new Error("Yahoo Rate Limit");

                let json;
                try {
                    json = JSON.parse(text);
                } catch (e) {
                    throw new Error("Invalid JSON");
                }
                
                if (json.chart?.error) {
                    throw new Error(`API Error: ${JSON.stringify(json.chart.error)}`);
                }

                const result = json.chart?.result?.[0];
                if (!result) throw new Error('No result in JSON');

                const timestamps = result.timestamp;
                const quote = result.indicators.quote[0];
                
                if (!timestamps || !quote) {
                    // Symbol might exist but has no data for this range
                    return []; 
                }

                const closes = quote.close;
                const opens = quote.open;
                const highs = quote.high;
                const lows = quote.low;
                const volumes = quote.volume;

                const data: MarketDataPoint[] = [];
                for (let i = 0; i < timestamps.length; i++) {
                    // Filter out nulls (common in Yahoo data)
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

                if (data.length === 0) throw new Error("Parsed data empty");
                
                // Success! Return immediately.
                return data;

            } catch (error: any) {
                // Log and continue to next fallback
                // console.warn(`Failed via ${proxy.name} (${host}): ${error.message}`);
                lastError = error;
                await sleep(500); // Wait a bit before hitting next proxy to be polite
            }
        }
    }

    console.error(`All attempts failed for ${cleanTicker}. Last error:`, lastError);
    throw lastError || new Error("Unknown error");
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
