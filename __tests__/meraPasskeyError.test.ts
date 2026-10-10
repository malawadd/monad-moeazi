import {describePasskeyError} from '../src/services/wallet/meraPasskeyError';

const failure = (providerCode: string, message: string) => ({
  code: 'PASSKEY_OPERATION_FAILED',
  cause: {error: providerCode, message},
});

describe('Mera passkey error details', () => {
  it('shows the native RP validation reason', () => {
    expect(describePasskeyError(failure('BadConfiguration', 'RP ID cannot be validated.')).message)
      .toContain('RP ID cannot be validated');
  });

  it('does not blame association when the user cancels', () => {
    expect(describePasskeyError(failure('UserCancelled', 'Cancelled')).message)
      .toContain('cancelled');
    expect(describePasskeyError(failure('UserCancelled', 'Cancelled')).message)
      .not.toContain('association');
  });

  it('keeps missing-credential guidance neutral about the selected provider', () => {
    const message = describePasskeyError(failure('NoCredentials', 'No credentials available')).message;
    expect(message).toContain('No passkey was found');
    expect(message).toContain('selected provider');
    expect(message).not.toContain('Google');
  });

  it('keeps provider failure details for other native errors', () => {
    expect(describePasskeyError(failure('RequestFailed', 'Credential Manager could not complete setup')).message)
      .toContain('Credential Manager could not complete setup');
  });
});
