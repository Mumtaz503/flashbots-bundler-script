const { ethers } = require("ethers");
const { FlashbotsBundleProvider } = require("@flashbots/ethers-provider-bundle");
const { Token, WETH, Fetcher, Route, Trade, TokenAmount, TradeType, Percent } = require("@uniswap/sdk");

const INFURA_PROJECT_ID = "YOUR_INFURA_PROJECT_ID";
const FLASHBOTS_ENDPOINT = "https://relay.flashbots.net";
const TOKEN_ADDRESS = "YOUR_TOKEN_ADDRESS";
const UNISWAP_ROUTER_ADDRESS = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const NETWORK = "mainnet";
const MINER_REWARD = ethers.utils.parseEther("0.01"); // Reward to the miner

// Replace these with your private keys
const privateKeys = [
    "0xYOUR_PRIVATE_KEY_1",
    "0xYOUR_PRIVATE_KEY_2",
    // Add more private keys as needed
];

const provider = new ethers.providers.InfuraProvider(NETWORK, INFURA_PROJECT_ID);
const wallets = privateKeys.map(key => new ethers.Wallet(key, provider));
const authSigner = wallets[0]; // Use the first wallet as the Flashbots auth signer

const uniswapRouterAbi = [
    "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)"
];

const tokenAbi = [
    "event OpenTrading()"
];

const tokenContract = new ethers.Contract(TOKEN_ADDRESS, tokenAbi, provider);
const uniswapRouterContract = new ethers.Contract(UNISWAP_ROUTER_ADDRESS, uniswapRouterAbi, provider);

async function buyTokens(wallet) {
    const token = await Fetcher.fetchTokenData(NETWORK, TOKEN_ADDRESS, provider);
    const weth = WETH[token.chainId];
    const pair = await Fetcher.fetchPairData(token, weth, provider);
    const route = new Route([pair], weth);
    const trade = new Trade(route, new TokenAmount(weth, ethers.utils.parseEther("1").toString()), TradeType.EXACT_INPUT);

    const slippageTolerance = new Percent("50", "10000"); // 0.5% slippage tolerance
    const amountOutMin = trade.minimumAmountOut(slippageTolerance).raw;
    const path = [weth.address, token.address];
    const to = wallet.address;
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

    const tx = {
        to: UNISWAP_ROUTER_ADDRESS,
        data: uniswapRouterContract.interface.encodeFunctionData("swapExactETHForTokens", [
            amountOutMin.toString(),
            path,
            to,
            deadline
        ]),
        value: ethers.utils.parseEther("1"),
        gasPrice: ethers.utils.parseUnits("100", "gwei"), // Higher gas price
        gasLimit: 200000,
        nonce: await wallet.getTransactionCount()
    };

    return await wallet.signTransaction(tx);
}

async function submitBundle() {
    const flashbotsProvider = await FlashbotsBundleProvider.create(provider, authSigner, FLASHBOTS_ENDPOINT);
    const blockNumber = await provider.getBlockNumber();

    const signedTransactions = await Promise.all(wallets.map(wallet => buyTokens(wallet)));
    const bundle = signedTransactions.map(signedTx => ({ signedTransaction: signedTx }));

    // Add a direct payment to the miner
    const minerPayment = {
        to: "0x0000000000000000000000000000000000000000", // Replace with actual miner's address or the relay's address
        value: MINER_REWARD,
        gasPrice: ethers.utils.parseUnits("0", "gwei"), // No additional gas price, as it's a direct payment
        gasLimit: 21000,
        nonce: await authSigner.getTransactionCount()
    };
    const signedMinerPayment = await authSigner.signTransaction(minerPayment);
    bundle.push({ signedTransaction: signedMinerPayment });

    const bundleResponse = await flashbotsProvider.sendBundle(bundle, blockNumber + 1);

    if ("error" in bundleResponse) {
        console.error(`Error: ${bundleResponse.error.message}`);
        return;
    }

    const waitResponse = await bundleResponse.wait();
    if (waitResponse === 0) {
        console.log("Bundle successfully included in block.");
    } else {
        console.log("Bundle not included in block.");
    }
}

function monitorOpenTradingEvent() {
    tokenContract.on("OpenTrading", async () => {
        console.log("OpenTrading event detected. Submitting Flashbots bundle...");
        await submitBundle();
    });
}

// Start monitoring the event
monitorOpenTradingEvent();