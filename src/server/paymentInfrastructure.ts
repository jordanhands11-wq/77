import crypto from 'node:crypto';
import { INITIAL_MARKET_SPECS } from '../engine/marketData.ts';

export type PaymentRailType =
  | 'SIMULATED_INTERNAL'
  | 'BANK_TRANSFER_SEPA_ACH'
  | 'CARD_GATEWAY';

export type WalletAsset =
  | 'USDT'
  | 'BTC'
  | 'ETH'
  | 'SOL'
  | 'BNB'
  | 'XRP'
  | 'AVAX'
  | 'LINK'
  | 'ADA';

export const SUPPORTED_WALLET_ASSETS: readonly WalletAsset[] = [
  'USDT',
  ...INITIAL_MARKET_SPECS.map((m) => m.baseAsset as WalletAsset),
];

export interface SimulatedDepositInstruction {
  referenceCode: string;
  providerId: string;
  providerName: string;
  railType: PaymentRailType;
  asset: WalletAsset;
  networkOrChannel: string;
  simulatedDestination: string;
  memoTag: string;
  expiresAt: number;
  disclaimer: string;
  liveProcessingEnabled: false;
}

export interface PublicPaymentProviderInfo {
  id: string;
  name: string;
  railType: PaymentRailType;
  description: string;
  status: 'SIMULATED_SANDBOX_ONLY' | 'DISCONNECTED_PAPER_ONLY';
  configuredOnServer: boolean;
  liveProcessingEnabled: false;
  requiredServerEnvVars: string[];
  supportedAssets: WalletAsset[];
}

export interface PaymentProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly railType: PaymentRailType;
  readonly description: string;
  readonly supportedAssets: WalletAsset[];
  readonly requiredServerEnvVars: string[];
  isConfiguredOnServer(): boolean;
  getPublicInfo(): PublicPaymentProviderInfo;
  createSimulatedDepositInstruction(input: {
    userId: string;
    asset: WalletAsset;
    amount: number;
    referenceCode: string;
  }): SimulatedDepositInstruction;
  validateWithdrawalDestination(input: {
    asset: WalletAsset;
    destination: string;
  }): { valid: boolean; normalizedDestination: string; error?: string };
}

function makeMockHash(seed: string, length = 20): string {
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, length).toUpperCase();
}

export class SimulatedCryptoSandboxAdapter implements PaymentProviderAdapter {
  readonly id = 'sim_sandbox_rail';
  readonly name = '77 Sandbox Crypto & Settlement Rail';
  readonly railType: PaymentRailType = 'SIMULATED_INTERNAL';
  readonly description =
    'Internal paper-trading sandbox rail for simulated USDT settlement cash and simulated crypto asset allocations. Generates non-spendable mock references only (no private keys).';
  readonly supportedAssets: WalletAsset[] = [...SUPPORTED_WALLET_ASSETS];
  readonly requiredServerEnvVars: string[] = [];

  isConfiguredOnServer(): boolean {
    return true;
  }

  getPublicInfo(): PublicPaymentProviderInfo {
    return {
      id: this.id,
      name: this.name,
      railType: this.railType,
      description: this.description,
      status: 'SIMULATED_SANDBOX_ONLY',
      configuredOnServer: true,
      liveProcessingEnabled: false,
      requiredServerEnvVars: [],
      supportedAssets: [...this.supportedAssets],
    };
  }

  createSimulatedDepositInstruction(input: {
    userId: string;
    asset: WalletAsset;
    amount: number;
    referenceCode: string;
  }): SimulatedDepositInstruction {
    const mockDigest = makeMockHash(`${input.userId}:${input.asset}:${input.referenceCode}`, 18);
    const networkOrChannel =
      input.asset === 'USDT'
        ? 'SIMULATED-ERC20/TRC20 SANDBOX'
        : `SIMULATED-${input.asset}-TESTNET-SANDBOX`;
    return {
      referenceCode: input.referenceCode,
      providerId: this.id,
      providerName: this.name,
      railType: this.railType,
      asset: input.asset,
      networkOrChannel,
      simulatedDestination: `SIM-VAULT-${input.asset}-${mockDigest}`,
      memoTag: input.referenceCode,
      expiresAt: Date.now() + 1000 * 60 * 30,
      disclaimer:
        'SIMULATED SANDBOX INSTRUCTION ONLY: Do not send real cryptocurrency or fiat funds. No private keys exist for this simulated reference.',
      liveProcessingEnabled: false,
    };
  }

