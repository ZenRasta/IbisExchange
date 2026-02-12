import { toNano, Address } from '@ton/core';
import { JettonEscrow } from '../build/JettonEscrow/tact_JettonEscrow';
import { NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    // Fee recipient wallet — 0.5% of every transaction goes here
    const owner = Address.parse('UQDVundtAWYd0MSaDK--_ACsHHjYZIIIDGsAKlLEuJ-IMAQH');

    // Arbiter for dispute resolution (same as owner for now)
    const arbiter = owner;

    // USDT Jetton wallet — placeholder, must derive after deploy
    // Deploy first, then run getEscrowJettonWallet.ts to get the correct address
    const jettonWalletPlaceholder = Address.parse('EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs');

    // 50 basis points = 0.5% fee
    const feeBps = 50n;

    const escrow = provider.open(await JettonEscrow.fromInit(
        owner,
        arbiter,
        jettonWalletPlaceholder,
        feeBps,
    ));

    await escrow.send(provider.sender(), { value: toNano('0.05') },
        { $$type: 'Deploy', queryId: 0n });
    await provider.waitForDeploy(escrow.address);

    console.log('');
    console.log('Escrow deployed at:', escrow.address.toString());
    console.log('Owner (fee wallet):', owner.toString());
    console.log('Fee: 0.5% (50 basis points)');
    console.log('');
    console.log('NEXT STEP: Run getEscrowJettonWallet.ts with the deployed address:');
    console.log(`  npx tsx scripts/getEscrowJettonWallet.ts ${escrow.address.toString()}`);
    console.log('Then update ESCROW_CONTRACT_ADDRESS in .env');
}
