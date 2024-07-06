const { ethers } = require("ethers");
const { FlashbotsBundleProvider, FlashbotsBundleResolution } = require("@flashbots/ethers-provider-bundle");
const { v4: uuidV4 } = require("uuid");
require("dotenv").config;

const CONTRACT_ADDRESS = "0x70cf5eCf9c36024C56a19242FE8bb596bB700589"; //STKN Sepolia
const CALL_DATA = "0x";
const FLASHBOTS_AUTH_KEY = process.env.PRIVATE_KEY;

const GWEI = BigInt(10) ** 9n;
const PIORITY_FEE = GWEI * 1000n;
const LEGACY_GAS_PRICE = GWEI * 12n;
const FUTURE_BLOCKS = 1;

const CHAIN_ID = 11155111;
const provider = new ethers.InfuraProvider(CHAIN_ID, process.env.SEPOLIA_RPC_URL);
const FLASHBOTS_END_POINT = "https://relay-sepolia.flashbots.net";

const keys = ["a0654287dd5774e89c1587107884bd6e48469646ceea773410f82f2b83d920ca", "https://sepolia.infura.io/v3/38668298c3ce49cbb9a95ca862245495", "https://mainnet.infura.io/v3/38668298c3ce49cbb9a95ca862245495"];

// for (const e of keys) {
//     if (!process.env[e]) {
//         if (FLASHBOTS_END_POINT.includes('sepolia') && e === "MAINNET_RPC_URL") {
//             continue;
//         }
//         console.warn(`${e} must be defined`);
//     }
// }


async function main() {
    const authSigner = FLASHBOTS_AUTH_KEY ? new ethers.Wallet(process.env.PRIVATE_KEY) : ethers.Wallet.createRandom();
    const wallet = new ethers.Wallet("a0654287dd5774e89c1587107884bd6e48469646ceea773410f82f2b83d920ca", provider);
    const flashbotsProvider = await FlashbotsBundleProvider.create(provider, authSigner, FLASHBOTS_END_POINT);

    const userStats = await flashbotsProvider.getUserStatsV2();

    if (userStats) {
        console.log("User Stats", userStats);
    } else {
        console.error("V2 error");
    }

    const legacyTransaction = {
        to: CONTRACT_ADDRESS,
        gasPrice: LEGACY_GAS_PRICE,
        gasLimit: 21000,
        data: CALL_DATA,
        nonce: await provider.getTransactionCount(CONTRACT_ADDRESS),
        chainId: CHAIN_ID
    }

    provider.on('block', async (blockNumber) => {
        const block = await provider.getBlock(blockNumber);
        const replacementUuid = uuidV4();

        let eip1559Transaction;

        if (block.baseFeePerGas === null) {
            console.warn("Not EIP1559 enabled");
            eip1559Transaction = { ...legacyTransaction };
            delete eip1559Transaction.nonce;
        } else {
            const maxBaseFeeInFutureBlock = FlashbotsBundleProvider.getMaxBaseFeeInFutureBlock(block.baseFeePerGas, FUTURE_BLOCKS);
            console.log("Block Base fee: ", block.baseFeePerGas);
            console.log("max fee per gas: ", PIORITY_FEE + maxBaseFeeInFutureBlock);
            eip1559Transaction = {
                to: CONTRACT_ADDRESS,
                type: 2,
                maxFeePerGas: PIORITY_FEE + maxBaseFeeInFutureBlock,
                maxPriorityFeePerGas: PIORITY_FEE,
                gasLimit: 21000,
                data: CALL_DATA,
                chainId: CHAIN_ID
            }
        }
        const signedTransactions = await flashbotsProvider.signBundle([
            {
                signer: wallet,
                transaction: legacyTransaction
            },
            {
                signer: wallet,
                transaction: eip1559Transaction
            }
        ]);

        const targetBlock = blockNumber + FUTURE_BLOCKS;
        const simulation = await flashbotsProvider.simulate(signedTransactions, targetBlock);

        if ('error' in simulation) {
            console.warn(`Simulation Error: ${simulation.error.message}`);
            process.exit(1);
        } else {
            console.log(`Simulation Success: ${JSON.stringify(simulation, null, 2)}`);
        }

        const bundleSubmission = await flashbotsProvider.sendRawBundle(signedTransactions, targetBlock, { replacementUuid });
        console.log("waiting for bundle submission");

        if ('error' in bundleSubmission) {
            throw new Error(bundleSubmission.error.message);
        }

        const cancelResult = await flashbotsProvider.cancelBundles(replacementUuid);
        console.log("cancel response", cancelResult);

        const waitResult = await bundleSubmission.wait();
        console.log("wait result: ", FlashbotsBundleResolution[waitResult]);

        if (waitResult === FlashbotsBundleResolution.BundleIncluded || waitResult === FlashbotsBundleResolution.AccountNonceTooHigh) {
            process.exit(0);
        } else {
            console.log({
                bundleStats: await flashbotsProvider.getBundleStatsV2(simulation.bundleHash, targetBlock),
                userStats: await userStats
            });
        }
    });
}

main();