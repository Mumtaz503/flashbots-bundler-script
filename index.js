const { ethers, Wallet, AbiCoder } = require("ethers");
const {
  FlashbotsBundleProvider,
  FlashbotsBundleResolution,
} = require("@flashbots/ethers-provider-bundle");
require("dotenv").config();

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

const TOKEN = "0xf74105e4dB0ba8D0738632454C55e60A3570D3D3";
const TOKEN_ABI = [
  {
    name: "openTrading",
    type: "function",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
    payable: true,
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
const WETH = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9";
const UNISWAP_ROUTER_ADDRESS = "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008";
const funcSelector = ethers
  .id("swapExactETHForTokens(uint256,address[],address,uint256)")
  .slice(0, 10);

const tokenContract = new ethers.Contract(TOKEN, TOKEN_ABI, provider);
const signers = privateKeys.map(
  (privateKey) => new Wallet(privateKey, provider)
);
const sepoliaFlashbotsRelay = "https://relay-sepolia.flashbots.net";

let lastBlockNumber = null;

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

    const transactions = signers.map((signer) => {
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
        maxFeePerGas: block.baseFeePerGas + ethers.parseUnits("70", "gwei"),
        maxPriorityFeePerGas: ethers.parseUnits("70", "gwei"),
        data: txData,
        chainId: 11155111,
        gasLimit: 500000,
        value: ethers.parseEther("0.0001"),
      };

      totalGasUsed += BigInt(swapTransaction.gasLimit);
      return {
        signer: signer,
        transaction: swapTransaction,
      };
    });

    const allTransactions = [...transactions];

    const remainingBlockGas = blockGasLimit - totalGasUsed;
    if (remainingBlockGas < 0) {
      console.error(
        `Error: Total gas used by the bundle (${totalGasUsed}) exceeds the block gas limit (${blockGasLimit}). Exiting.`
      );
      return;
    }

    const signedTransactions = await flashbotsProvider.signBundle(
      allTransactions
    );
    const simulation = await flashbotsProvider.simulate(
      signedTransactions,
      blockNumber + 1
    );

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

    const waitRes = await bundleSubmission.wait();
    console.log("Waiting for bundle response...");

    if (
      waitRes === FlashbotsBundleResolution.BundleIncluded ||
      waitRes === FlashbotsBundleResolution.AccountNonceTooHigh
    ) {
      console.log("Bundle included");
      process.exit(0);
    } else {
      console.log("Bundle not included. Stats:", {
        bundleStats: await flashbotsProvider.getBundleStatsV2(
          bundleSubmission.bundleHash,
          blockNumber + 1
        ),
        userStats: await flashbotsProvider.getUserStatsV2(),
      });
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
      await tx.wait();
    }
    await startTransmission(blockNumber).catch(console.error);
  }
});

// Check if the remaining block gas is less than the bundle execution gas
// keep checking it until the appropriate gas is reached.
// Then execute enable trading using ethers.js
// Then execute the script
