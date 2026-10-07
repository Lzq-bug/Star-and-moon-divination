import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BrowserProvider,
  Contract,
  Interface,
  formatEther,
  isAddress,
  type ContractTransactionReceipt,
} from "ethers";
import { CARD_NFT_ABI } from "./abi";
import { CONTRACT_ADDRESS, NETWORK } from "./config";

type Tab = "mint" | "collection";

type CardItem = {
  tokenId: string;
  cardName: string;
  rarity: string;
  tagline: string;
  image: string;
};

const RARITIES = ["Common", "Rare", "Epic", "Legendary"];
const DEFAULT_MINT_PRICE = 1_450_000_000_000_000n;
const DEFAULT_MINT_LIMIT = 1000n;

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      code?: number;
      shortMessage?: string;
      reason?: string;
      message?: string;
      info?: { error?: { message?: string } };
    };

    if (candidate.code === 4001) return "你取消了钱包操作。";

    const message =
      candidate.shortMessage ||
      candidate.reason ||
      candidate.info?.error?.message ||
      candidate.message ||
      "发生未知错误";

    if (message.includes("WalletMintLimitReached")) return "该钱包已达到累计铸造上限。";
    if (message.includes("IncorrectMintPayment")) return "发送的铸造费用与合约价格不一致。";
    if (message.includes("insufficient funds")) return "钱包中的测试 MON 不足以支付铸造费和 Gas。";
    return message;
  }
  return String(error);
}

function decodeMetadata(tokenUri: string): { image?: string } {
  const marker = "data:application/json;base64,";
  if (!tokenUri.startsWith(marker)) return {};

  const bytes = Uint8Array.from(atob(tokenUri.slice(marker.length)), (char) =>
    char.charCodeAt(0),
  );
  return JSON.parse(new TextDecoder().decode(bytes)) as { image?: string };
}

async function ensureMonadNetwork(): Promise<void> {
  if (!window.ethereum) throw new Error("未检测到 MetaMask，请先安装小狐狸钱包。");

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: NETWORK.chainIdHex }],
    });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 4902) throw error;

    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: NETWORK.chainIdHex,
          chainName: NETWORK.name,
          nativeCurrency: {
            name: NETWORK.currencySymbol,
            symbol: NETWORK.currencySymbol,
            decimals: 18,
          },
          rpcUrls: [NETWORK.rpcUrl],
          blockExplorerUrls: [NETWORK.explorerUrl],
        },
      ],
    });
  }
}

function extractMintedTokenId(receipt: ContractTransactionReceipt): string | null {
  const contractInterface = new Interface(CARD_NFT_ABI);

  for (const log of receipt.logs) {
    try {
      const parsed = contractInterface.parseLog(log);
      if (parsed?.name === "CardMinted") return parsed.args.tokenId.toString();
    } catch {
      // Ignore logs emitted by other contracts.
    }
  }
  return null;
}

