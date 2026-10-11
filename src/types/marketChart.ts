export type ChartRange = '1H' | '6H' | '1D' | '1W';

export type ChartDisplay = 'candles' | 'line';
export type ChartOverlay = {
  id: string;
  label: string;
  kind: 'entry' | 'liquidation' | 'take_profit' | 'stop_loss' | 'pending' | 'fill_entry' | 'fill_exit';
  price: number | string;
  source?: 'manual' | 'autonomous';
  status?: 'verified' | 'estimate' | 'pending';
  color?: string;
};

export type ChartLivePnl = {
  id: string;
  source: 'manual' | 'autonomous';
  /** Signed AUSD micro-units, calculated from a finalized position and live mark. */
  amountUnits: string;
  status: 'estimate';
};

export type ChartSettings = {
  display: ChartDisplay;
  defaultRange: ChartRange;
  showMarkPrice: boolean;
  showVolume: boolean;
  showOrderBook: boolean;
  showTradeMarkers: boolean;
  showManualPositions: boolean;
  showAutonomousPositions: boolean;
  showPnl: boolean;
  showRiskLevels: boolean;
};

export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  display: 'candles', defaultRange: '1D', showMarkPrice: true, showVolume: true,
  showOrderBook: true, showTradeMarkers: true, showManualPositions: true,
  showAutonomousPositions: true, showPnl: true, showRiskLevels: true,
};
