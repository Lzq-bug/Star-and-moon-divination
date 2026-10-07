const { ethers, network } = require("hardhat");

async function main() {
  const contractAddress = process.env.NFT_CONTRACT_ADDRESS?.trim();
  if (!contractAddress || !ethers.isAddress(contractAddress)) {
    throw new Error("Set NFT_CONTRACT_ADDRESS to the deployed contract address in .env");
  }

  const [signer] = await ethers.getSigners();
  const contract = await ethers.getContractAt("MonadCardNFT", contractAddress, signer);
  const owner = await contract.owner();
  const balance = await ethers.provider.getBalance(contractAddress);

  console.log("Network:", network.name);
  console.log("Contract:", contractAddress);
  console.log("Contract owner:", owner);
  console.log("Signer:", signer.address);
  console.log("Withdrawable balance:", `${ethers.formatEther(balance)} MON`);

  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error("The PRIVATE_KEY signer is not the contract owner");
  }
  if (balance === 0n) {
    console.log("Nothing to withdraw.");
    return;
  }

  const tx = await contract.withdraw();
  console.log("Transaction:", tx.hash);
  await tx.wait();
  console.log("Withdrawal confirmed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
