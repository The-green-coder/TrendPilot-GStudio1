
import { MarketDataPoint } from '../types';

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const EODHD_BASE = 'https://eodhd.com/api/eod/';
const EODHD_DEFAULT_KEY = '68ff66761ac269.80544168';

interface ProxyStrategy {
    name: string;
    fetch: (targetUrl: string) => Promise<string>;
}

// Helper for fetch with timeout
const fetchWithTimeout = async (url: string, timeoutMs: number = 6000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
        clearTimeout(id);
        return response;
    } catch (e) {
        clearTimeout(id);
        throw e;
    }
};

const PROXIES: ProxyStrategy[] = [
    { 
        name: 'corsproxy.io', 
        fetch: async (target) => {
            const res = await fetchWithTimeout(`https://corsproxy.io/?${encodeURIComponent(target)}`);
            if (!res.ok) throw new Error(`CorsProxy HTTP ${res.status}`);
            return await res.text();
        }
    },
    { 
        name: 'allorigins-raw', 
        fetch: async (target) => {
            const res = await fetchWithTimeout(`https://api.allorigins.win/raw?url=${encodeURIComponent(target)}&rand=${Date.now()}`);
            if (!res.ok) throw new Error(`AllOrigins Raw HTTP ${res.status}`);
            return await res.text();
        }
    },
    {
        name: 'codetabs',
        fetch: async (target) => {
            const res = await fetchWithTimeout(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`);
            if (!res.ok) throw new Error(`CodeTabs HTTP ${res.status}`);
            return await res.text();
        }
    }
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const fetchEODHD = async (ticker: string, range: string, apiKey?: string): Promise<MarketDataPoint[]> => {
    let formattedTicker = ticker.toUpperCase();
    if (!formattedTicker.includes('.') && !formattedTicker.startsWith('^')) {
        formattedTicker = `${formattedTicker}.US`;
    }

    const keyToUse = apiKey && apiKey.trim().length > 0 ? apiKey : EODHD_DEFAULT_KEY;
    const todayStr = new Date().toISOString().split('T')[0];
    let fromDate = '1970-01-01';

    if (range !== 'max') {
        const past = new Date();
        if (range === '10y') past.setFullYear(past.getFullYear() - 10);
        else if (range === '5y') past.setFullYear(past.getFullYear() - 5);
        else if (range === '3y') past.setFullYear(past.getFullYear() - 3);
        else past.setFullYear(past.getFullYear() - 1);
        fromDate = past.toISOString().split('T')[0];
    }

    const url = `${EODHD_BASE}${formattedTicker}?api_token=${keyToUse}&fmt=json&period=d&from=${fromDate}&to=${todayStr}&cb=${Date.now()}`;

    try {
        const res = await fetchWithTimeout(url, 10000);
        if (!res.ok) throw new Error(`EODHD HTTP ${res.status}`);
        const data = await res.json();
        
        if (!Array.isArray(data)) return [];

        return data.map((d: any) => ({
            date: d.date,
            open: parseFloat(d.open) || 0,
            high: parseFloat(d.high) || 0,
            low: parseFloat(d.low) || 0,
            close: parseFloat(d.close) || 0,
            volume: parseInt(d.volume) || 0
        })).filter(d => d.close > 0);
    } catch (error) {
        console.error("EODHD Fetch Error:", error);
        throw error;
    }
};

export const MarketDataService = {
  async fetchHistory(ticker: string, range: string = 'max', interval: string = '1d', provider: string = 'yfinance', apiKey?: string): Promise<MarketDataPoint[]> {
    if (provider === 'eodhd') return await fetchEODHD(ticker, range, apiKey);

    const nowTimestamp = Math.floor(Date.now() / 1000);
    let p1 = 0;
    
    if (range !== 'max') {
        const past = new Date();
        if (range === '10y') past.setFullYear(past.getFullYear() - 10);
        else if (range === '5y') past.setFullYear(past.getFullYear() - 5);
        else if (range === '3y') past.setFullYear(past.getFullYear() - 3);
        else past.setFullYear(past.getFullYear() - 1);
        p1 = Math.floor(past.getTime() / 1000);
    }

    const targetUrl = `${YAHOO_BASE}${ticker}?interval=${interval}&period1=${p1}&period2=${nowTimestamp}`;
    
    for (const proxy of PROXIES) {
        try {
            console.log(`[MarketData] Trying ${proxy.name} for ${ticker}...`);
            const responseText = await proxy.fetch(targetUrl);
            const json = JSON.parse(responseText);
            const result = json.chart?.result?.[0];
            if (!result) {
                console.warn(`[MarketData] ${proxy.name} returned empty chart result for ${ticker}`);
                continue;
            }
            
            const timestamps = result.timestamp;
            if (!timestamps) continue;
            
            const quote = result.indicators.quote[0];
            const data: MarketDataPoint[] = [];
            for (let j = 0; j < timestamps.length; j++) {
                if (timestamps[j] && quote.close[j] !== null) {
                    data.push({
                        date: new Date(timestamps[j] * 1000).toISOString().split('T')[0],
                        open: Number(quote.open[j] || quote.close[j]),
                        high: Number(quote.high[j] || quote.close[j]),
                        low: Number(quote.low[j] || quote.close[j]),
                        close: Number(quote.close[j]),
                        volume: quote.volume[j] || 0
                    });
                }
            }
            console.log(`[MarketData] Success via ${proxy.name}: ${data.length} records`);
            return data;
        } catch (e: any) {
            console.warn(`[MarketData] Proxy ${proxy.name} failed for ${ticker}: ${e.message}`);
            // Wait slightly before trying next proxy
            await sleep(300);
        }
    }
    
    throw new Error(`Failed to fetch ${ticker} through all available proxies. Yahoo might be temporarily blocking requests.`);
  }
};
