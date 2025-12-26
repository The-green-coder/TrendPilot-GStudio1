
import { MarketDataPoint } from '../types';

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const EODHD_BASE = 'https://eodhd.com/api/eod/';
const EODHD_DEFAULT_KEY = '68ff66761ac269.80544168';

interface ProxyStrategy {
    name: string;
    fetch: (targetUrl: string) => Promise<string>;
}

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

/**
 * Advanced Market Data Sanitization - Final Tier
 * Handles "Garbage Head" data, Zero-Drops, and extreme volatility spikes.
 */
const cleanData = (data: MarketDataPoint[]): MarketDataPoint[] => {
    if (data.length < 10) return data;

    // 1. Initial Sort and Basic Zero Removal
    let sorted = [...data]
        .sort((a, b) => a.date.localeCompare(b.date))
        .filter(d => d.close > 0.001 && !isNaN(d.close));

    if (sorted.length < 10) return sorted;

    const getMedian = (values: number[]) => {
        const v = [...values].sort((a, b) => a - b);
        const mid = Math.floor(v.length / 2);
        return v.length % 2 !== 0 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
    };

    /**
     * PASS 0: Garbage-Head Trim
     * Often free data starts with prices like 0.01 before suddenly jumping to 100.
     * We detect if the first 5% of data is >10x different from the overall median.
     */
    const overallMedian = getMedian(sorted.map(d => d.close));
    let startIdx = 0;
    for (let i = 0; i < Math.min(sorted.length, 50); i++) {
        // If price is less than 5% of overall median, it's likely pre-split garbage or bad history
        if (sorted[i].close < overallMedian * 0.05) {
            startIdx = i + 1;
        } else {
            break;
        }
    }
    if (startIdx > 0) sorted = sorted.slice(startIdx);

    /**
     * PASS 1: Rolling Median & Outlier Correction
     */
    const pass1: MarketDataPoint[] = [];
    for (let i = 0; i < sorted.length; i++) {
        const curr = { ...sorted[i] };
        const windowIdxs = [i-2, i-1, i, i+1, i+2].filter(idx => idx >= 0 && idx < sorted.length);
        const windowPrices = windowIdxs.map(idx => sorted[idx].close);
        const medianPrice = getMedian(windowPrices);

        const deviation = Math.abs(curr.close - medianPrice) / medianPrice;
        
        if (deviation > 0.25) {
            const next = sorted[i+1];
            if (next) {
                const nextDeviation = Math.abs(next.close - medianPrice) / medianPrice;
                if (nextDeviation < 0.15) {
                    curr.close = medianPrice;
                    curr.open = medianPrice;
                    curr.high = medianPrice;
                    curr.low = medianPrice;
                }
            } else {
                curr.close = medianPrice;
                curr.open = medianPrice;
            }
        }
        pass1.push(curr);
    }

    /**
     * PASS 2: Progressive Mean-Reversion & Stability
     */
    const cleaned: MarketDataPoint[] = [];
    for (let i = 0; i < pass1.length; i++) {
        const curr = { ...pass1[i] };
        const prev = cleaned.length > 0 ? cleaned[cleaned.length - 1] : null;
        
        if (prev) {
            const dropRatio = curr.close / prev.close;
            // Catch catastrophic drops (>85%) that immediately recover
            if (dropRatio < 0.15) {
                let recovered = false;
                for (let j = 1; j <= 4; j++) {
                    const future = pass1[i + j];
                    if (future && (future.close / prev.close) > 0.8) {
                        recovered = true;
                        break;
                    }
                }
                
                if (recovered) {
                    curr.close = prev.close;
                    curr.open = prev.close;
                    curr.high = prev.close;
                    curr.low = prev.close;
                }
            }
        }

        // Final High/Low clamping
        const bodyMax = Math.max(curr.open, curr.close);
        const bodyMin = Math.min(curr.open, curr.close);
        if (curr.high > bodyMax * 1.25) curr.high = bodyMax * 1.05;
        if (curr.low < bodyMin * 0.75) curr.low = bodyMin * 0.95;
        if (curr.high < bodyMax) curr.high = bodyMax;
        if (curr.low > bodyMin) curr.low = bodyMin;

        cleaned.push(curr);
    }

    return cleaned;
};

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

        const mapped = data.map((d: any) => ({
            date: d.date,
            open: parseFloat(d.open) || 0,
            high: parseFloat(d.high) || 0,
            low: parseFloat(d.low) || 0,
            close: parseFloat(d.close) || 0,
            volume: parseInt(d.volume) || 0
        })).filter(d => d.close > 0);

        return cleanData(mapped);
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
            if (!result) continue;
            
            const timestamps = result.timestamp;
            if (!timestamps) continue;
            
            const quote = result.indicators.quote[0];
            const rawData: MarketDataPoint[] = [];
            for (let j = 0; j < timestamps.length; j++) {
                if (timestamps[j] && quote.close[j] !== null) {
                    rawData.push({
                        date: new Date(timestamps[j] * 1000).toISOString().split('T')[0],
                        open: Number(quote.open[j] || quote.close[j]),
                        high: Number(quote.high[j] || quote.close[j]),
                        low: Number(quote.low[j] || quote.close[j]),
                        close: Number(quote.close[j]),
                        volume: quote.volume[j] || 0
                    });
                }
            }
            
            const cleaned = cleanData(rawData);
            console.log(`[MarketData] Success via ${proxy.name}: ${cleaned.length} cleaned records`);
            return cleaned;
        } catch (e: any) {
            console.warn(`[MarketData] Proxy ${proxy.name} failed: ${e.message}`);
            await sleep(300);
        }
    }
    
    throw new Error(`Failed to fetch ${ticker}. Source might be blocked or rate-limited.`);
  }
};
