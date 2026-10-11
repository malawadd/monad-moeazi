import {apiRequest} from './apiClient';
import type {
  MarketDetailResponse,
  MarketSnapshotResponse,
  MarketCandlesResponse,
  MarketDirectoryResponse,
  MarketTradesResponse,
  MarketVenueId,
} from '../types/marketDirectory';

export type MarketChartWindow = {resolutionSeconds: number; from: number; to: number};

const marketPath = (venueId: MarketVenueId, marketId: string) =>
  `/api/mobile/markets/${encodeURIComponent(venueId)}/${encodeURIComponent(marketId)}`;

export const marketDirectoryApi = {
  list: () => apiRequest<MarketDirectoryResponse>('/api/mobile/markets'),
  resolve: (query: string) => apiRequest<{markets: MarketDirectoryResponse['markets']; index?: {status: string; scannedThrough: number; latestBlock: number}}>(
    '/api/mobile/markets/resolve', {method: 'POST', body: JSON.stringify({query})}),
  snapshot: (venueId: MarketVenueId, marketId: string) => apiRequest<MarketSnapshotResponse>(
    `${marketPath(venueId, marketId)}?includeCandles=false`),
  candles: (venueId: MarketVenueId, marketId: string, window: MarketChartWindow) =>
    apiRequest<MarketCandlesResponse>(`${marketPath(venueId, marketId)}/candles?${new URLSearchParams({
      resolution: String(window.resolutionSeconds), from: String(window.from), to: String(window.to),
    })}`),
  detail: (venueId: MarketVenueId, marketId: string, window: MarketChartWindow) =>
    apiRequest<MarketDetailResponse>(`${marketPath(venueId, marketId)}?${new URLSearchParams({
      resolution: String(window.resolutionSeconds), from: String(window.from), to: String(window.to),
    })}`),
  trades: (venueId?: MarketVenueId, marketId?: string, runId?: string) => apiRequest<MarketTradesResponse>(
    `/api/mobile/trades?${new URLSearchParams({...(venueId ? {venueId} : {}), ...(marketId ? {marketId} : {}), ...(runId ? {runId} : {})})}`),
};
