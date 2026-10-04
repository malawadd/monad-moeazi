import {verifiedWalletReadiness, type AutopilotWalletReadiness} from '../src/services/autopilotWalletReadiness';

const owner = '0x1111111111111111111111111111111111111111';
const blockHash = `0x${'a'.repeat(64)}`;

function read(): AutopilotWalletReadiness {
  return {schemaVersion: 'wallet-execution-readiness-v1', chainId: 42161,
    owner, expectedImplementation: '0x2222222222222222222222222222222222222222',
    finalized: {blockNumber: '123', blockHash, usdcUnits: '1095927', ethWei: '244000000000000',
      delegation: {kind: 'other_delegation', target: '0x3333333333333333333333333333333333333333'}},
    latest: {blockNumber: '124', blockHash, usdcUnits: '1095927', ethWei: '244000000000000',
      delegation: {kind: 'other_delegation', target: '0x3333333333333333333333333333333333333333'}},
    executionDelegateReady: false};
}

it('accepts finalized USDC for the signed-in owner without treating Particle delegation as Kernel authority', () => {
  expect(verifiedWalletReadiness(read(), owner).finalized.usdcUnits).toBe('1095927');
  expect(verifiedWalletReadiness(read(), owner).finalized.ethWei).toBe('244000000000000');
});

it('rejects a read for another account or a false execution-ready flag', () => {
  expect(() => verifiedWalletReadiness(read(), '0x4444444444444444444444444444444444444444')).toThrow();
  const inconsistent = read();
  inconsistent.executionDelegateReady = true;
  expect(() => verifiedWalletReadiness(inconsistent, owner)).toThrow();
});
