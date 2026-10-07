export type NetworkKey = "testnet" | "mainnet";

export interface NetworkConfig {
  key: NetworkKey;
  name: string;
  chainId: number;
  chainIdHex: `0x${string}`;
  rpcUrl: string;
  explorerUrl: string;
  currencySymbol: string;
}

export const NETWORKS: Record<NetworkKey, NetworkConfig> = {
  testnet: {
    key: "testnet",
    name: "Monad Testnet",
    chainId: 10143,
    chainIdHex: "0x279f",
    rpcUrl: "https://testnet-rpc.monad.xyz",
    explorerUrl: "https://testnet.monadvision.com",
    currencySymbol: "MON",
  },
  mainnet: {
    key: "mainnet",
    name: "Monad Mainnet",
    chainId: 143,
    chainIdHex: "0x8f",
    rpcUrl: "https://rpc.monad.xyz",
    explorerUrl: "https://monadvision.com",
    currencySymbol: "MON",
  },
};

const configuredNetwork = (import.meta.env.VITE_NETWORK || "testnet") as NetworkKey;

export const NETWORK = NETWORKS[configuredNetwork] || NETWORKS.testnet;
export const CONTRACT_ADDRESS = (import.meta.env.VITE_CONTRACT_ADDRESS || "").trim();