  validateWithdrawalDestination(input: {
    asset: WalletAsset;
    destination: string;
  }): { valid: boolean; normalizedDestination: string; error?: string } {
    const cleaned = input.destination.replace(/[\u0000-\u001F\u007F<>]/g, '').trim();
    if (cleaned.length < 4 || cleaned.length > 96) {
      return {
        valid: false,
        normalizedDestination: cleaned,
        error: `Please provide a simulated ${input.asset} destination label or mock address (4–96 characters).`,
      };
    }
    return {
      valid: true,
      normalizedDestination: cleaned,
    };
  }
}

export class FutureBankTransferAdapter implements PaymentProviderAdapter {
  readonly id = 'bank_sepa_ach_stub';
  readonly name = 'Bank Transfer Interface (SEPA / ACH / Faster Payments)';
  readonly railType: PaymentRailType = 'BANK_TRANSFER_SEPA_ACH';
  readonly description =
    'Prepared server-side adapter interface for future regulated bank wire/ACH settlement integration. Live banking rails are locked off; operates strictly as simulated reference queue.';
  readonly supportedAssets: WalletAsset[] = ['USDT'];
  readonly requiredServerEnvVars = [
    'BANK_PROVIDER_CLIENT_ID',
    'BANK_PROVIDER_SECRET',
    'BANK_WEBHOOK_SECRET',
  ];

  isConfiguredOnServer(): boolean {
    return this.requiredServerEnvVars.every(
      (key) => typeof process.env[key] === 'string' && process.env[key]!.trim().length > 0
    );
  }

  getPublicInfo(): PublicPaymentProviderInfo {
    return {
      id: this.id,
      name: this.name,
      railType: this.railType,
      description: this.description,
      status: 'DISCONNECTED_PAPER_ONLY',
      configuredOnServer: this.isConfiguredOnServer(),
      liveProcessingEnabled: false,
      requiredServerEnvVars: [...this.requiredServerEnvVars],
      supportedAssets: [...this.supportedAssets],
    };
  }

  createSimulatedDepositInstruction(input: {
    userId: string;
    asset: WalletAsset;
    amount: number;
    referenceCode: string;
  }): SimulatedDepositInstruction {
    const suffix = makeMockHash(`${input.userId}:bank:${input.referenceCode}`, 10);
    return {
      referenceCode: input.referenceCode,
      providerId: this.id,
      providerName: this.name,
      railType: this.railType,
      asset: input.asset,
      networkOrChannel: 'SIMULATED BANK WIRE / ACH SANDBOX',
      simulatedDestination: `SIM-IBAN-GB77TRDE0000${suffix}`,
      memoTag: input.referenceCode,
      expiresAt: Date.now() + 1000 * 60 * 60 * 24,
      disclaimer:
        'SIMULATED BANK INTERFACE ONLY: Real bank transfers and payment webhooks are disabled. Use only for paper wallet workflow testing.',
      liveProcessingEnabled: false,
    };
  }

  validateWithdrawalDestination(input: {
    asset: WalletAsset;
    destination: string;
  }): { valid: boolean; normalizedDestination: string; error?: string } {
    const cleaned = input.destination.replace(/[\u0000-\u001F\u007F<>]/g, '').trim();
    if (cleaned.length < 4 || cleaned.length > 96) {
      return {
        valid: false,
        normalizedDestination: cleaned,
        error: 'Provide a simulated bank account reference (4–96 characters).',
      };
    }
    return { valid: true, normalizedDestination: cleaned };
  }
}

