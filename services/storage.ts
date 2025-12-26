
import { SymbolData, Strategy, BacktestResult, MarketDataPoint } from "../types";
import { INITIAL_SYMBOLS, INITIAL_STRATEGIES } from "../constants";

const KEYS = {
  SYMBOLS: 'tp_stable_symbols_v1',
  STRATEGIES: 'tp_stable_strategies_v1',
  RESULTS: 'tp_stable_results_v1',
  INSTALL_FLAG: 'tp_engine_installed_v1',
  ACTIVE_SOURCE: 'tp_active_source_v1', // 'live' | 'backup'
  BACKUP_TS: 'tp_backup_timestamp_v1'
};

const DB_NAME = 'TrendPilot_MarketData_Stable_v1';
const DB_VERSION = 2; // Incremented for backup store
const STORE_NAME = 'ohlcv_cache';
const BACKUP_STORE_NAME = 'ohlcv_cache_backup';

let dbInstance: IDBDatabase | null = null;
let dbInitializationPromise: Promise<IDBDatabase> | null = null;

const initDB = (): Promise<IDBDatabase> => {
    if (dbInitializationPromise) return dbInitializationPromise;

    dbInitializationPromise = new Promise((resolve, reject) => {
        if (navigator.storage && navigator.storage.persist) {
            navigator.storage.persist().then(granted => {
                if (granted) console.log("[Storage] Persistent storage granted.");
            });
        }

        const request = window.indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
            if (!db.objectStoreNames.contains(BACKUP_STORE_NAME)) {
                db.createObjectStore(BACKUP_STORE_NAME);
            }
        };
        request.onsuccess = () => {
            dbInstance = request.result;
            resolve(dbInstance);
        };
        request.onerror = () => {
            dbInitializationPromise = null;
            reject(request.error);
        };
    });

    return dbInitializationPromise;
};

const dbOp = async <T>(storeName: string, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest): Promise<T> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            const req = operation(store);
            let result: T;
            req.onsuccess = () => { result = req.result; };
            req.onerror = () => reject(req.error);
            tx.oncomplete = () => resolve(result);
        } catch (err) {
            reject(err);
        }
    });
};

const ensureInstalled = () => {
    const installed = localStorage.getItem(KEYS.INSTALL_FLAG);
    if (!installed) {
        localStorage.setItem(KEYS.SYMBOLS, JSON.stringify(INITIAL_SYMBOLS));
        localStorage.setItem(KEYS.STRATEGIES, JSON.stringify(INITIAL_STRATEGIES));
        localStorage.setItem(KEYS.INSTALL_FLAG, 'true');
        localStorage.setItem(KEYS.ACTIVE_SOURCE, 'live');
    } else {
        // Migration/Sync check
        const source = localStorage.getItem(KEYS.ACTIVE_SOURCE) || 'live';
        if (source === 'live') {
            // Sync Symbols
            const storedSymbolsData = localStorage.getItem(KEYS.SYMBOLS);
            if (storedSymbolsData) {
                const storedSymbols: SymbolData[] = JSON.parse(storedSymbolsData);
                let symbolsUpdated = false;
                INITIAL_SYMBOLS.forEach(is => {
                    if (!storedSymbols.find(s => s.ticker === is.ticker)) {
                        storedSymbols.push(is);
                        symbolsUpdated = true;
                    }
                });
                if (symbolsUpdated) {
                    localStorage.setItem(KEYS.SYMBOLS, JSON.stringify(storedSymbols));
                }
            }

            // Sync Strategies
            const storedStrategiesData = localStorage.getItem(KEYS.STRATEGIES);
            if (storedStrategiesData) {
                const storedStrategies: Strategy[] = JSON.parse(storedStrategiesData);
                let strategiesUpdated = false;
                INITIAL_STRATEGIES.forEach(is => {
                    if (!storedStrategies.find(s => s.id === is.id)) {
                        storedStrategies.push(is);
                        strategiesUpdated = true;
                    }
                });
                if (strategiesUpdated) {
                    localStorage.setItem(KEYS.STRATEGIES, JSON.stringify(storedStrategies));
                }
            }
        }
    }
};

const getActiveKey = (baseKey: string) => {
    const source = localStorage.getItem(KEYS.ACTIVE_SOURCE) || 'live';
    return source === 'backup' ? `${baseKey}_Backup` : baseKey;
};

const getActiveStore = () => {
    const source = localStorage.getItem(KEYS.ACTIVE_SOURCE) || 'live';
    return source === 'backup' ? BACKUP_STORE_NAME : STORE_NAME;
};

