const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MonadCardNFT", function () {
  const mintPrice = ethers.parseEther("0.00145");

  async function deployFixture(limit = 1000n) {
    const [owner, other] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("MonadCardNFT");
    const contract = await factory.deploy(
      "oracle card",
      "FUCKINGORACLE",
      mintPrice,
      limit,
      owner.address,
    );
    await contract.waitForDeployment();
    return { contract, owner, other };
  }

  it("uses the configured collection, price, owner and wallet limit", async function () {
    const { contract, owner } = await deployFixture();

    expect(await contract.name()).to.equal("oracle card");
    expect(await contract.symbol()).to.equal("FUCKINGORACLE");
    expect(await contract.mintPrice()).to.equal(mintPrice);
    expect(await contract.maxMintsPerWallet()).to.equal(1000n);
    expect(await contract.owner()).to.equal(owner.address);
  });

  it("mints a paid enumerable card with on-chain metadata", async function () {
    const { contract, owner } = await deployFixture();

    await expect(
      contract.mintCard("Oracle Genesis", "Rare", "A prophecy written on Monad.", {
        value: mintPrice,
      }),
    )
      .to.emit(contract, "CardMinted")
      .withArgs(owner.address, 1n, "Oracle Genesis", "Rare", "A prophecy written on Monad.");

    expect(await contract.balanceOf(owner.address)).to.equal(1n);
    expect(await contract.tokenOfOwnerByIndex(owner.address, 0)).to.equal(1n);
    expect(await contract.mintedBy(owner.address)).to.equal(1n);
    expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(mintPrice);

    const card = await contract.getCard(1n);
    expect(card.cardName).to.equal("Oracle Genesis");
    expect(card.rarity).to.equal("Rare");

    const tokenUri = await contract.tokenURI(1n);
    const prefix = "data:application/json;base64,";
    expect(tokenUri.startsWith(prefix)).to.equal(true);

    const metadata = JSON.parse(
      Buffer.from(tokenUri.slice(prefix.length), "base64").toString("utf8"),
    );

    expect(metadata.name).to.equal("Oracle Genesis #1");
    expect(metadata.description).to.equal("A prophecy written on Monad.");
    expect(metadata.image.startsWith("data:image/svg+xml;base64,")).to.equal(true);
    expect(metadata.attributes[0]).to.deep.equal({
      trait_type: "Rarity",
      value: "Rare",
    });
  });

  it("requires the exact mint payment", async function () {
    const { contract } = await deployFixture();

    await expect(
      contract.mintCard("Unpaid", "Common", "No payment."),
    )
      .to.be.revertedWithCustomError(contract, "IncorrectMintPayment")
      .withArgs(mintPrice, 0n);
  });

  it("enforces a cumulative per-wallet mint limit", async function () {
    const { contract, other } = await deployFixture(1n);

    await contract.connect(other).mintCard("First", "Epic", "First mint.", {
      value: mintPrice,
    });
    await contract.connect(other).transferFrom(other.address, await contract.owner(), 1n);

    await expect(
      contract.connect(other).mintCard("Second", "Rare", "Cannot reset by transfer.", {
        value: mintPrice,
      }),
    )
      .to.be.revertedWithCustomError(contract, "WalletMintLimitReached")
      .withArgs(1n);
  });

  it("lets only the owner withdraw mint proceeds", async function () {
    const { contract, owner, other } = await deployFixture();

    await contract.connect(other).mintCard("Paid", "Legendary", "Funds accrue.", {
      value: mintPrice,
    });

    await expect(contract.connect(other).withdraw()).to.be.revertedWithCustomError(
      contract,
      "OwnableUnauthorizedAccount",
    );

    await expect(contract.connect(owner).withdraw())
      .to.emit(contract, "ProceedsWithdrawn")
      .withArgs(owner.address, mintPrice);

    expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(0n);
  });

  it("rejects empty fields", async function () {
    const { contract } = await deployFixture();

    await expect(
      contract.mintCard("", "Rare", "No name", { value: mintPrice }),
    ).to.be.revertedWithCustomError(contract, "EmptyField");
  });
});
