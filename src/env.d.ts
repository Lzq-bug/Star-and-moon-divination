/// <reference types="vite/client" />

// Vite 环境变量类型（真实链上铸造所需）
interface ImportMetaEnv {
  /** 已部署的 MonadCardNFT 合约地址；未配置时链上铸造优雅降级 */
  readonly VITE_CONTRACT_ADDRESS?: string;
  /** 目标网络：testnet（默认）| mainnet */
  readonly VITE_NETWORK?: string;
  /** DeepSeek API Key（可选，作为默认 key 预填，写入 .env.local） */
  readonly VITE_DEEPSEEK_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// MetaMask / EIP-1193 provider（浏览器注入）
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
