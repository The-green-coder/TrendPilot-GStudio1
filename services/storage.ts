
import { SymbolData, Strategy, BacktestResult, MarketDataPoint } from "../types";
import { INITIAL_SYMBOLS, INITIAL_STRATEGIES } from "../constants";

// Keys for LocalStorage (Sync)
const KEYS = {
  SYMBOLS: 'tc_symbols',
  STRATEGIES: 'tc_strategies',
  RESULTS: 'tc_results'
};

// IndexedDB Configuration (Async, for large Market Data)
const DB_NAME = 'TrendPilotDB';
const DB_VERSION = 1;
const STORE_NAME = 'market_data';

// --- IndexedDB Helpers ---
const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            reject(new Error("IndexedDB not supported"));
            return;
        }
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
    });
};

const dbOp = async (operation: (store: IDBObjectStore) => IDBRequest): Promise<any> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = operation(store);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        
        tx.oncomplete = () => db.close();
    });
};


export const StorageService = {
  // --- Symbols (LocalStorage) ---
  getSymbols: (): SymbolData[] => {
    const data = localStorage.getItem(KEYS.SYMBOLS);
    if (!data) {
      localStorage.setItem(KEYS.SYMBOLS, JSON.stringify(INITIAL_SYMBOLS));
      return INITIAL_SYMBOLS;
    }
    const symbols = JSON.parse(data);
    
    // Auto-migration: Fix NIFTY50 or ^NSEI to INDY (USD)
    const oldNifty = symbols.find((s: SymbolData) => s.ticker === 'NIFTY50' || s.ticker === '^NSEI');
    if (oldNifty) {
        oldNifty.ticker = 'INDY';
        oldNifty.name = 'India NIFTY 50 Index USD';
        oldNifty.exchange = 'NYSE';
        oldNifty.defaultCCY = 'USD';
        localStorage.setItem(KEYS.SYMBOLS, JSON.stringify(symbols));
    }
    return symbols;
  },

  saveSymbol: (symbol: SymbolData) => {
    const symbols = StorageService.getSymbols();
    const existingIndex = symbols.findIndex(s => s.id === symbol.id);
    if (existingIndex >= 0) {
      symbols[existingIndex] = symbol;
    } else {
      symbols.push(symbol);
    }
    localStorage.setItem(KEYS.SYMBOLS, JSON.stringify(symbols));
  },

  deleteSymbol: (id: string) => {
    const symbols = StorageService.getSymbols().filter(s => s.id !== id);
    localStorage.setItem(KEYS.SYMBOLS, JSON.stringify(symbols));
  },

  // --- Strategies (LocalStorage) ---
  getStrategies: (): Strategy[] => {
    const data = localStorage.getItem(KEYS.STRATEGIES);
    if (!data) {
        localStorage.setItem(KEYS.STRATEGIES, JSON.stringify(INITIAL_STRATEGIES));
        return INITIAL_STRATEGIES;
    }
    const strategies = JSON.parse(data);
    if (strategies.length === 0) {
        localStorage.setItem(KEYS.STRATEGIES, JSON.stringify(INITIAL_STRATEGIES));
        return INITIAL_STRATEGIES;
    }
    
    // Force Update Default Strategy to Weekly/Rule 2
    const defaultStrat = strategies.find((s: Strategy) => s.id === 'default_tripletrend_qqq');
    if (defaultStrat) {
        const initialDef = INITIAL_STRATEGIES[0];
        if (defaultStrat.rebalanceFreq !== initialDef.rebalanceFreq || 
            defaultStrat.rules[0]?.ruleId !== initialDef.rules[0]?.ruleId) {
            Object.assign(defaultStrat, initialDef);
            localStorage.setItem(KEYS.STRATEGIES, JSON.stringify(strategies));
        }
    }

    return strategies;
  },

  saveStrategy: (strategy: Strategy) => {
    const list = StorageService.getStrategies();
    const existingIndex = list.findIndex(s => s.id === strategy.id);
    if (existingIndex >= 0) {
      list[existingIndex] = strategy;
    } else {
      list.push(strategy);
    }
    localStorage.setItem(KEYS.STRATEGIES, JSON.stringify(list));
  },

  // --- Backtest Results (LocalStorage) ---
  saveBacktestResult: (result: BacktestResult) => {
    const list = StorageService.getBacktestResults();
    list.push(result);
    if (list.length > 20) list.shift();
    localStorage.setItem(KEYS.RESULTS, JSON.stringify(list));
  },

  getBacktestResults: (): BacktestResult[] => {
    const data = localStorage.getItem(KEYS.RESULTS);
    return data ? JSON.parse(data) : [];
  },

  // --- Real Market Data Storage (IndexedDB) ---
  saveMarketData: async (ticker: string, data: MarketDataPoint[]): Promise<boolean> => {
      try {
          await dbOp(store => store.put(data, ticker));
          return true;
      } catch (e) {
          console.error("IndexedDB Save Error", e);
          return false;
      }
  },

  getMarketData: async (ticker: string): Promise<MarketDataPoint[] | null> => {
      try {
          const data = await dbOp(store => store.get(ticker));
          return data || null;
      } catch (e) {
          console.error("IndexedDB Get Error", e);
          return null;
      }
  },

  clearMarketData: async () => {
      try {
          await dbOp(store => store.clear());
      } catch (e) {
          console.error("IndexedDB Clear Error", e);
      }
  },

  hasMarketData: async (ticker: string): Promise<boolean> => {
      try {
          const data = await dbOp(store => store.get(ticker));
          return !!data && data.length > 0;
      } catch (e) {
          return false;
      }
  }
};
