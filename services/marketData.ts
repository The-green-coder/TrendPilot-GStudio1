
import { MarketDataPoint } from '../types';

const YAHOO_BASE = 'https://query2.finance.yahoo.com/v8/finance/chart/';
const EODHD_BASE = 'https://eodhd.com/api/eod/';
const EODHD_DEFAULT_KEY = '68ff66761ac269.80544168';

interface ProxyStrategy {
    name: string;
    fetch: (targetUrl: string) => Promise<string>;
}

// --- PROXY STRATEGIES FOR YAHOO ---

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
    { name: 'allorigins-json', fetch: fetchAllOriginsJSON }, // Most reliable first
    { name: 'corsproxy', fetch: fetchCorsProxy },
    { name: 'codetabs', fetch: fetchCodeTabs },
    { name: 'allorigins-raw', fetch: fetchAllOriginsRaw },
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// --- EODHD FETCHER (Direct) ---
const fetchEODHD = async (ticker: string, range: string, apiKey?: string): Promise<MarketDataPoint[]> => {
    // EODHD requires Exchange suffix for most symbols. 
    // We assume US default if no suffix provided.
    // e.g. "SPY" -> "SPY.US", "INDY" -> "INDY.US"
    let formattedTicker = ticker;
    if (!ticker.includes('.') && !ticker.startsWith('^')) {
        formattedTicker = `${ticker}.US`;
    }
    // Handle Nifty special case if using ^NSEI
    if (ticker === '^NSEI') formattedTicker = 'NSEI.INDX';

    // Calculate From Date
    // We intentionally fetch MORE data than 'range' implies to handle Moving Average warmups.
    // e.g. if 5y requested, we fetch 6y to be safe.
    const now = new Date();
    const past = new Date();
    
    // Set a generous buffer
    if (range === '5y') past.setFullYear(now.getFullYear() - 6);
    else if (range === '1y') past.setFullYear(now.getFullYear() - 2);
    else if (range === 'max') past.setFullYear(1990); // Way back
    else past.setFullYear(now.getFullYear() - 6); // Default 6 years
    
    const fromDate = past.toISOString().split('T')[0];
    const keyToUse = apiKey && apiKey.trim().length > 0 ? apiKey : EODHD_DEFAULT_KEY;

    const url = `${EODHD_BASE}${formattedTicker}?api_token=${keyToUse}&fmt=json&from=${fromDate}`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            // Check for common EODHD errors
            if (res.status === 403) throw new Error("EODHD API Key Invalid or Limit Reached");
            if (res.status === 404) throw new Error("Symbol not found on EODHD");
            throw new Error(`EODHD HTTP ${res.status}`);
        }
        
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("EODHD returned invalid format");

        return data.map((d: any) => ({
            date: d.date,
            open: Number(d.open),
            high: Number(d.high),
            low: Number(d.low),
            close: Number(d.close),
            volume: Number(d.volume)
        }));

    } catch (e) {
        console.error("EODHD Fetch Error:", e);
        throw e;
    }
};

export const MarketDataService = {
  
  async fetchHistory(ticker: string, range: string = '5y', interval: string = '1d', provider: string = 'yfinance', apiKey?: string): Promise<MarketDataPoint[]> {
    const cleanTicker = ticker.trim().toUpperCase().replace(/[^A-Z0-9^.-]/g, '');

    // 1. EODHD PATH
    if (provider === 'eodhd') {
        return await fetchEODHD(cleanTicker, range, apiKey);
    }

    // 2. YAHOO (PROXY) PATH
    const targetUrl = `${YAHOO_BASE}${cleanTicker}?interval=${interval}&range=${range}`;
    let lastError: any;

    for (const proxy of PROXIES) {
        try {
            const responseText = await proxy.fetch(targetUrl);

            // Validation
            if (!responseText || responseText.length < 50) throw new Error("Empty response");
            if (responseText.trim().toLowerCase().startsWith('<')) throw new Error("HTML/Error Page detected");

            let json;
            try {
                json = JSON.parse(responseText);
            } catch (e) {
                throw new Error("JSON Parse Failed");
            }

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
            return data;

        } catch (error: any) {
            console.warn(`Proxy ${proxy.name} failed for ${cleanTicker}: ${error.message}`);
            lastError = error;
            await sleep(500); 
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
