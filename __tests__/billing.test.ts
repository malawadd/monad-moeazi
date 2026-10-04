import {UnconfiguredBillingAdapter} from '../src/services/billing/UnconfiguredBillingAdapter';

test('unconfigured billing lists packs but cannot grant credits', async () => {
  const adapter = new UnconfiguredBillingAdapter();
  const products = await adapter.listProducts();
  expect(products.map(product => product.name)).toEqual(['Starter', 'Standard', 'Power']);
  await expect(adapter.purchase(products[0].id)).resolves.toMatchObject({ok: false, code: 'BILLING_NOT_CONFIGURED'});
});
