/**
 * Non-interactive testnet deployment script for JettonEscrow.
 * Generates a new wallet, requests testnet TON, and deploys.
 */
import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto';
import { TonClient, WalletContractV4, internal } from '@ton/ton';
import { toNano, Address } from '@ton/core';
import { JettonEscrow } from '../build/JettonEscrow/tact_JettonEscrow';

const TONCENTER_API_KEY = process.env.TONCENTER_API_KEY || '';
const USDT_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';

async function sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
}

async function main() {
    const endpoint = 'https://testnet.toncenter.com/api/v2/jsonRPC';
    const client = new TonClient({
        endpoint,
        apiKey: TONCENTER_API_KEY || undefined,
    });

    // Step 1: Generate a new testnet wallet
    console.log('Generating deployment wallet...');
    const mnemonic = await mnemonicNew();
    const keypair = await mnemonicToPrivateKey(mnemonic);
    const wallet = client.open(
        WalletContractV4.create({ publicKey: keypair.publicKey, workchain: 0 })
    );
    const walletAddress = wallet.address.toString();

    console.log('Wallet address:', walletAddress);
    console.log('Mnemonic (SAVE THIS):', mnemonic.join(' '));
    console.log('');

    // Step 2: Request testnet TON
    console.log('Requesting testnet TON from faucet...');
    try {
        const faucetRes = await fetch('https://testnet.toncenter.com/api/v2/sendBoc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        // Testnet faucet might not work via API; try the Telegram bot
    } catch {}

    // Try the Telegram faucet bot API
    try {
        const res = await fetch(`https://testnet.tonhub.com/faucet?address=${encodeURIComponent(walletAddress)}`, {
            method: 'POST',
        });
        if (res.ok) {
            console.log('Faucet request sent! Waiting for TON...');
        }
    } catch {}

    // Also try the official faucet
    try {
        const res = await fetch(`https://faucet.toncenter.com/api/v1/faucet?address=${encodeURIComponent(walletAddress)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) {
            console.log('Official faucet request sent!');
        }
    } catch {}

    // Wait for balance
    console.log('Waiting for testnet TON to arrive (up to 60 seconds)...');
    let balance = 0n;
    for (let i = 0; i < 30; i++) {
        await sleep(2000);
        try {
            balance = await client.getBalance(wallet.address);
            if (balance > 0n) {
                console.log(`Balance received: ${Number(balance) / 1e9} TON`);
                break;
            }
        } catch {}
        if (i % 5 === 4) console.log(`  Still waiting... (${(i + 1) * 2}s)`);
    }

    if (balance === 0n) {
        console.log('');
        console.log('Could not get testnet TON automatically.');
        console.log('Please send testnet TON to:', walletAddress);
        console.log('You can use: https://t.me/testgiver_ton_bot');
        console.log('Or: https://faucet.toncenter.com/');
        console.log('');
        console.log('After funding, re-run this script with the mnemonic:');
        console.log('  DEPLOY_MNEMONIC="' + mnemonic.join(' ') + '" npx tsx scripts/deploy-testnet.ts');
        return;
    }

    // Step 3: Deploy JettonEscrow
    console.log('');
    console.log('Deploying JettonEscrow...');

    const owner = wallet.address; // Use deployer wallet as owner
    const arbiter = owner;
    const feeBps = 50n;

    // Use USDT master as placeholder for jettonWallet (will need update)
    const jettonWalletPlaceholder = Address.parse(USDT_MASTER);

    const escrow = client.open(await JettonEscrow.fromInit(
        owner,
        arbiter,
        jettonWalletPlaceholder,
        feeBps,
    ));

    const escrowAddress = escrow.address.toString();
    console.log('Escrow will be deployed at:', escrowAddress);

    // Send deploy transaction
    const seqno = await wallet.getSeqno();
    await wallet.sendTransfer({
        secretKey: keypair.secretKey,
        seqno,
        messages: [internal({
            to: escrow.address,
            value: toNano('0.05'),
            init: escrow.init,
            body: escrow.abi?.pack('Deploy', { queryId: 0n }),
        })],
    });

    // Wait for deployment
    console.log('Waiting for deployment confirmation...');
    for (let i = 0; i < 30; i++) {
        await sleep(2000);
        try {
            const state = await client.getContractState(escrow.address);
            if (state.state === 'active') {
                console.log('');
                console.log('=== DEPLOYMENT SUCCESSFUL ===');
                console.log('Escrow address:', escrowAddress);
                console.log('Owner:', owner.toString());
                console.log('Fee: 0.5% (50 bps)');
                console.log('');

                // Step 4: Derive the escrow's Jetton wallet address
                console.log('Deriving USDT Jetton wallet address...');
                const { JettonMaster } = require('@ton/ton');
                const master = client.open(JettonMaster.create(Address.parse(USDT_MASTER)));
                try {
                    const jettonWallet = await master.getWalletAddress(escrow.address);
                    console.log('Escrow Jetton Wallet:', jettonWallet.toString());
                    console.log('');
                    console.log('=== UPDATE .env WITH THESE VALUES ===');
                    console.log(`ESCROW_CONTRACT_ADDRESS=${escrowAddress}`);
                    console.log(`VITE_ESCROW_CONTRACT_ADDRESS=${escrowAddress}`);
                } catch (err) {
                    console.log('Could not derive Jetton wallet (contract may not be indexed yet).');
                    console.log('Run manually: npx tsx scripts/getEscrowJettonWallet.ts', escrowAddress);
                }
                return;
            }
        } catch {}
        if (i % 5 === 4) console.log(`  Still deploying... (${(i + 1) * 2}s)`);
    }

    console.log('Deployment may still be pending. Check manually:');
    console.log(`  https://testnet.tonscan.org/address/${escrowAddress}`);
}

// Allow passing mnemonic via env for re-runs
async function mainWithExistingMnemonic() {
    const mnemonic = process.env.DEPLOY_MNEMONIC?.split(' ');
    if (!mnemonic || mnemonic.length < 24) {
        return main();
    }

    const endpoint = 'https://testnet.toncenter.com/api/v2/jsonRPC';
    const client = new TonClient({
        endpoint,
        apiKey: TONCENTER_API_KEY || undefined,
    });

    const keypair = await mnemonicToPrivateKey(mnemonic);
    const wallet = client.open(
        WalletContractV4.create({ publicKey: keypair.publicKey, workchain: 0 })
    );

    console.log('Using existing wallet:', wallet.address.toString());
    const balance = await client.getBalance(wallet.address);
    console.log('Balance:', Number(balance) / 1e9, 'TON');

    if (balance < toNano('0.1')) {
        console.log('Insufficient balance for deployment. Need at least 0.1 TON.');
        return;
    }

    const owner = wallet.address;
    const arbiter = owner;
    const feeBps = 50n;
    const jettonWalletPlaceholder = Address.parse(USDT_MASTER);

    const escrow = client.open(await JettonEscrow.fromInit(
        owner, arbiter, jettonWalletPlaceholder, feeBps,
    ));

    console.log('Deploying to:', escrow.address.toString());

    const seqno = await wallet.getSeqno();
    await wallet.sendTransfer({
        secretKey: keypair.secretKey,
        seqno,
        messages: [internal({
            to: escrow.address,
            value: toNano('0.05'),
            init: escrow.init,
        })],
    });

    console.log('Deploy transaction sent. Waiting...');
    for (let i = 0; i < 30; i++) {
        await sleep(2000);
        try {
            const state = await client.getContractState(escrow.address);
            if (state.state === 'active') {
                console.log('');
                console.log('=== DEPLOYED ===');
                console.log(`ESCROW_CONTRACT_ADDRESS=${escrow.address.toString()}`);
                return;
            }
        } catch {}
    }
    console.log('Check deployment status manually.');
}

mainWithExistingMnemonic().catch(console.error);
