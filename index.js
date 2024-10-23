const { ethers, Wallet, AbiCoder } = require("ethers");
const {
  FlashbotsBundleProvider,
  FlashbotsBundleResolution,
} = require("@flashbots/ethers-provider-bundle");
require("dotenv").config();

/**
 * Use the following RPC url for mainnnet
 *
 * https://mainnet.infura.io/v3/918151ca535442e98bfb35faa831defb
 */
const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);

const abiCoder = AbiCoder.defaultAbiCoder();
const privateKeys = [
  process.env.PRIVATE_KEY_1,
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

/**
 * Use the contract address with the `openTrading()` function.
 * Change the name if there's `enableTrading()`.
 * Make sure that the contract has `isTradingOpen` view function.
 * It should look like this:
 * 
 *    function isTradingOpen() public view returns (bool) {
        return tradingOpen;
      }
 */
const TOKEN = "0x203E2f1bbcB77A2d73133b1fFF2Dd8daCC892E7C";
const TOKEN_ABI = [
  {
    name: "openTrading",
    type: "function",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "isTradingOpen",
    type: "function",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "view",
  },
];

/**
 * Use the original WETH address from UniswapV2Router2
 */
const WETH = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9";
/**
 * Use the original Router address
 */
const UNISWAP_ROUTER_ADDRESS = "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008";
const funcSelector = ethers
  .id("swapExactETHForTokens(uint256,address[],address,uint256)")
  .slice(0, 10);

const tokenContract = new ethers.Contract(TOKEN, TOKEN_ABI, provider);
const signers = privateKeys.map(
  (privateKey) => new Wallet(privateKey, provider)
);

/**
 * Use this relay for mainnet "https://rpc.flashbots.net/fast"
 */
const sepoliaFlashbotsRelay = "https://relay-sepolia.flashbots.net";

let lastBlockNumber = null;

const GWEI = BigInt(10 ** 9);
let PRIORITY_FEE = GWEI * 13n;

const startTransmission = async (blockNumber, retry = false) => {
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
      process.exit(0);
    } else if (waitRes === FlashbotsBundleResolution.AccountNonceTooHigh) {
      console.log("Account nonce too high");
    } else {
      console.log("Bundle not included. Stats:", {
        bundleStats: await flashbotsProvider.getBundleStatsV2(
          bundleSubmission.bundleHash,
          blockNumber + 1
        ),
        userStats: await flashbotsProvider.getUserStatsV2(),
      });

      if (!retry) {
        console.log("Retrying with lower PRIORITY_FEE...");
        PRIORITY_FEE = GWEI * 10n;
        await startTransmission(blockNumber, true);
      } else {
        console.error("Bundle still not included after retry.");
      }
    }
  } catch (error) {
    console.error(`Error in startTransmission: ${error.message}`);
  }
};

provider.on("block", async (blockNumber) => {
  if (blockNumber !== lastBlockNumber) {
    lastBlockNumber = blockNumber;
    console.log(`New block mined: ${blockNumber}`);
    const tradingEnabled = await tokenContract
      .connect(signers[0])
      .isTradingOpen();
    if (tradingEnabled == false) {
      console.log("Enabling trading...");
      const tx = await tokenContract.connect(signers[0]).openTrading();
      await tx.wait(1);
    }
    await startTransmission(blockNumber).catch(console.error);
  }
});
