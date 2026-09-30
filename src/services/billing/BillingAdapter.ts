import {CreditPack, PurchaseResult} from '../../types/mobile';

export interface BillingAdapter {
  listProducts(): Promise<CreditPack[]>;
  purchase(productId: string): Promise<PurchaseResult>;
  restore(): Promise<PurchaseResult[]>;
}
