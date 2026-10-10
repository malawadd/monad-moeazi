import {uniqueMarketTradeActivity, type MarketTradeActivity} from '../src/types/marketDirectory';

const event = (id: string, title: string): MarketTradeActivity => ({id, title, summary: `${title} summary`, status: 'finalized', occurredAt: 1});

describe('uniqueMarketTradeActivity', () => {
  it('keeps the first event for a duplicate activity ID and preserves distinct events', () => {
    const result = uniqueMarketTradeActivity([event('order:1', 'First'), event('order:1', 'Duplicate'), event('order:2', 'Second')]);
    expect(result.map(item => item.title)).toEqual(['First', 'Second']);
  });

  it('drops events without an ID so rendered timeline keys remain valid', () => {
    const result = uniqueMarketTradeActivity([event('', 'Missing ID'), event('order:1', 'Valid')]);
    expect(result.map(item => item.id)).toEqual(['order:1']);
  });
});
