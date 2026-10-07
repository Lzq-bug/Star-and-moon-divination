// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

contract MonadCardNFT is ERC721Enumerable, Ownable {
    using Strings for uint256;

    struct CardData {
        string cardName;
        string rarity;
        string tagline;
    }

    uint256 public immutable mintPrice;
    uint256 public immutable maxMintsPerWallet;

    uint256 private _nextTokenId = 1;
    mapping(uint256 tokenId => CardData data) private _cards;
    mapping(address minter => uint256 amount) public mintedBy;

    event CardMinted(
        address indexed owner,
        uint256 indexed tokenId,
        string cardName,
        string rarity,
        string tagline
    );
    event ProceedsWithdrawn(address indexed recipient, uint256 amount);

    error EmptyField();
    error FieldTooLong();
    error IncorrectMintPayment(uint256 required, uint256 received);
    error WalletMintLimitReached(uint256 limit);
    error NothingToWithdraw();
    error WithdrawFailed();

    constructor(
        string memory collectionName,
        string memory tokenSymbol,
        uint256 mintPriceWei,
        uint256 walletMintLimit,
        address initialOwner
    ) ERC721(collectionName, tokenSymbol) Ownable(initialOwner) {
        require(initialOwner != address(0), "Owner cannot be zero address");
        require(walletMintLimit > 0, "Mint limit must be greater than zero");

        mintPrice = mintPriceWei;
        maxMintsPerWallet = walletMintLimit;
    }

    function mintCard(
        string calldata cardName,
        string calldata rarity,
        string calldata tagline
    ) external payable returns (uint256 tokenId) {
        if (msg.value != mintPrice) {
            revert IncorrectMintPayment(mintPrice, msg.value);
        }

        if (mintedBy[msg.sender] >= maxMintsPerWallet) {
            revert WalletMintLimitReached(maxMintsPerWallet);
        }

        if (
            bytes(cardName).length == 0 ||
            bytes(rarity).length == 0 ||
            bytes(tagline).length == 0
        ) {
            revert EmptyField();
        }

        if (
            bytes(cardName).length > 72 ||
            bytes(rarity).length > 32 ||
            bytes(tagline).length > 180
        ) {
            revert FieldTooLong();
        }

        tokenId = _nextTokenId++;
        mintedBy[msg.sender] += 1;
        _cards[tokenId] = CardData(cardName, rarity, tagline);
        _safeMint(msg.sender, tokenId);

        emit CardMinted(msg.sender, tokenId, cardName, rarity, tagline);
    }

    function getCard(uint256 tokenId) external view returns (CardData memory) {
        _requireOwned(tokenId);
        return _cards[tokenId];
    }

    function withdraw() external onlyOwner {
        uint256 amount = address(this).balance;
        if (amount == 0) revert NothingToWithdraw();

        (bool success, ) = payable(owner()).call{value: amount}("");
        if (!success) revert WithdrawFailed();

        emit ProceedsWithdrawn(owner(), amount);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        CardData memory card = _cards[tokenId];

        string memory svg = _buildSvg(tokenId, card);
        string memory image = string.concat(
            "data:image/svg+xml;base64,",
            Base64.encode(bytes(svg))
        );

        bytes memory metadata = abi.encodePacked(
            '{"name":"',
            _escapeJson(card.cardName),
            ' #',
            tokenId.toString(),
            '","description":"',
            _escapeJson(card.tagline),
            '","image":"',
            image,
            '","attributes":[',
            '{"trait_type":"Rarity","value":"',
            _escapeJson(card.rarity),
            '"},',
            '{"trait_type":"Card ID","value":"',
            tokenId.toString(),
            '"}',
            ']}'
        );

        return string.concat(
            "data:application/json;base64,",
            Base64.encode(metadata)
        );
    }

    function _buildSvg(
        uint256 tokenId,
        CardData memory card
    ) private view returns (string memory) {
        string memory accent = _rarityColor(card.rarity);

        return string(
            abi.encodePacked(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 840">',
                '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
                '<stop offset="0" stop-color="#111827"/><stop offset="1" stop-color="#020617"/>',
                '</linearGradient><filter id="glow"><feGaussianBlur stdDeviation="18"/></filter></defs>',
                '<rect width="600" height="840" rx="42" fill="url(#bg)"/>',
                '<circle cx="480" cy="130" r="110" fill="',
                accent,
                '" opacity="0.25" filter="url(#glow)"/>',
                '<rect x="28" y="28" width="544" height="784" rx="34" fill="none" stroke="',
                accent,
                '" stroke-width="4"/>',
                '<text x="54" y="82" fill="#94a3b8" font-size="24" font-family="monospace">',
                _escapeXml(name()),
                '</text>',
                '<text x="546" y="82" fill="#94a3b8" text-anchor="end" font-size="24" font-family="monospace">#',
                tokenId.toString(),
                '</text>',
                '<rect x="54" y="122" width="492" height="330" rx="28" fill="',
                accent,
                '" opacity="0.14"/>',
                '<circle cx="300" cy="286" r="104" fill="none" stroke="',
                accent,
                '" stroke-width="12"/>',
                '<path d="M216 306 C246 224 354 224 384 306 C348 276 252 276 216 306Z" fill="',
                accent,
                '"/>',
                '<text x="54" y="520" fill="#ffffff" font-size="44" font-weight="700" font-family="Arial, sans-serif">',
                _escapeXml(card.cardName),
                '</text>',
                '<rect x="54" y="558" width="220" height="54" rx="27" fill="',
                accent,
                '"/>',
                '<text x="164" y="594" fill="#020617" text-anchor="middle" font-size="24" font-weight="700" font-family="Arial, sans-serif">',
                _escapeXml(card.rarity),
                '</text>',
                '<line x1="54" y1="654" x2="546" y2="654" stroke="#334155" stroke-width="2"/>',
                '<text x="54" y="710" fill="#cbd5e1" font-size="23" font-family="Arial, sans-serif">',
                _escapeXml(card.tagline),
                '</text>',
                '<text x="54" y="770" fill="#64748b" font-size="18" font-family="monospace">MINTED ON MONAD</text>',
                '</svg>'
            )
        );
    }

    function _rarityColor(string memory rarity) private pure returns (string memory) {
        bytes32 value = keccak256(bytes(rarity));
        if (value == keccak256(bytes("Common"))) return "#94a3b8";
        if (value == keccak256(bytes("Rare"))) return "#38bdf8";
        if (value == keccak256(bytes("Epic"))) return "#c084fc";
        if (value == keccak256(bytes("Legendary"))) return "#fbbf24";
        return "#34d399";
    }

    function _escapeJson(string memory value) private pure returns (string memory) {
        bytes memory input = bytes(value);
        bytes memory output = new bytes(input.length * 6);
        uint256 j;

        for (uint256 i; i < input.length; ++i) {
            bytes1 c = input[i];
            if (c == 0x22 || c == 0x5c) {
                output[j++] = 0x5c;
                output[j++] = c;
            } else if (c == 0x0a) {
                output[j++] = 0x5c;
                output[j++] = 0x6e;
            } else if (c == 0x0d) {
                output[j++] = 0x5c;
                output[j++] = 0x72;
            } else if (c == 0x09) {
                output[j++] = 0x5c;
                output[j++] = 0x74;
            } else if (uint8(c) < 0x20) {
                output[j++] = 0x20;
            } else {
                output[j++] = c;
            }
        }

        assembly {
            mstore(output, j)
        }
        return string(output);
    }

    function _escapeXml(string memory value) private pure returns (string memory) {
        bytes memory input = bytes(value);
        bytes memory output = new bytes(input.length * 6);
        uint256 j;

        for (uint256 i; i < input.length; ++i) {
            bytes1 c = input[i];
            if (c == 0x26) {
                j = _append(output, j, bytes("&amp;"));
            } else if (c == 0x3c) {
                j = _append(output, j, bytes("&lt;"));
            } else if (c == 0x3e) {
                j = _append(output, j, bytes("&gt;"));
            } else if (c == 0x22) {
                j = _append(output, j, bytes("&quot;"));
            } else if (c == 0x27) {
                j = _append(output, j, bytes("&apos;"));
            } else if (uint8(c) < 0x20 && c != 0x09 && c != 0x0a && c != 0x0d) {
                output[j++] = 0x20;
            } else {
                output[j++] = c;
            }
        }

        assembly {
            mstore(output, j)
        }
        return string(output);
    }

    function _append(
        bytes memory target,
        uint256 offset,
        bytes memory value
    ) private pure returns (uint256) {
        for (uint256 i; i < value.length; ++i) {
            target[offset++] = value[i];
        }
        return offset;
    }
}
