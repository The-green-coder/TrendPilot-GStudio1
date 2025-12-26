
import { Rule, SymbolData, MarketDataProvider, Strategy, RebalanceFrequency, PriceType, Currency } from "./types";

export const AVAILABLE_RULES: Rule[] = [
  {
    id: 'rule_1',
    name: 'Triple Trend Slow Response',
    description: '50% weight to 50d MA, 25% weight to 75d MA, and 25% weight to 100d MA. Allocates to RiskOn if Price > MA, else RiskOff.'
  },
  {
    id: 'rule_2',
    name: 'Triple Trend Quick Response',
    description: '25% weight to 25d MA, 50% weight to 50d MA, and 25% weight to 100d MA. Faster, more aggressive response to trend shifts.'
  },
  {
    id: 'rule_3',
    name: 'Macro-Vol Adaptive Trend (Alpha)',
    description: '50% 200d MA (Macro), 30% 50d MA (Medium), and 20% Volatility Guard. Reduces exposure when volatility expands even if price is high.'
  },
  {
    id: 'rule_4',
    name: 'Multi-Timeframe Sentinel (Alpha+)',
    description: '40% 200d MA, 30% 126d Momentum, 30% 63d Momentum. Includes a Volatility-Clamp that halves exposure if short-term risk spikes.'
  }
];

export const INITIAL_SYMBOLS: SymbolData[] = [
  { id: '1', ticker: 'SPY', name: 'S&P 500 ETF', exchange: 'NYSE', defaultCCY: Currency.USD, isList: false },
  { id: '2', ticker: 'QQQ', name: 'Nasdaq 100 ETF', exchange: 'NASDAQ', defaultCCY: Currency.USD, isList: false },
  { id: '3', ticker: 'TLT', name: '20+ Year Treasury Bond', exchange: 'NASDAQ', defaultCCY: Currency.USD, isList: false },
  { id: '4', ticker: 'GLD', name: 'SPDR Gold Shares', exchange: 'NYSE', defaultCCY: Currency.USD, isList: false },
  { id: '5', ticker: 'INDY', name: 'India NIFTY 50 Index USD', exchange: 'NYSE', defaultCCY: Currency.USD, isList: false },
  { id: '6', ticker: 'SILVERBEES.NS', name: 'SILVERBEES.NS', exchange: 'NSE', defaultCCY: Currency.INR, isList: false },
  { id: '7', ticker: 'GOLDBEES.NS', name: 'GOLDBEES.NS', exchange: 'NSE', defaultCCY: Currency.INR, isList: false },
  { id: '8', ticker: 'LIQUIDBEES.NS', name: 'LIQUIDBEES.NS', exchange: 'NSE', defaultCCY: Currency.INR, isList: false },
  { id: '9', ticker: 'NIFTYBEES.NS', name: 'NIFTYBEES.NS', exchange: 'NSE', defaultCCY: Currency.INR, isList: false },
  { id: '10', ticker: 'EBBETF0430.NS', name: 'EBBETF0430.NS', exchange: 'NSE', defaultCCY: Currency.INR, isList: false },
];

