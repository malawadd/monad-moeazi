import {BillingAdapter} from './BillingAdapter';
import {CreditPack, PurchaseResult} from '../../types/mobile';

export const creditCatalog: CreditPack[] = [
  {id: 'starter', catalogVersion: 'catalog-2026-09-preview', name: 'Starter', priceLabel: 'Price to be announced', credits: 100, usageLabel: 'A simple way to try regular AI checks.'},
  {id: 'standard', catalogVersion: 'catalog-2026-09-preview', name: 'Standard', priceLabel: 'Price to be announced', credits: 500, usageLabel: 'For ongoing market checks and decisions.', featured: true},
  {id: 'power', catalogVersion: 'catalog-2026-09-preview', name: 'Power', priceLabel: 'Price to be announced', credits: 1500, usageLabel: 'For more frequent, broader AI monitoring.'},
];

const notConfigured = (): PurchaseResult => ({ok: false, code: 'BILLING_NOT_CONFIGURED', message: 'Purchases are not enabled in this build.'});

export class UnconfiguredBillingAdapter implements BillingAdapter {
  async listProducts() { return creditCatalog; }
  async purchase(_productId: string) { return notConfigured(); }
  async restore() { return [notConfigured()]; }
}

export const billingAdapter = new UnconfiguredBillingAdapter();
