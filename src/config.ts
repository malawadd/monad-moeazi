import {NativeModules} from 'react-native';

type NativeConfig = {apiBaseUrl?: string};
const native = (NativeModules.MoeaziConfig ?? {}) as NativeConfig;

export const MOBILE_SCHEMA_VERSION = '2026-09-01';
export const API_BASE_URL = native.apiBaseUrl?.trim() ?? '';
// These empty legacy values keep dormant wallet modules type-compatible during migration.
export const MAGIC_PUBLISHABLE_KEY = '';
export const ARBITRUM_RPC_URL = '';
export const ARBITRUM_CHAIN_ID = 42161;

export const isConfigured = () => Boolean(API_BASE_URL);