export const INITIAL_STRATEGIES: Strategy[] = [
  {
    id: 'default_tripletrend_qqq',
    name: 'TripleTrend-QQQ (Quick)',
    type: 'Single',
    description: 'Strategy switching between Nasdaq 100 and Treasury Bonds using the Quick Response rule.',
    rebalanceFreq: RebalanceFrequency.WEEKLY,
    pricePreference: PriceType.AVG,
    executionDelay: 1,
    initialCapital: 10000,
    transactionCostPct: 0.1,
    slippagePct: 0.1,
    benchmarkSymbolId: '2', // QQQ
    backtestDuration: '5Y',
    riskOnComponents: [{ symbolId: '2', direction: 'Long', allocation: 100 }],
    riskOffComponents: [{ symbolId: '3', direction: 'Long', allocation: 100 }],
    rules: [{ ruleId: 'rule_2', weight: 100 }],
    subStrategyAllocations: []
  },
  {
    id: 'strat_sentinel_nifty',
    name: 'NIFTY Sentinel Alpha+',
    type: 'Single',
    description: 'High-performance strategy using Multi-Timeframe Sentinel logic. Switches between Nifty and Gold/Bonds with volatility protection.',
    rebalanceFreq: RebalanceFrequency.WEEKLY,
    pricePreference: PriceType.AVG,
    executionDelay: 1,
    initialCapital: 10000,
    transactionCostPct: 0.05,
    slippagePct: 0.05,
    benchmarkSymbolId: '9', // NIFTYBEES
    backtestDuration: '10Y',
    riskOnComponents: [{ symbolId: '9', direction: 'Long', allocation: 100 }],
    riskOffComponents: [
        { symbolId: '7', direction: 'Long', allocation: 50 }, // Gold
        { symbolId: '10', direction: 'Long', allocation: 50 } // Bond
    ],
    rules: [{ ruleId: 'rule_4', weight: 100 }],
    subStrategyAllocations: []
  },
  {
    id: 'strat_alpha_vol_nifty',
    name: 'NIFTY Alpha-Vol (Rule 3)',
    type: 'Single',
    description: 'Uses Macro-Vol Adaptive Trend to navigate NiftyBees. 50% 200d MA, 30% 50d MA, 20% Vol Guard.',
    rebalanceFreq: RebalanceFrequency.WEEKLY,
    pricePreference: PriceType.AVG,
    executionDelay: 1,
    initialCapital: 10000,
    transactionCostPct: 0.1,
    slippagePct: 0.1,
    benchmarkSymbolId: '9', // NIFTYBEES
    backtestDuration: '10Y',
    riskOnComponents: [{ symbolId: '9', direction: 'Long', allocation: 100 }],
    riskOffComponents: [{ symbolId: '10', direction: 'Long', allocation: 100 }], // Bond
    rules: [{ ruleId: 'rule_3', weight: 100 }],
    subStrategyAllocations: []
  },
  {
    id: 'strat_silver_gold',
    name: 'SILVERBEES GOLD',
    type: 'Single',
    description: 'Switching between Silver and Gold based on Triple Trend Fast response.',
    rebalanceFreq: RebalanceFrequency.WEEKLY,
    pricePreference: PriceType.AVG,
    executionDelay: 1,
    initialCapital: 10000,
    transactionCostPct: 0.1,
    slippagePct: 0.1,
    benchmarkSymbolId: '6', // SILVERBEES
    backtestDuration: '5Y',
    riskOnComponents: [{ symbolId: '6', direction: 'Long', allocation: 100 }],
    riskOffComponents: [{ symbolId: '7', direction: 'Long', allocation: 100 }],
    rules: [{ ruleId: 'rule_2', weight: 100 }],
    subStrategyAllocations: []
  },
  {
    id: 'strat_silver_nifty',
    name: 'SILVERBEES NIFTY',
    type: 'Single',
    description: 'Switching between Silver and Nifty based on Triple Trend Fast response.',
    rebalanceFreq: RebalanceFrequency.WEEKLY,
    pricePreference: PriceType.AVG,
    executionDelay: 1,
    initialCapital: 10000,
    transactionCostPct: 0.1,
    slippagePct: 0.1,
    benchmarkSymbolId: '6', // SILVERBEES
    backtestDuration: '5Y',
    riskOnComponents: [{ symbolId: '6', direction: 'Long', allocation: 100 }],
    riskOffComponents: [{ symbolId: '9', direction: 'Long', allocation: 100 }],
    rules: [{ ruleId: 'rule_2', weight: 100 }],
    subStrategyAllocations: []
  },
  {
    id: 'strat_gold_bond',
    name: 'GOLDBEES BOND',
    type: 'Single',
    description: 'Switching between Gold and Bonds based on Triple Trend Slow response.',
    rebalanceFreq: RebalanceFrequency.WEEKLY,
    pricePreference: PriceType.AVG,
    executionDelay: 1,
    initialCapital: 10000,
    transactionCostPct: 0.1,
    slippagePct: 0.1,
    benchmarkSymbolId: '7', // GOLDBEES
    backtestDuration: '5Y',
    riskOnComponents: [{ symbolId: '7', direction: 'Long', allocation: 100 }],
    riskOffComponents: [{ symbolId: '10', direction: 'Long', allocation: 100 }],
    rules: [{ ruleId: 'rule_1', weight: 100 }],
    subStrategyAllocations: []
  },
  {
    id: 'strat_gold_nifty',
    name: 'GOLDBEES NIFTY',
    type: 'Single',
    description: 'Switching between Gold and Nifty based on Triple Trend Slow response.',
    rebalanceFreq: RebalanceFrequency.WEEKLY,
    pricePreference: PriceType.AVG,
    executionDelay: 1,
    initialCapital: 10000,
    transactionCostPct: 0.1,
    slippagePct: 0.1,
    benchmarkSymbolId: '7', // GOLDBEES
    backtestDuration: '5Y',
    riskOnComponents: [{ symbolId: '7', direction: 'Long', allocation: 100 }],
    riskOffComponents: [{ symbolId: '9', direction: 'Long', allocation: 100 }],
    rules: [{ ruleId: 'rule_1', weight: 100 }],
    subStrategyAllocations: []
  },
  {
    id: 'strat_gold_cash',
    name: 'GOLDBEES CASH',
    type: 'Single',
    description: 'Switching between Gold and Liquid Cash based on Triple Trend Slow response.',
    rebalanceFreq: RebalanceFrequency.WEEKLY,
    pricePreference: PriceType.AVG,
    executionDelay: 1,
    initialCapital: 10000,
    transactionCostPct: 0.1,
    slippagePct: 0.1,
    benchmarkSymbolId: '7', // GOLDBEES
    backtestDuration: '5Y',
    riskOnComponents: [{ symbolId: '7', direction: 'Long', allocation: 100 }],
    riskOffComponents: [{ symbolId: '8', direction: 'Long', allocation: 100 }],
    rules: [{ ruleId: 'rule_1', weight: 100 }],
    subStrategyAllocations: []
  }
];

export const MARKET_DATA_PROVIDERS: MarketDataProvider[] = [
  { id: 'yfinance', name: 'yFinance (Free EOD)', type: 'Free' },
  { id: 'eodhd', name: 'EODHD (Official)', type: 'Paid' },
  { id: 'alphavantage', name: 'Alpha Vantage', type: 'Paid' },
  { id: 'quandl', name: 'Quandl', type: 'Paid' }
];
