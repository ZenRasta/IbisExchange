/**
 * Mainnet deployment script for JettonEscrow.
 *
 * Usage:
 *   Step 1 — Generate wallet & get funding address:
 *     npx tsx scripts/deploy-mainnet.ts
 *
 *   Step 2 — After funding, deploy with the mnemonic:
 *     DEPLOY_MNEMONIC="word1 word2 ... word24" npx tsx scripts/deploy-mainnet.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root
config({ path: resolve(__dirname, '../../../.env') });

import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto';
import { TonClient, WalletContractV4, JettonMaster, internal } from '@ton/ton';
import { toNano, Address, beginCell } from '@ton/core';
import { JettonEscrow, storeSetJettonWallet, storeDeploy } from '../build/JettonEscrow/tact_JettonEscrow';

// Mainnet USDT Jetton master
const USDT_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';

const TONCENTER_API_KEY = process.env.TONCENTER_API_KEY || '';

function sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
}

/** Retry wrapper for TonCenter API calls that may hit rate limits */
async function withRetry<T>(fn: () => Promise<T>, retries = 5, delayMs = 3000): Promise<T> {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err: any) {
            const is429 = err?.response?.status === 429 || err?.status === 429 || String(err).includes('429');
            if (is429 && i < retries - 1) {
                const wait = delayMs * (i + 1);
                console.log(`  Rate limited, retrying in ${wait / 1000}s...`);
                await sleep(wait);
                continue;
            }
            throw err;
        }
    }
    throw new Error('Retry exhausted');
}

