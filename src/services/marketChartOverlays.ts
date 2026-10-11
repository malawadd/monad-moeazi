import type {ChartOverlay} from '../types/marketChart';
import type {ManualPerplOrder, ManualPerplPosition} from '../types/manualPerpl';
import type {PerplOrder, PerplPosition} from '../types/perpl';

const positive = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export function buildPerplPositionOverlays(input: {
  marketId: string;
  manualPosition: ManualPerplPosition | undefined;
  manualOrders: ManualPerplOrder[];
  autonomousPosition: PerplPosition | null;
  autonomousOrders: PerplOrder[];
  showManual: boolean;
  showAutonomous: boolean;
}): ChartOverlay[] {
  const result: ChartOverlay[] = [];
  if (input.showManual && input.manualPosition) {
    const position = input.manualPosition as Record<string, unknown>;
    const verified = position.verified === true && position.stateSource === 'finalized_perpl_exchange'
      && positive(position.finalizedBlockNumber) !== null;
    if (verified) {
      add(result, 'manual:entry', 'Manual entry', 'entry', position.entryPrice, 'manual', 'verified');
      if ((position.liquidationEstimate as Record<string, unknown> | undefined)?.status === 'estimated') {
        add(result, 'manual:liquidation', 'Manual liquidation · estimate', 'liquidation',
          position.liquidationPriceUnits ?? position.liquidationPrice, 'manual', 'estimate');
      }
    }
    for (const order of input.manualOrders) {
      if (String(order.marketId) !== input.marketId || !isFinalizedOpenOrder(order)) continue;
      add(result, `manual:order:${order.orderId}`, 'Manual pending order', 'pending',
        order.priceUnits ?? order.price, 'manual', 'pending');
    }
  }
  if (input.showAutonomous && input.autonomousPosition && String(input.autonomousPosition.marketId) === input.marketId) {
    const position = input.autonomousPosition as Record<string, unknown>;
    const verified = position.verified === true && position.stateSource === 'finalized_perpl_exchange'
      && positive(position.finalizedBlockNumber) !== null && Boolean(positive(position.entryPrice));
    if (verified) {
      add(result, 'autonomous:entry', 'Autonomous entry', 'entry', position.entryPrice, 'autonomous', 'verified');
      if ((position.liquidationEstimate as Record<string, unknown> | undefined)?.status === 'estimated') {
        add(result, 'autonomous:liquidation', 'Autonomous liquidation · estimate', 'liquidation',
          position.liquidationPriceUnits ?? position.liquidationPrice, 'autonomous', 'estimate');
      }
    }
  }
  for (const order of input.autonomousOrders) {
    if (Number(order.marketId ?? order.mkt) !== Number(input.marketId) || !isFinalizedOpenOrder(order)) continue;
    add(result, `autonomous:order:${order.orderId}`, 'Autonomous pending order', 'pending',
      order.priceUnits ?? order.price, 'autonomous', 'pending');
  }
  return result;
}

function add(rows: ChartOverlay[], id: string, label: string, kind: ChartOverlay['kind'], value: unknown,
  source: NonNullable<ChartOverlay['source']>, status: NonNullable<ChartOverlay['status']>) {
  const price = positive(value);
  if (price !== null) rows.push({id, label, kind, price, source, status});
}
function isFinalizedOpenOrder(order: Record<string, unknown>) {
  return String(order.status ?? '').toLowerCase() === 'open' && order.verified === true
    && order.stateSource === 'finalized_perpl_exchange' && positive(order.finalizedBlockNumber) !== null;
}
