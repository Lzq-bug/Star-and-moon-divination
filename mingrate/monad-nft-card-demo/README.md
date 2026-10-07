# oracle card · Monad Testnet NFT Demo

一个可以在本地运行、连接 MetaMask、在 Monad Testnet 上付费铸造全链上 NFT，并在“我的收藏”页面读取 NFT 的完整 Demo。

## 已配置参数

| 项目 | 值 |
|---|---|
| 网络 | Monad Testnet |
| Chain ID | `10143` |
| 收藏名称 | `oracle card` |
| ERC-721 Symbol | `FUCKINGORACLE` |
| 单张铸造价格 | `0.00145 MON` |
| 每钱包累计铸造上限 | `1000` |
| 合约 owner / 收款地址 | `0xA4C755e353BBEBe003a73D7A1563931d7CDFD6C5` |
| 前端方式 | 本地 Vite |

这里的“每钱包 1000 张”是**累计铸造数量**。地址把 NFT 转走后，额度不会重置。

测试网 MON 没有真实价值，但铸造交易仍会同时支付：

```text
0.00145 测试 MON + 网络 Gas
```

铸造费用保存在合约中，只有合约 owner 可以调用 `withdraw()` 提取到 owner 地址。

## 项目结构

```text
contracts/MonadCardNFT.sol   ERC-721 合约、价格、限额、提款、链上 SVG
scripts/deploy.cjs           Monad 部署脚本
scripts/withdraw.cjs         owner 提取合约中的铸造收入
test/MonadCardNFT.cjs        Hardhat 合约测试
src/App.tsx                  MetaMask、铸造、收藏页
```

## 1. 环境要求

- Node.js 20 或 22
- MetaMask 浏览器扩展
- 一个专用测试钱包
- 钱包中有 Monad Testnet MON

不要在聊天、截图、Git 仓库或前端环境变量中公开助记词和私钥。

## 2. 安装

```bash
pnpm install
```

复制配置：

### Windows PowerShell

```powershell
Copy-Item .env.example .env
```

### macOS / Linux

```bash
cp .env.example .env
```

## 3. 填写部署私钥

打开 `.env`，只修改这一项：

```env
PRIVATE_KEY=0x你的专用测试钱包私钥
```

建议该私钥对应以下 owner 地址：

```text
0xA4C755e353BBEBe003a73D7A1563931d7CDFD6C5
```

其他公开配置已经写好：

```env
NFT_COLLECTION_NAME=oracle card
NFT_SYMBOL=FUCKINGORACLE
NFT_MINT_PRICE_MON=0.00145
NFT_MAX_MINTS_PER_WALLET=1000
NFT_OWNER=0xA4C755e353BBEBe003a73D7A1563931d7CDFD6C5
```

## 4. 编译与本地测试

```bash
pnpm run compile
pnpm test
```

测试覆盖：

- 收藏名称、Symbol、价格、限额与 owner
- 精确支付 `0.00145 MON`
- 全链上 metadata 和 SVG
- 累计铸造上限不可通过转账绕过
- 只有 owner 可以提款

## 5. 部署到 Monad Testnet

```bash
pnpm run deploy:testnet
```

终端会打印部署者、owner、价格、限额、交易哈希和合约地址。

部署成功后会看到：

```env
VITE_CONTRACT_ADDRESS=0x...
```

## 6. 配置并启动本地前端

在项目根目录新建 `.env.local`：

```env
VITE_NETWORK=testnet
VITE_CONTRACT_ADDRESS=0x刚刚部署得到的合约地址
```

启动：

```bash
pnpm run dev
```

浏览器打开 Vite 输出的地址，通常是：

```text
http://localhost:5173
```

操作顺序：

1. 点击“连接 MetaMask”。
2. 页面请求切换到 Monad Testnet。
3. 输入卡牌名称、稀有度与一句话介绍。
4. 点击“支付 0.00145 MON 并铸造”。
5. 在 MetaMask 确认交易。
6. 打开“我的收藏”查看 NFT。

## 7. 提取铸造收入

把已经部署的地址加入 `.env`：

```env
NFT_CONTRACT_ADDRESS=0x已部署合约地址
```

确保 `PRIVATE_KEY` 对应合约 owner，然后运行：

```bash
pnpm run withdraw:testnet
```

脚本会先显示合约余额、owner 与当前签名地址，签名者不是 owner 时会停止。

## 8. MetaMask 中没有自动显示 NFT？

NFT 的所有权已经记录在 ERC-721 合约中，钱包只是展示层。应用在铸造成功后会尝试调用 MetaMask 的 ERC-721 `wallet_watchAsset`。如果钱包没有弹窗，仍可：

- 在 Demo 的“我的收藏”中查看；
- 使用合约地址和 Token ID 在钱包中手动导入；
- 在 Monad 区块浏览器查看交易和 NFT 所有权。

## 9. 当前 Demo 的边界

- 收藏页最多读取 50 张，避免公共 RPC 请求过多。
- 采用 `ERC721Enumerable`，适合 Demo；大规模项目建议使用事件索引器。
- SVG 与 metadata 全链上，Gas 比 IPFS URI 方案更高。
- 价格和每钱包限额在部署时固定，修改需要重新部署合约。
- 没有最大总供应量、白名单、暂停开关、ERC-2981 版税或内容审核。

## 10. 安全提示

- 测试钱包与主钱包分开。
- `.env` 已被 `.gitignore` 忽略，但提交前仍要检查 Git diff。
- 不要把 `PRIVATE_KEY` 放进 `.env.local`，Vite 的 `VITE_` 变量会进入浏览器代码。
- 切换主网前应重新审计合约，并设置保守的交易 gas limit。Monad 的协议升级历史包含按 gas limit 收费的行为，主网部署前尤其要谨慎。
