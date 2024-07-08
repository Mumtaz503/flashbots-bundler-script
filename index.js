const { ethers, Wallet } = require( "ethers" );
const { FlashbotsBundleProvider, FlashbotsBundleResolution } = require( "@flashbots/ethers-provider-bundle" );
require( "dotenv" ).config();

const provider = new ethers.JsonRpcProvider( process.env.SEPOLIA_RPC_URL );
const webSocketProvider = new ethers.WebSocketProvider( process.env.SEPOLIA_WEB_SOCKET );

const ADDRESS = "0x70cf5eCf9c36024C56a19242FE8bb596bB700589";

const authSigner = new Wallet( process.env.PRIVATE_KEY, provider );
const sepoliaFlashbotsRelay = "https://relay-sepolia.flashbots.net";

const functionSignature = 'decimals()';
const functionSignatureHash = ethers.keccak256( ethers.toUtf8Bytes( functionSignature ) );
const functionSelector = functionSignatureHash.slice( 0, 10 ); //first 4 bytes represent the function selector

const startTransmission = async () =>
{
    const flashbotsProvider = await FlashbotsBundleProvider.create( provider, authSigner, sepoliaFlashbotsRelay );

    const GWEI = BigInt( 10 ** 10 );
    const LEGACY_GAS_PRICE = GWEI * 30n;
    const PRIORITY_FEE = GWEI * 13n;
    const blockNumber = await provider.getBlockNumber();
    const block = await provider.getBlock();
    const maxBaseFeeInFutureBlock = FlashbotsBundleProvider.getMaxBaseFeeInFutureBlock( block.baseFeePerGas, 6 );
    const payLoad = functionSelector;

    console.log( `Max fee in future Block: ${String( maxBaseFeeInFutureBlock )}` );

    const signedTransactions = await flashbotsProvider.signBundle( [
        {
            signer: authSigner,
            transaction: {
                to: ADDRESS,
                type: 2,
                maxFeePerGas: PRIORITY_FEE + maxBaseFeeInFutureBlock,
                maxPriorityFeePerGas: PRIORITY_FEE,
                data: payLoad,
                chainId: 11155111,
                // value: ethers.parseEther(amountInEther),
            },
        },
        {
            signer: authSigner,
            transaction: {
                to: ADDRESS,
                gasPrice: LEGACY_GAS_PRICE,
                data: payLoad,
                // value: ethers.parseEther(amountInEther),
                chainId: 11155111
            }
        }
    ] );

    console.log( "Date Before: ", new Date() );
    console.log( "Running simulation" );

    const simulation = await flashbotsProvider.simulate( signedTransactions, blockNumber + 1 );
    console.log( "Date After: ", new Date() );

    if ( simulation.firstRevert )
    {
        console.error( `Simulation Error: ${simulation.firstRevert.error}` );
    } else
    {
        console.log( `Simulation success. Block Number ${blockNumber}` );
    }

    // Send 10 bundles to get this working for the next blocks in case flashbots doesn't become the block creator
    for ( let i = 1; i <= 10; i++ )
    {
        const bundleSubmission = await flashbotsProvider.sendRawBundle( signedTransactions, blockNumber + i );
        console.log( `Bundle Submitted awaiting response, ${bundleSubmission.bundleHash}` );

        const waitRes = await bundleSubmission.wait();
        console.log( `Wait response: ${FlashbotsBundleResolution[ waitRes ]}` );

        if ( waitRes === FlashbotsBundleResolution.BundleIncluded || waitRes === FlashbotsBundleResolution.AccountNonceTooHigh )
        {
            console.log( "Bundle included" );
            process.exit( 0 );
        } else
        {
            console.log( {
                bundleStats: await flashbotsProvider.getBundleStatsV2( simulation.bundleHash, blockNumber + 1 ),
                userStats: await flashbotsProvider.getUserStatsV2(),
            } );
        }
    }
    console.log( 'Bundles submitted successfully.' );
};

startTransmission().catch( console.error );