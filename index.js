const { ethers, Wallet } = require("ethers");
const { FlashbotsBundleProvider, FlashbotsBundleResolution } = require("@flashbots/ethers-provider-bundle");


const provider = new ethers.JsonRpcProvider("https://sepolia.infura.io/v3/38668298c3ce49cbb9a95ca862245495");
const webSocketProvider = new ethers.WebSocketProvider("wss://sepolia.infura.io/ws/v3/2cf8e6c271a7499ca2f982050f09a6e0");
const WALLET_ADDRESS = "0x70cf5eCf9c36024C56a19242FE8bb596bB70058";

const authSigner = new Wallet("a0654287dd5774e89c1587107884bd6e48469646ceea773410f82f2b83d920ca", provider);
const sepoliaFlashbotsRelay = "https://relay-sepolia.flashbots.net";

const startTransmission = async () => {
    const flashbotsProvider = await FlashbotsBundleProvider.create(provider, authSigner, sepoliaFlashbotsRelay);

    const GWEI = BigInt(10 ** 10);
    const LEGACY_GAS_PRICE = GWEI * 30n;
    const PRIORITY_FEE = GWEI * 13n;
    const blockNumber = await provider.getBlockNumber();
    const block = await provider.getBlock();
    const maxBaseFeeInFutureBlock = FlashbotsBundleProvider.getMaxBaseFeeInFutureBlock(block.baseFeePerGas, 6);

    console.log(`Max fee in future Block: ${String(maxBaseFeeInFutureBlock)}`);

    const amountInEther = "0.5";

    const signedTransactions = await flashbotsProvider.signBundle([
        {
            signer: authSigner,
            transaction: {
                to: WALLET_ADDRESS,
                type: 2,
                maxFeePerGas: PRIORITY_FEE + maxBaseFeeInFutureBlock,
                maxPriorityFeePerGas: PRIORITY_FEE,
                data: '0x',
                chainId: 11155111,
                value: ethers.parseEther(amountInEther),
            },
        },
        {
            signer: authSigner,
            transaction: {
                to: WALLET_ADDRESS,
                gasPrice: LEGACY_GAS_PRICE,
                data: "0x",
                value: ethers.parseEther(amountInEther),
                chainId: 11155111
            }
        }
    ]);

    console.log("Date Before: ", new Date());
    console.log("Running simulation");

    const simulation = await flashbotsProvider.simulate(signedTransactions, blockNumber + 1);
    console.log("Date After: ", new Date());

    if (simulation.firstRevert) {
        console.error(`Simulation Error: ${simulation.firstRevert.error}`);
    } else {
        console.log(`Simulation success. Block Number ${blockNumber}`);
    }

    for (let i = 1; i <= 10; i++) {
        const bundleSubmission = await flashbotsProvider.sendRawBundle(signedTransactions, blockNumber + i);
        console.log(`Bundle Submitted awaiting response, ${bundleSubmission.bundleHash}`);

        const waitRes = await bundleSubmission.wait();
        console.log(`Wait response: ${FlashbotsBundleResolution[waitRes]}`);

        if (waitRes === FlashbotsBundleResolution.BundleIncluded || waitRes === FlashbotsBundleResolution.AccountNonceTooHigh) {
            console.log("Bundle included");
            process.exit(0);
        } else {
            console.log({
                bundleStats: await flashbotsProvider.getBundleStatsV2(simulation.bundleHash, blockNumber + 1),
                userStats: await flashbotsProvider.getUserStatsV2(),
            });
        }
    }
    console.log('Bundles submitted successfully.');
}

startTransmission().catch(console.error);