export class FutureCardGatewayAdapter implements PaymentProviderAdapter {
  readonly id = 'card_gateway_stub';
  readonly name = 'Card Payment Gateway Interface (Visa / Mastercard)';
  readonly railType: PaymentRailType = 'CARD_GATEWAY';
  readonly description =
    'Prepared server-side adapter interface for future tokenized card gateway integration. Card charging and PCI token execution are strictly disabled in paper mode.';
  readonly supportedAssets: WalletAsset[] = ['USDT'];
  readonly requiredServerEnvVars = ['CARD_GATEWAY_SECRET_KEY', 'CARD_GATEWAY_WEBHOOK_SECRET'];

  isConfiguredOnServer(): boolean {
    return this.requiredServerEnvVars.every(
      (key) => typeof process.env[key] === 'string' && process.env[key]!.trim().length > 0
    );
  }

  getPublicInfo(): PublicPaymentProviderInfo {
    return {
      id: this.id,
      name: this.name,
      railType: this.railType,
      description: this.description,
      status: 'DISCONNECTED_PAPER_ONLY',
      configuredOnServer: this.isConfiguredOnServer(),
      liveProcessingEnabled: false,
      requiredServerEnvVars: [...this.requiredServerEnvVars],
      supportedAssets: [...this.supportedAssets],
    };
  }

  createSimulatedDepositInstruction(input: {
    userId: string;
    asset: WalletAsset;
    amount: number;
    referenceCode: string;
  }): SimulatedDepositInstruction {
    const sessionCode = makeMockHash(`${input.userId}:card:${input.referenceCode}`, 12);
    return {
      referenceCode: input.referenceCode,
      providerId: this.id,
      providerName: this.name,
      railType: this.railType,
      asset: input.asset,
      networkOrChannel: 'SIMULATED CARD SANDBOX TOKEN',
      simulatedDestination: `SIM-CARD-CHECKOUT-${sessionCode}`,
      memoTag: input.referenceCode,
      expiresAt: Date.now() + 1000 * 60 * 15,
      disclaimer:
        'SIMULATED CARD ADAPTER ONLY: Real card processing is locked off. Never enter real card numbers.',
      liveProcessingEnabled: false,
    };
  }

  validateWithdrawalDestination(input: {
    asset: WalletAsset;
    destination: string;
  }): { valid: boolean; normalizedDestination: string; error?: string } {
    const cleaned = input.destination.replace(/[\u0000-\u001F\u007F<>]/g, '').trim();
    if (cleaned.length < 4 || cleaned.length > 96) {
      return {
        valid: false,
        normalizedDestination: cleaned,
        error: 'Provide a simulated payout card/account label (4–96 characters).',
      };
    }
    return { valid: true, normalizedDestination: cleaned };
  }
}

export class ServerPaymentGatewayRegistry {
  private readonly adapters = new Map<string, PaymentProviderAdapter>();

  constructor() {
    this.register(new SimulatedCryptoSandboxAdapter());
    this.register(new FutureBankTransferAdapter());
    this.register(new FutureCardGatewayAdapter());
  }

  private register(adapter: PaymentProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  getAdapter(providerId: string): PaymentProviderAdapter | null {
    return this.adapters.get(providerId) ?? null;
  }

  listPublicProviders(): PublicPaymentProviderInfo[] {
    return Array.from(this.adapters.values()).map((a) => a.getPublicInfo());
  }

  assertLivePaymentsBlocked(): {
    liveProcessingAuthorized: false;
    mode: 'SIMULATED_PAPER_ONLY';
    reason: string;
  } {
    return {
      liveProcessingAuthorized: false,
      mode: 'SIMULATED_PAPER_ONLY',
      reason:
        'Real-money card, bank, and on-chain payment execution is disabled. All wallet activity operates in simulated paper mode only.',
    };
  }
}

export const paymentRegistry = new ServerPaymentGatewayRegistry();

export function isSupportedWalletAsset(asset: string): asset is WalletAsset {
  return (SUPPORTED_WALLET_ASSETS as readonly string[]).includes(asset);
}
