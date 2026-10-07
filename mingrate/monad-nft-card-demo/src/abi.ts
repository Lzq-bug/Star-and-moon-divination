export const CARD_NFT_ABI = [
  "function mintCard(string cardName, string rarity, string tagline) payable returns (uint256 tokenId)",
  "function getCard(uint256 tokenId) view returns ((string cardName, string rarity, string tagline))",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function mintPrice() view returns (uint256)",
  "function maxMintsPerWallet() view returns (uint256)",
  "function mintedBy(address minter) view returns (uint256)",
  "function owner() view returns (address)",
  "error IncorrectMintPayment(uint256 required, uint256 received)",
  "error WalletMintLimitReached(uint256 limit)",
  "event CardMinted(address indexed owner, uint256 indexed tokenId, string cardName, string rarity, string tagline)",
] as const;