export default function App() {
  const [tab, setTab] = useState<Tab>("mint");
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [cardName, setCardName] = useState("Oracle Genesis");
  const [rarity, setRarity] = useState("Rare");
  const [tagline, setTagline] = useState("命运在 Monad 上留下第一句回声。");
  const [status, setStatus] = useState("等待连接钱包");
  const [busy, setBusy] = useState(false);
  const [cards, setCards] = useState<CardItem[]>([]);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [lastTxHash, setLastTxHash] = useState("");
  const [lastTokenId, setLastTokenId] = useState("");
  const [mintPrice, setMintPrice] = useState(DEFAULT_MINT_PRICE);
  const [mintLimit, setMintLimit] = useState(DEFAULT_MINT_LIMIT);
  const [walletMinted, setWalletMinted] = useState(0n);

  const contractReady = isAddress(CONTRACT_ADDRESS);
  const onCorrectNetwork = chainId === NETWORK.chainId;
  const remainingMints = mintLimit > walletMinted ? mintLimit - walletMinted : 0n;

  const rarityClass = useMemo(
    () => `preview-card rarity-${rarity.toLowerCase()}`,
    [rarity],
  );

  const loadMintSettings = useCallback(async (walletAddress?: string) => {
    if (!window.ethereum || !contractReady) return;

    try {
      const provider = new BrowserProvider(window.ethereum as any);
      const contract = new Contract(CONTRACT_ADDRESS, CARD_NFT_ABI, provider);
      const [price, limit] = await Promise.all([
        contract.mintPrice() as Promise<bigint>,
        contract.maxMintsPerWallet() as Promise<bigint>,
      ]);

      setMintPrice(price);
      setMintLimit(limit);

      if (walletAddress) {
        setWalletMinted(await contract.mintedBy(walletAddress));
      } else {
        setWalletMinted(0n);
      }
    } catch {
      // Keep configured display defaults until a deployed contract is available.
    }
  }, [contractReady]);

  const connectWallet = useCallback(async () => {
    try {
      if (!window.ethereum) throw new Error("未检测到 MetaMask，请先安装浏览器扩展。");
      setBusy(true);
      setStatus("正在请求钱包授权…");

      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];

      await ensureMonadNetwork();
      const currentChainId = Number(
        (await window.ethereum.request({ method: "eth_chainId" })) as string,
      );
      const currentAccount = accounts[0] || "";

      setAccount(currentAccount);
      setChainId(currentChainId);
      await loadMintSettings(currentAccount);
      setStatus(`已连接 ${NETWORK.name}`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [loadMintSettings]);

  const addNftToMetaMask = useCallback(async (tokenId: string) => {
    if (!window.ethereum || !contractReady) return false;

    try {
      return Boolean(
        await window.ethereum.request({
          method: "wallet_watchAsset",
          params: {
            type: "ERC721",
            options: {
              address: CONTRACT_ADDRESS,
              tokenId,
            },
          },
        }),
      );
    } catch {
      return false;
    }
  }, [contractReady]);

  const loadCollection = useCallback(async () => {
    if (!window.ethereum || !account || !contractReady) return;

    try {
      setCollectionLoading(true);
      setStatus("正在读取链上收藏…");
      await ensureMonadNetwork();

      const provider = new BrowserProvider(window.ethereum as any);
      const contract = new Contract(CONTRACT_ADDRESS, CARD_NFT_ABI, provider);
      const [balance, minted] = await Promise.all([
        contract.balanceOf(account) as Promise<bigint>,
        contract.mintedBy(account) as Promise<bigint>,
      ]);
      setWalletMinted(minted);

      const balanceNumber = Number(balance);
      const visibleCount = Math.min(balanceNumber, 50);
      const ownedCards: CardItem[] = [];

      for (let index = 0; index < visibleCount; index += 1) {
        const tokenId = await contract.tokenOfOwnerByIndex(account, index);
        const card = await contract.getCard(tokenId);
        const tokenUri = await contract.tokenURI(tokenId);
        const metadata = decodeMetadata(tokenUri);

        ownedCards.push({
          tokenId: tokenId.toString(),
          cardName: card.cardName ?? card[0],
          rarity: card.rarity ?? card[1],
          tagline: card.tagline ?? card[2],
          image: metadata.image || "",
        });
      }

      setCards(ownedCards.reverse());
      setStatus(
        balanceNumber > 50
          ? `已读取前 50 张，共持有 ${balanceNumber} 张 NFT`
          : `共找到 ${balanceNumber} 张 NFT`,
      );
    } catch (error) {
      setStatus(`读取收藏失败：${errorMessage(error)}`);
    } finally {
      setCollectionLoading(false);
    }
  }, [account, contractReady]);

  const mint = async () => {
    if (!window.ethereum) {
      setStatus("请先安装并连接 MetaMask。");
      return;
    }
    if (!account) {
      await connectWallet();
      return;
    }
    if (!contractReady) {
      setStatus("尚未配置 VITE_CONTRACT_ADDRESS，请先部署合约。");
      return;
    }
    if (!cardName.trim() || !tagline.trim()) {
      setStatus("卡牌名称和一句话介绍不能为空。");
      return;
    }
    if (remainingMints === 0n) {
      setStatus("该钱包已达到累计铸造上限。");
      return;
    }

    try {
      setBusy(true);
      setLastTxHash("");
      setLastTokenId("");
      setStatus(`请在 MetaMask 中确认 ${formatEther(mintPrice)} MON + Gas…`);
      await ensureMonadNetwork();

      const provider = new BrowserProvider(window.ethereum as any);
      const signer = await provider.getSigner();
      const contract = new Contract(CONTRACT_ADDRESS, CARD_NFT_ABI, signer);
      const transaction = await contract.mintCard(
        cardName.trim(),
        rarity,
        tagline.trim(),
        { value: mintPrice },
      );

      setLastTxHash(transaction.hash);
      setStatus("交易已提交，等待 Monad 确认…");
      const receipt = (await transaction.wait()) as ContractTransactionReceipt;
      const tokenId = extractMintedTokenId(receipt);

      if (tokenId) {
        setLastTokenId(tokenId);
        setWalletMinted((count) => count + 1n);
        const added = await addNftToMetaMask(tokenId);
        setStatus(
          added
            ? `NFT #${tokenId} 铸造成功，并已请求添加到 MetaMask。`
            : `NFT #${tokenId} 铸造成功。可在收藏页查看；MetaMask 也可手动导入。`,
        );
      } else {
        setStatus("NFT 铸造成功，但没有从事件中解析出 Token ID。");
      }

      await loadCollection();
    } catch (error) {
      setStatus(`铸造失败：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!window.ethereum) return;

    const refreshWallet = async () => {
      const accounts = (await window.ethereum!.request({
        method: "eth_accounts",
      })) as string[];
      const currentChainId = Number(
        (await window.ethereum!.request({ method: "eth_chainId" })) as string,
      );
      const currentAccount = accounts[0] || "";
      setAccount(currentAccount);
      setChainId(currentChainId);
      await loadMintSettings(currentAccount);
    };

    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      const currentAccount = accounts[0] || "";
      setAccount(currentAccount);
      setCards([]);
      void loadMintSettings(currentAccount);
    };
    const onChainChanged = (...args: unknown[]) => {
      setChainId(Number(args[0] as string));
      setCards([]);
      void (async () => {
        const accounts = (await window.ethereum!.request({
          method: "eth_accounts",
        })) as string[];
        await loadMintSettings(accounts[0] || "");
      })();
    };

    void refreshWallet();
    window.ethereum.on?.("accountsChanged", onAccountsChanged);
    window.ethereum.on?.("chainChanged", onChainChanged);

    return () => {
      window.ethereum?.removeListener?.("accountsChanged", onAccountsChanged);
      window.ethereum?.removeListener?.("chainChanged", onChainChanged);
    };
  }, [loadMintSettings]);

  useEffect(() => {
    if (tab === "collection" && account && onCorrectNetwork && contractReady) {
      void loadCollection();
    }
  }, [tab, account, onCorrectNetwork, contractReady, loadCollection]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">MONAD · ON-CHAIN ORACLE NFT</div>
          <h1>oracle card</h1>
        </div>
        <button className="wallet-button" onClick={connectWallet} disabled={busy}>
          <span className={account ? "wallet-dot connected" : "wallet-dot"} />
          {account ? shortAddress(account) : "连接 MetaMask"}
        </button>
      </header>

      <section className="network-strip">
        <span>{NETWORK.name}</span>
        <span>Chain ID {NETWORK.chainId}</span>
        <span>价格 {formatEther(mintPrice)} MON</span>
        <span>钱包额度 {walletMinted.toString()}/{mintLimit.toString()}</span>
        <span className={onCorrectNetwork ? "network-ok" : "network-warning"}>
          {onCorrectNetwork ? "网络正确" : "需要切换网络"}
        </span>
        {!contractReady && <span className="network-warning">合约地址未配置</span>}
      </section>

      <nav className="tabs" aria-label="NFT 功能导航">
        <button className={tab === "mint" ? "active" : ""} onClick={() => setTab("mint")}>
          生成与铸造
        </button>
        <button
          className={tab === "collection" ? "active" : ""}
          onClick={() => setTab("collection")}
        >
          我的收藏
        </button>
      </nav>

      {tab === "mint" ? (
        <section className="mint-layout">
          <div className="panel form-panel">
            <div className="section-heading">
              <span>01</span>
              <div>
                <h2>写下这张预言卡</h2>
                <p>三项内容将成为 NFT 的全链上元数据。</p>
              </div>
            </div>

            <div className="mint-facts">
              <div><strong>{formatEther(mintPrice)} MON</strong><span>单张铸造价格</span></div>
              <div><strong>{remainingMints.toString()}</strong><span>当前钱包剩余额度</span></div>
            </div>

            <label>
              卡牌名称
              <input
                value={cardName}
                onChange={(event) => setCardName(event.target.value)}
                maxLength={24}
                placeholder="例如：Oracle Genesis"
              />
            </label>

            <label>
              稀有度
              <select value={rarity} onChange={(event) => setRarity(event.target.value)}>
                {RARITIES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            <label>
              一句话介绍
              <textarea
                value={tagline}
                onChange={(event) => setTagline(event.target.value)}
                maxLength={60}
                rows={4}
                placeholder="用一句话讲完它的预言"
              />
              <span className="counter">{tagline.length}/60</span>
            </label>

            <button className="mint-button" onClick={mint} disabled={busy || remainingMints === 0n}>
              {busy ? "链上锻造中…" : `支付 ${formatEther(mintPrice)} MON 并铸造`}
            </button>

            <div className="status-box" aria-live="polite">
              <span className="status-pulse" />
              <div>
                <strong>状态</strong>
                <p>{status}</p>
                {lastTxHash && (
                  <a
                    href={`${NETWORK.explorerUrl}/tx/${lastTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看交易 ↗
                  </a>
                )}
                {lastTokenId && (
                  <button
                    className="text-button"
                    onClick={() => void addNftToMetaMask(lastTokenId)}
                  >
                    再次请求添加到 MetaMask
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="preview-column">
            <div className="section-heading compact">
              <span>02</span>
              <div>
                <h2>实时卡面</h2>
                <p>合约铸造时会生成对应的链上 SVG。</p>
              </div>
            </div>
            <article className={rarityClass}>
              <div className="card-topline">
                <span>ORACLE CARD</span>
                <span>FUCKINGORACLE</span>
              </div>
              <div className="card-art" aria-hidden="true">
                <div className="monad-orbit"><div className="monad-glyph" /></div>
              </div>
              <h3>{cardName || "Untitled Oracle"}</h3>
              <span className="rarity-pill">{rarity}</span>
              <div className="card-rule" />
              <p>{tagline || "这张卡牌还没有写下预言。"}</p>
              <footer>MINTED ON MONAD · FULLY ON-CHAIN</footer>
            </article>
          </div>
        </section>
      ) : (
        <section className="collection-section">
          <div className="collection-header">
            <div className="section-heading">
              <span>03</span>
              <div>
                <h2>我的收藏</h2>
                <p>直接从当前钱包和合约读取，不依赖数据库。</p>
              </div>
            </div>
            <button
              className="secondary-button"
              onClick={() => void loadCollection()}
              disabled={!account || collectionLoading}
            >
              {collectionLoading ? "读取中…" : "刷新收藏"}
            </button>
          </div>

          {!account ? (
            <div className="empty-state">
              <div className="empty-icon">◌</div>
              <h3>钱包尚未连接</h3>
              <p>连接 MetaMask 后，才能读取这个地址持有的 oracle card。</p>
              <button className="mint-button narrow" onClick={connectWallet}>连接钱包</button>
            </div>
          ) : cards.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">◇</div>
              <h3>收藏还是一片空白</h3>
              <p>铸造第一张预言卡，它会从链上雾气里浮出来。</p>
              <button className="mint-button narrow" onClick={() => setTab("mint")}>去铸造</button>
            </div>
          ) : (
            <div className="collection-grid">
              {cards.map((card) => (
                <article className="nft-item" key={card.tokenId}>
                  {card.image ? (
                    <img src={card.image} alt={`${card.cardName} NFT card`} />
                  ) : (
                    <div className="image-placeholder">没有图片</div>
                  )}
                  <div className="nft-meta">
                    <div className="nft-title-row">
                      <h3>{card.cardName}</h3>
                      <span>#{card.tokenId}</span>
                    </div>
                    <span className={`small-rarity rarity-${card.rarity.toLowerCase()}`}>
                      {card.rarity}
                    </span>
                    <p>{card.tagline}</p>
                    <div className="nft-actions">
                      <a
                        href={`${NETWORK.explorerUrl}/token/${CONTRACT_ADDRESS}?a=${card.tokenId}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        区块浏览器 ↗
                      </a>
                      <button
                        className="text-button"
                        onClick={() => void addNftToMetaMask(card.tokenId)}
                      >
                        添加到 MetaMask
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
