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
  // process.env.PRIVATE_KEY_6,
  // process.env.PRIVATE_KEY_7,
  // process.env.PRIVATE_KEY_8,
  // process.env.PRIVATE_KEY_9,
  // process.env.PRIVATE_KEY_10,
];

const TOKEN = "0x2ec75aD34Aa58C1415C602407ef0E9aFD6f22021";
const TOKEN_ABI = ["event TradingOpen(bool tradingOpen_)"];
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

const startTransmission = async () => {
  const flashbotsProvider = await FlashbotsBundleProvider.create(
    provider,
    signers[1],
    sepoliaFlashbotsRelay
  );

  const GWEI = BigInt(10 ** 10);
  const PRIORITY_FEE = GWEI * 50n;
  const blockNumber = await provider.getBlockNumber();
  const block = await provider.getBlock();
  const maxBaseFeeInFutureBlock =
    FlashbotsBundleProvider.getMaxBaseFeeInFutureBlock(block.baseFeePerGas, 6);

  console.log(`Max fee in future Block: ${String(maxBaseFeeInFutureBlock)}`);

  const blockGasLimit = block.gasLimit;
  console.log(`Block Gas Limit: ${blockGasLimit.toString()}`);

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
      maxFeePerGas: PRIORITY_FEE + maxBaseFeeInFutureBlock,
      maxPriorityFeePerGas: PRIORITY_FEE,
      data: txData,
      chainId: 11155111,
      gasLimit: 500000,
      value: ethers.parseEther("0.01"),
    };

    totalGasUsed += BigInt(swapTransaction.gasLimit);

    return {
      signer: signer,
      transaction: swapTransaction,
    };
  });

  console.log(`Total Gas Used by Bundle: ${totalGasUsed.toString()}`);

  if (totalGasUsed > blockGasLimit) {
    console.error(
      `Total gas usage exceeds the block's gas limit. Consider splitting the bundle.`
    );
    process.exit(1);
  }

  const signedTransactions = await flashbotsProvider.signBundle(transactions);

  console.log("Date Before: ", new Date());
  console.log("Running simulation");

  const simulation = await flashbotsProvider.simulate(
    signedTransactions,
    blockNumber + 1
  );
  console.log("Date After: ", new Date());

  if (simulation.firstRevert) {
    console.error(`Simulation Error: ${simulation.firstRevert.error}`);
    process.exit(0);
  } else {
    console.log(`Simulation success. Block Number ${blockNumber}`);
  }

  for (let i = 1; i <= privateKeys.length; i++) {
    const bundleSubmission = await flashbotsProvider.sendRawBundle(
      signedTransactions,
      blockNumber + i
    );
    console.log(
      `Bundle Submitted awaiting response, ${bundleSubmission.bundleHash}`
    );

    const waitRes = await bundleSubmission.wait();
    console.log(`Wait response: ${FlashbotsBundleResolution[waitRes]}`);

    if (
      waitRes === FlashbotsBundleResolution.BundleIncluded ||
      waitRes === FlashbotsBundleResolution.AccountNonceTooHigh
    ) {
      console.log("Bundle included");
      process.exit(0);
    } else {
      console.log({
        bundleStats: await flashbotsProvider.getBundleStatsV2(
          simulation.bundleHash,
          blockNumber + 1
        ),
        userStats: await flashbotsProvider.getUserStatsV2(),
      });
    }
  }
  console.log(
    "Bundles submitted successfully. Either wait for the inclusion or re-run the script with increased PRIORITY_FEE"
  );
  process.exit(0);
};

tokenContract.on("TradingOpen", async (tradingOpen_) => {
  console.log("Event emittion detected starting transmission", tradingOpen_);
  await startTransmission().catch(console.error);
});
