import { TonClient, JettonMaster, Address } from '@ton/ton';

// USDT master contract on mainnet
const USDT_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';

async function main() {
    const escrowAddress = process.argv[2];
    if (!escrowAddress) {
        console.error('Usage: npx tsx scripts/getEscrowJettonWallet.ts <ESCROW_ADDRESS>');
        console.error('  Pass the deployed escrow contract address as argument');
        process.exit(1);
    }

    const endpoint = process.argv[3] || 'https://testnet.toncenter.com/api/v2/jsonRPC';

    console.log('Querying USDT master contract for Jetton wallet address...');
    console.log('Escrow address:', escrowAddress);
    console.log('Endpoint:', endpoint);

    const client = new TonClient({ endpoint });

    const master = client.open(JettonMaster.create(Address.parse(USDT_MASTER)));
    const jettonWallet = await master.getWalletAddress(Address.parse(escrowAddress));

    console.log('');
    console.log('Escrow Jetton Wallet:', jettonWallet.toString());
    console.log('');
    console.log('Use this address as the jettonWallet parameter when deploying the escrow contract.');
}

main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
});
