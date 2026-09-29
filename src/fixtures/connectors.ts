import type {FundingOptions, GasReadiness, Purchase} from '../types/connectors';
export const previewOptions: FundingOptions = {schemaVersion: '2026-09-29', commissionBps: 0, currencyCodes: ['USD', 'EUR', 'GBP'], providers: [
  {id: 'preview-alpha', version: '1', name: 'Preview provider A', available: true},
  {id: 'preview-beta', version: '1', name: 'Preview provider B', available: true},
]};
export const previewGas: GasReadiness = {schemaVersion: '2026-09-29', available: false, activated: false, requiresActivation: false, reason: 'Preview only. No sponsorship service is connected.'};
export function previewPurchase(provider: string, amount: string, fiatCurrency: string): Purchase {
  return {schemaVersion: '2026-09-29', purchaseId: `preview-${Date.now()}`, provider: {id: provider, version: '1'}, status: 'received', fiatCurrency, amount, checkoutHosts: [], expiresAt: Date.now() + 300000, updatedAt: Date.now()};
}
