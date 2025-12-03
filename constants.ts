import { Rule, SymbolData, MarketDataProvider, Strategy, RebalanceFrequency, PriceType, Currency } from "./types";

export const AVAILABLE_RULES: Rule[] = [
  {
    id: 'rule_1',
    name: 'TripleTrend_QuickerResponse1',
    description: 'Allocates between Risk-On and Risk-Off assets based on Risk-On asset\'s position relative to 25d, 50d, and 100d Moving Averages.'
  },
  {
    id: 'rule_2',
    name: 'TripleTrend_QuickerResponse2',
    description: 'Allocates between Risk-On and Risk-Off assets based on Risk-On asset\'s position relative to 20d, 50d, and 100d Moving Averages with weighted importance.'
  }
];

export const INITIAL_SYMBOLS: SymbolData[] = [
  { id: '1', ticker: 'SPY', name: 'S&P 500 ETF', exchange: 'NYSE', defaultCCY: Currency.USD, isList: false },
  { id: '2', ticker: 'QQQ', name: 'Nasdaq 100 ETF', exchange: 'NASDAQ', defaultCCY: Currency.USD, isList: false },
  { id: '3', ticker: 'TLT', name: '20+ Year Treasury Bond', exchange: 'NASDAQ', defaultCCY: Currency.USD, isList: false },
  { id: '4', ticker: 'GLD', name: 'SPDR Gold Shares', exchange: 'NYSE', defaultCCY: Currency.USD, isList: false },
  { id: '5', ticker: 'INDY', name: 'India NIFTY 50 Index USD', exchange: 'NYSE', defaultCCY: Currency.USD, isList: false },
];

export const INITIAL_STRATEGIES: Strategy[] = [
  {
    id: 'default_tripletrend_qqq',
    name: 'TripleTrend-QQQ',
    type: 'Single',
    description: 'Default trend following strategy switching between Nasdaq 100 and Treasury Bonds.',
    rebalanceFreq: RebalanceFrequency.WEEKLY,
    pricePreference: PriceType.AVG,
    executionDelay: 1,
    initialCapital: 10000,
    transactionCostPct: 0.1,
    slippagePct: 0.1,
    benchmarkSymbolId: '2', // QQQ
    backtestDuration: '5Y',
    riskOnComponents: [
      { symbolId: '2', direction: 'Long', allocation: 100 } // QQQ
    ],
    riskOffComponents: [
      { symbolId: '3', direction: 'Long', allocation: 100 } // TLT
    ],
    rules: [
      { ruleId: 'rule_2', weight: 100 } // Changed to Rule 2 as requested
    ],
    subStrategyAllocations: []
  }
];

export const MARKET_DATA_PROVIDERS: MarketDataProvider[] = [
  { id: 'yfinance', name: 'yFinance (Free EOD)', type: 'Free' },
  { id: 'alphavantage', name: 'Alpha Vantage', type: 'Paid' },
  { id: 'quandl', name: 'Quandl', type: 'Paid' }
];