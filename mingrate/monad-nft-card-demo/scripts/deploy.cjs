const { ethers, network } = require("hardhat");

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main() {
  const collectionName = process.env.NFT_COLLECTION_NAME?.trim() || "oracle card";
  const tokenSymbol = process.env.NFT_SYMBOL?.trim() || "FUCKINGORACLE";
  const mintPriceMon = process.env.NFT_MINT_PRICE_MON?.trim() || "0.00145";
  const maxMintsPerWallet = BigInt(
    process.env.NFT_MAX_MINTS_PER_WALLET?.trim() || "1000",
  );
  const initialOwner = requiredEnv("NFT_OWNER");

  if (!ethers.isAddress(initialOwner)) {
    throw new Error(`NFT_OWNER is not a valid EVM address: ${initialOwner}`);
  }
  if (maxMintsPerWallet <= 0n) {
    throw new Error("NFT_MAX_MINTS_PER_WALLET must be greater than zero");
  }

  const mintPriceWei = ethers.parseEther(mintPriceMon);
  const [deployer] = await ethers.getSigners();

  console.log("\nDeployment settings");
  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);
  console.log("Owner / proceeds recipient:", initialOwner);
  console.log("Collection:", collectionName);
  console.log("Symbol:", tokenSymbol);
  console.log("Mint price:", `${mintPriceMon} MON`);
  console.log("Per-wallet cumulative mint limit:", maxMintsPerWallet.toString());

  if (deployer.address.toLowerCase() !== initialOwner.toLowerCase()) {
    console.warn("WARNING: deployer and owner differ. Withdrawals require the owner wallet.");
  }

  const factory = await ethers.getContractFactory("MonadCardNFT");
  const contract = await factory.deploy(
    collectionName,
    tokenSymbol,
    mintPriceWei,
    maxMintsPerWallet,
    initialOwner,
  );
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const deploymentTx = contract.deploymentTransaction();

  console.log("\nMonadCardNFT deployed");
  console.log("Contract:", address);
  console.log("Transaction:", deploymentTx?.hash || "unknown");
  console.log("\nCopy this line into .env.local:");
  console.log(`VITE_CONTRACT_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