async function main() {
    console.log('API key loaded:', TONCENTER_API_KEY ? 'yes' : 'NO (will be rate-limited!)');

    const mnemonic = process.env.DEPLOY_MNEMONIC?.split(' ');

    // --- Step 1: No mnemonic → generate wallet and show address ---
    if (!mnemonic || mnemonic.length < 24) {
        const newMnemonic = await mnemonicNew();
        const keypair = await mnemonicToPrivateKey(newMnemonic);
        const wallet = WalletContractV4.create({ publicKey: keypair.publicKey, workchain: 0 });

        console.log('');
        console.log('=== MAINNET DEPLOY — STEP 1: FUND THE WALLET ===');
        console.log('');
        console.log('Wallet address:', wallet.address.toString());
        console.log('');
        console.log('Send at least 0.5 TON to the address above.');
        console.log('(~0.1 TON for deploy + 0.06 TON per escrow release + gas reserve)');
        console.log('');
        console.log('Mnemonic (SAVE THIS — you will need it for step 2):');
        console.log(newMnemonic.join(' '));
        console.log('');
        console.log('After funding, run:');
        console.log(`  DEPLOY_MNEMONIC="${newMnemonic.join(' ')}" npx tsx scripts/deploy-mainnet.ts`);
        console.log('');
        return;
    }

    // --- Step 2: Mnemonic provided → deploy ---
    console.log('Connecting to TON mainnet...');
    const client = new TonClient({
        endpoint: 'https://toncenter.com/api/v2/jsonRPC',
        apiKey: TONCENTER_API_KEY || undefined,
    });

    const keypair = await mnemonicToPrivateKey(mnemonic);
    const wallet = client.open(
        WalletContractV4.create({ publicKey: keypair.publicKey, workchain: 0 })
    );
    const walletAddress = wallet.address;

    console.log('Deployer wallet:', walletAddress.toString());
    const balance = await withRetry(() => client.getBalance(walletAddress));
    console.log('Balance:', Number(balance) / 1e9, 'TON');

    if (balance < toNano('0.3')) {
        console.error('Insufficient balance. Need at least 0.3 TON. Send more TON to:', walletAddress.toString());
        return;
    }

    // The deployer wallet is both the owner (fee recipient) and arbiter (dispute resolver).
    const owner = walletAddress;
    const arbiter = walletAddress;
    const feeBps = 50n; // 0.5%

    // Use owner address as placeholder for jettonWallet (will be updated post-deploy)
    const jettonWalletPlaceholder = owner;

    console.log('');
    console.log('Computing contract address...');
    const escrow = client.open(await JettonEscrow.fromInit(
        owner, arbiter, jettonWalletPlaceholder, feeBps,
    ));
    const escrowAddress = escrow.address;
    console.log('Escrow will deploy at:', escrowAddress.toString());

    // --- Deploy ---
    console.log('');
    console.log('Sending deploy transaction...');
    let seqno = await withRetry(() => wallet.getSeqno());

    await withRetry(() => wallet.sendTransfer({
        secretKey: keypair.secretKey,
        seqno,
        messages: [internal({
            to: escrowAddress,
            value: toNano('0.1'),
            init: escrow.init,
            body: beginCell().store(storeDeploy({ $$type: 'Deploy', queryId: 0n })).endCell(),
        })],
    }));

    console.log('Deploy transaction sent!');

    // Wait for deploy confirmation
    console.log('Waiting for deployment...');
    let deployed = false;
    for (let i = 0; i < 60; i++) {
        await sleep(5000);
        try {
            const state = await client.getContractState(escrowAddress);
            if (state.state === 'active') {
                deployed = true;
                console.log('Contract deployed!');
                break;
            }
        } catch {}
        if (i % 5 === 4) console.log(`  Still waiting... (${(i + 1) * 5}s)`);
    }

    if (!deployed) {
        console.error('Deploy timed out. Check manually on tonscan.org:', escrowAddress.toString());
        return;
    }

    // --- Derive the escrow's USDT Jetton wallet address ---
    console.log('');
    console.log('Deriving USDT Jetton wallet address for the escrow...');
    await sleep(3000);
    let jettonWalletAddress: Address;
    try {
        const master = client.open(JettonMaster.create(Address.parse(USDT_MASTER)));
        jettonWalletAddress = await withRetry(() => master.getWalletAddress(escrowAddress));
        console.log('Escrow Jetton Wallet:', jettonWalletAddress.toString());
    } catch (err) {
        console.error('Failed to derive Jetton wallet address:', err);
        console.log('You can try manually later:');
        console.log(`  npx tsx scripts/getEscrowJettonWallet.ts ${escrowAddress.toString()} https://toncenter.com/api/v2/jsonRPC`);
        return;
    }

    // --- Send SetJettonWallet to the contract ---
    console.log('');
    console.log('Setting Jetton wallet on the contract...');
    await sleep(5000);
    seqno = await withRetry(() => wallet.getSeqno());

    await withRetry(() => wallet.sendTransfer({
        secretKey: keypair.secretKey,
        seqno,
        messages: [internal({
            to: escrowAddress,
            value: toNano('0.05'),
            body: beginCell().store(storeSetJettonWallet({ $$type: 'SetJettonWallet', newJettonWallet: jettonWalletAddress })).endCell(),
        })],
    }));

    console.log('SetJettonWallet transaction sent!');

    // Wait for confirmation
    console.log('Waiting for SetJettonWallet confirmation...');
    let walletSet = false;
    for (let i = 0; i < 30; i++) {
        await sleep(5000);
        try {
            const storedWallet = await escrow.getJettonWalletAddress();
            if (storedWallet.equals(jettonWalletAddress)) {
                walletSet = true;
                console.log('Jetton wallet set successfully!');
                break;
            }
        } catch {}
        if (i % 5 === 4) console.log(`  Still waiting... (${(i + 1) * 5}s)`);
    }

    if (!walletSet) {
        console.log('');
        console.log('WARNING: Could not confirm jetton wallet was set.');
        console.log('The transaction may still be pending. Check on tonscan.org.');
    }

    // --- Done ---
    console.log('');
    console.log('=======================================================');
    console.log('  MAINNET DEPLOYMENT COMPLETE');
    console.log('=======================================================');
    console.log('');
    console.log('  Escrow contract:', escrowAddress.toString());
    console.log('  Owner/Arbiter:  ', walletAddress.toString());
    console.log('  Jetton wallet:  ', jettonWalletAddress.toString());
    console.log('  Fee:             0.5% (50 bps)');
    console.log('');
    console.log('  Update your .env:');
    console.log(`    ESCROW_CONTRACT_ADDRESS=${escrowAddress.toString()}`);
    console.log(`    VITE_ESCROW_CONTRACT_ADDRESS=${escrowAddress.toString()}`);
    console.log('');
    console.log('  IMPORTANT: Save your mnemonic securely!');
    console.log('  This wallet is the contract owner and arbiter.');
    console.log('=======================================================');
}

main().catch(console.error);
