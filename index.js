const { ethers, Wallet, AbiCoder } = require("ethers");
const {
  FlashbotsBundleProvider,
  FlashbotsBundleResolution,
} = require("@flashbots/ethers-provider-bundle");
require("dotenv").config();

/* Use https://mainnet.infura.io/v3/918151ca535442e98bfb35faa831defb  or process.env.MAINNET_RPC_URL for mainnet */
const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);

const abiCoder = AbiCoder.defaultAbiCoder();
const privateKeys = [
  process.env.PRIVATE_KEY_1, //Make sure that PRIVATE_KEY_1 is the developer wallet
  process.env.PRIVATE_KEY_2,
  process.env.PRIVATE_KEY_3,
  process.env.PRIVATE_KEY_4,
  process.env.PRIVATE_KEY_5,
  process.env.PRIVATE_KEY_6,
  process.env.PRIVATE_KEY_7,
  process.env.PRIVATE_KEY_8,
  process.env.PRIVATE_KEY_9,
  process.env.PRIVATE_KEY_10,
];

/* Use the actual token address from the mainnet */
const TOKEN = "0x49378eAE76A38Cb50A6da4ce04d6659d4512D543";

/* Make sure that the function to enable trading is named as "openTrading()" */
const TOKEN_ABI = [
  {
    name: "openTrading",
    type: "function",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
];

/* Use actuall WETH address from UniswapV2Router. You can find it in the "read" functions */
const WETH = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9";

/* Use the actual UniswapV2Router address */
const UNISWAP_ROUTER_ADDRESS = "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008";
const funcSelector = ethers
  .id("swapExactETHForTokens(uint256,address[],address,uint256)")
  .slice(0, 10);

const tokenContract = new ethers.Contract(TOKEN, TOKEN_ABI, provider);
const signers = privateKeys.map(
  (privateKey) => new Wallet(privateKey, provider)
);

/* Use https://relay.flashbots.net for mainnet */
const sepoliaFlashbotsRelay = "https://relay-sepolia.flashbots.net";

let lastBlockNumber = null;
let processingBundle = false;

const GWEI = BigInt(10 ** 9);
let PRIORITY_FEE = GWEI * 10n;

const startTransmission = async (blockNumber) => {
  try {
    const flashbotsProvider = await FlashbotsBundleProvider.create(
      provider,
      signers[1],
      sepoliaFlashbotsRelay
    );

    const block = await provider.getBlock(blockNumber);
    const blockGasLimit = block.gasLimit;

    let totalGasUsed = BigInt(0);

    const maxBaseFeeInFutureBlock =
      FlashbotsBundleProvider.getMaxBaseFeeInFutureBlock(
        block.baseFeePerGas,
        6
      );

    const transactions = signers.slice(1).map((signer) => {
      const data = abiCoder.encode(
        ["uint256", "address[]", "address", "uint256"],
        [
          10,
          [WETH, TOKEN],
          signer.address,
          Math.floor(Date.now() / 1000) + 60 * 20,
        ]
      );
      const txData = funcSelector + data.slice(2);
      const swapTransaction = {
        to: UNISWAP_ROUTER_ADDRESS,
        type: 2,
        maxFeePerGas: PRIORITY_FEE + maxBaseFeeInFutureBlock,
        maxPriorityFeePerGas: PRIORITY_FEE,
        data: txData,
        chainId: 11155111, //Use chainId as 1 for mainnet
        gasLimit: 500000,
        value: ethers.parseEther("0.0001"),
      };

      totalGasUsed += BigInt(swapTransaction.gasLimit);
      return {
        signer: signer,
        transaction: swapTransaction,
      };
    });

    const remainingBlockGas = blockGasLimit - totalGasUsed;
    if (remainingBlockGas < 0) {
      console.error(
        `Error: Total gas used by the bundle (${totalGasUsed}) exceeds the block gas limit (${blockGasLimit}). Exiting.`
      );
      processingBundle = false;
      return;
    }

    const signedTransactions = await flashbotsProvider.signBundle(transactions);
    const simulation = await flashbotsProvider.simulate(
      signedTransactions,
      blockNumber + 1
    );

    console.log("gasPrice: ", simulation.results[0].gasPrice);

    if (simulation.firstRevert) {
      console.error(`Simulation Error: ${simulation.firstRevert.error}`);
      processingBundle = false;
      return;
    } else {
      console.log(`Simulation success. Block Number ${blockNumber}`);
    }

    const bundleSubmission = await flashbotsProvider.sendRawBundle(
      signedTransactions,
      blockNumber + 1
    );
    console.log(
      `Bundle Submitted awaiting response, ${bundleSubmission.bundleHash}`
    );

    const waitRes = await bundleSubmission.wait(1);
    console.log("Waiting for bundle response...");

    if (waitRes === FlashbotsBundleResolution.BundleIncluded) {
      console.log("Bundle included");
      processingBundle = false;
      process.exit(0);
    } else if (waitRes === FlashbotsBundleResolution.AccountNonceTooHigh) {
      console.log("Account nonce too high");
      processingBundle = false;
    } else {
      console.warn("Bundle Not included. Waiting for next block...");
      processingBundle = false;
    }
  } catch (error) {
    console.error(`Error in startTransmission: ${error.message}`);
    processingBundle = false;
  }
};

provider.on("block", async (blockNumber) => {
  if (processingBundle || blockNumber === lastBlockNumber) {
    return;
  }

  lastBlockNumber = blockNumber;
  processingBundle = true;

  console.log(`New block mined: ${blockNumber}`);

  try {
    console.log("Attempting to enable trading...");
    const tx = await tokenContract.connect(signers[0]).openTrading();
    await tx.wait(1);
    console.log("Trading enabled successfully.");
  } catch (error) {
    const revertMessage = error?.reason || "";

    if (
      revertMessage === "trading is already open" ||
      error.code === "CALL_EXCEPTION"
    ) {
      console.log("Trading is already open, continuing with bundle...");
    } else {
      console.error("Unexpected error during transaction:", error);
      processingBundle = false;
      return;
    }
  }

  await startTransmission(blockNumber).catch(console.error);
});