export const StorageService = {
  getActiveSource: () => localStorage.getItem(KEYS.ACTIVE_SOURCE) || 'live',
  
  setActiveSource: (source: 'live' | 'backup') => {
      localStorage.setItem(KEYS.ACTIVE_SOURCE, source);
      window.location.reload(); // Refresh to ensure all services pick up new keys
  },

  getBackupTimestamp: () => localStorage.getItem(KEYS.BACKUP_TS),

  createBackup: async () => {
      // 1. Backup LocalStorage Keys
      const syms = localStorage.getItem(KEYS.SYMBOLS);
      const strats = localStorage.getItem(KEYS.STRATEGIES);
      const results = localStorage.getItem(KEYS.RESULTS);
      
      if (syms) localStorage.setItem(`${KEYS.SYMBOLS}_Backup`, syms);
      if (strats) localStorage.setItem(`${KEYS.STRATEGIES}_Backup`, strats);
      if (results) localStorage.setItem(`${KEYS.RESULTS}_Backup`, results);
      
      localStorage.setItem(KEYS.BACKUP_TS, new Date().toISOString());

      // 2. Backup IndexedDB Market Data
      const db = await initDB();
      return new Promise<void>((resolve, reject) => {
          const tx = db.transaction([STORE_NAME, BACKUP_STORE_NAME], 'readwrite');
          const sourceStore = tx.objectStore(STORE_NAME);
          const destStore = tx.objectStore(BACKUP_STORE_NAME);
          
          destStore.clear(); // Wipe old backup
          
          const cursorRequest = sourceStore.openCursor();
          cursorRequest.onsuccess = (event) => {
              const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
              if (cursor) {
                  destStore.put(cursor.value, cursor.key);
                  cursor.continue();
              }
          };
          
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },

  getSymbols: (): SymbolData[] => {
    ensureInstalled();
    const data = localStorage.getItem(getActiveKey(KEYS.SYMBOLS));
    return data ? JSON.parse(data) : [];
  },

  saveSymbol: (symbol: SymbolData) => {
    const symbols = StorageService.getSymbols();
    const existingIndex = symbols.findIndex(s => s.id === symbol.id);
    if (existingIndex >= 0) symbols[existingIndex] = symbol;
    else symbols.push(symbol);
    localStorage.setItem(getActiveKey(KEYS.SYMBOLS), JSON.stringify(symbols));
  },

  deleteSymbol: (id: string) => {
    const symbols = StorageService.getSymbols().filter(s => s.id !== id);
    localStorage.setItem(getActiveKey(KEYS.SYMBOLS), JSON.stringify(symbols));
  },

  getStrategies: (): Strategy[] => {
    ensureInstalled();
    const data = localStorage.getItem(getActiveKey(KEYS.STRATEGIES));
    return data ? JSON.parse(data) : [];
  },

  saveStrategy: (strategy: Strategy) => {
    const list = StorageService.getStrategies();
    const idx = list.findIndex(s => s.id === strategy.id);
    if (idx >= 0) list[idx] = strategy;
    else list.push(strategy);
    localStorage.setItem(getActiveKey(KEYS.STRATEGIES), JSON.stringify(list));
  },

  deleteStrategy: (id: string) => {
    const list = StorageService.getStrategies().filter(s => s.id !== id);
    localStorage.setItem(getActiveKey(KEYS.STRATEGIES), JSON.stringify(list));
  },

  saveBacktestResult: (result: BacktestResult) => {
    const list = StorageService.getBacktestResults();
    list.push(result);
    if (list.length > 50) list.shift();
    localStorage.setItem(getActiveKey(KEYS.RESULTS), JSON.stringify(list));
  },

  getBacktestResults: (): BacktestResult[] => {
    const data = localStorage.getItem(getActiveKey(KEYS.RESULTS));
    return data ? JSON.parse(data) : [];
  },

  saveMarketData: async (ticker: string, data: MarketDataPoint[]): Promise<boolean> => {
      try {
          await dbOp<void>(getActiveStore(), 'readwrite', store => store.put(data, ticker));
          return true;
      } catch (e) {
          return false;
      }
  },

  getMarketData: async (ticker: string): Promise<MarketDataPoint[] | null> => {
      try {
          const data = await dbOp<MarketDataPoint[]>(getActiveStore(), 'readonly', store => store.get(ticker));
          return data || null;
      } catch (e) {
          return null;
      }
  },

  clearMarketData: async () => {
      const db = await initDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(getActiveStore(), 'readwrite');
          tx.objectStore(getActiveStore()).clear();
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
      });
  }
};
