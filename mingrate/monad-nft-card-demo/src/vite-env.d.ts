/// <reference types="vite/client" />

interface EthereumRequestArguments {
  method: string;
  params?: unknown[] | Record<string, unknown>;
}

interface EthereumProvider {
  request(args: EthereumRequestArguments): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

interface Window {
  ethereum?: EthereumProvider;
}
