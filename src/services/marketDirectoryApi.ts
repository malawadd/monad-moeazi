import {apiRequest} from './apiClient';
import type {
  MarketDetailResponse,
  MarketDirectoryResponse,
  MarketTradesResponse,
  MarketVenueId,
} from '../types/marketDirectory';

export type MarketChartWindow = {resolutionSeconds: number; from: number; to: number};

export const marketDirectoryApi = {
  list: () => apiRequest<MarketDirectoryResponse>('/api/mobile/markets'),
  detail: (venueId: MarketVenueId, marketId: string, window: MarketChartWindow) =>
    apiRequest<MarketDetailResponse>(`/api/mobile/markets/${encodeURIComponent(venueId)}/${encodeURIComponent(marketId)}?${new URLSearchParams({
      resolution: String(window.resolutionSeconds), from: String(window.from), to: String(window.to),
    })}`),
  trades: (venueId?: MarketVenueId, marketId?: string, runId?: string) => apiRequest<MarketTradesResponse>(
    `/api/mobile/trades?${new URLSearchParams({...(venueId ? {venueId} : {}), ...(marketId ? {marketId} : {}), ...(runId ? {runId} : {})})}`),
};
