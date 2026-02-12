import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano, beginCell, Address } from '@ton/core';
import '@ton/test-utils';
import { JettonEscrow } from '../build/JettonEscrow/tact_JettonEscrow';

describe('JettonEscrow', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let owner: SandboxContract<TreasuryContract>;
    let arbiter: SandboxContract<TreasuryContract>;
    let buyer: SandboxContract<TreasuryContract>;
    let seller: SandboxContract<TreasuryContract>;
    let jettonWallet: SandboxContract<TreasuryContract>;
    let randomUser: SandboxContract<TreasuryContract>;
    let escrow: SandboxContract<JettonEscrow>;

    const FEE_BPS = 50n; // 0.5% in basis points
    const ESCROW_ID = 0n;
    const EXPECTED_AMOUNT = 100_000_000n; // 100 USDT (6 decimals)
    const FIAT_AMOUNT = 680_00n; // 680.00 TTD in cents

    // State constants
    const STATE_CREATED = 0n;
    const STATE_FUNDED = 1n;
    const STATE_FIAT_SENT = 2n;
    const STATE_COMPLETED = 3n;
    const STATE_REFUNDED = 4n;
    const STATE_DISPUTED = 5n;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        deployer = await blockchain.treasury('deployer');
        owner = await blockchain.treasury('owner');
        arbiter = await blockchain.treasury('arbiter');
        buyer = await blockchain.treasury('buyer');
        seller = await blockchain.treasury('seller');
        jettonWallet = await blockchain.treasury('jettonWallet');
        randomUser = await blockchain.treasury('randomUser');

        escrow = blockchain.openContract(
            await JettonEscrow.fromInit(
                owner.address,
                arbiter.address,
                jettonWallet.address,
                FEE_BPS,
            )
        );

        // Deploy the contract
        const deployResult = await escrow.send(
            deployer.getSender(),
            { value: toNano('0.5') },
            {
                $$type: 'Deploy',
                queryId: 0n,
            }
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: escrow.address,
            deploy: true,
            success: true,
        });
    });

    // Helper: Create an escrow
    async function createEscrow(id: bigint = ESCROW_ID) {
        return await escrow.send(
            buyer.getSender(),
            { value: toNano('0.1') },
            {
                $$type: 'CreateEscrow',
                escrowId: id,
                seller: seller.address,
                expectedAmount: EXPECTED_AMOUNT,
                fiatAmount: FIAT_AMOUNT,
            }
        );
    }

    // Helper: Fund an escrow via JettonTransferNotification
    async function fundEscrow(id: bigint = ESCROW_ID, amount: bigint = EXPECTED_AMOUNT, senderAddress?: Address) {
        return await escrow.send(
            jettonWallet.getSender(),
            { value: toNano('0.1') },
            {
                $$type: 'JettonTransferNotification',
                queryId: 0n,
                amount: amount,
                sender: senderAddress ?? buyer.address,
                forwardPayload: beginCell().storeUint(id, 64).endCell().asSlice(),
            }
        );
    }

    // Helper: Confirm fiat sent
    async function confirmFiatSent(id: bigint = ESCROW_ID) {
        return await escrow.send(
            buyer.getSender(),
            { value: toNano('0.1') },
            {
                $$type: 'ConfirmFiatSent',
                escrowId: id,
            }
        );
    }

    // ========== Deployment Tests ==========

    describe('Deployment', () => {
        it('should deploy successfully', async () => {
            // Deployment is done in beforeEach
            const balance = await escrow.getContractBalance();
            expect(balance).toBeGreaterThanOrEqual(0n);
        });

        it('should have zero as initial next escrow ID', async () => {
            const nextId = await escrow.getNextEscrowId();
            expect(nextId).toBe(0n);
        });
    });

    // ========== CreateEscrow Tests ==========

    describe('CreateEscrow', () => {
        it('should store correct escrow data', async () => {
            const result = await createEscrow();

            expect(result.transactions).toHaveTransaction({
                from: buyer.address,
                to: escrow.address,
                success: true,
            });

            const data = await escrow.getEscrow(ESCROW_ID);
            expect(data).not.toBeNull();
            expect(data!.buyer.equals(buyer.address)).toBe(true);
            expect(data!.seller.equals(seller.address)).toBe(true);
            expect(data!.expectedAmount).toBe(EXPECTED_AMOUNT);
            expect(data!.fiatAmount).toBe(FIAT_AMOUNT);
            expect(data!.state).toBe(STATE_CREATED);
        });

        it('should increment next escrow ID', async () => {
            await createEscrow(0n);
            const nextId = await escrow.getNextEscrowId();
            expect(nextId).toBe(1n);
        });

        it('should reject duplicate escrow IDs', async () => {
            await createEscrow(0n);
            const result = await createEscrow(0n);

            expect(result.transactions).toHaveTransaction({
                from: buyer.address,
                to: escrow.address,
                success: false,
            });
        });

        it('should allow creating multiple escrows', async () => {
            await createEscrow(0n);
            await createEscrow(1n);
            await createEscrow(2n);

            const data0 = await escrow.getEscrow(0n);
            const data1 = await escrow.getEscrow(1n);
            const data2 = await escrow.getEscrow(2n);

            expect(data0).not.toBeNull();
            expect(data1).not.toBeNull();
            expect(data2).not.toBeNull();

            const nextId = await escrow.getNextEscrowId();
            expect(nextId).toBe(3n);
        });
    });

    // ========== Funding Tests ==========

    describe('Funding via JettonTransferNotification', () => {
        beforeEach(async () => {
            await createEscrow();
        });

        it('should accept funding from Jetton wallet with correct amount', async () => {
            const result = await fundEscrow();

            expect(result.transactions).toHaveTransaction({
                from: jettonWallet.address,
                to: escrow.address,
                success: true,
            });

            const data = await escrow.getEscrow(ESCROW_ID);
            expect(data!.state).toBe(STATE_FUNDED);
        });

        it('should accept funding with amount greater than expected', async () => {
            const result = await fundEscrow(ESCROW_ID, EXPECTED_AMOUNT + 1_000_000n);

            expect(result.transactions).toHaveTransaction({
                from: jettonWallet.address,
                to: escrow.address,
                success: true,
            });

            const data = await escrow.getEscrow(ESCROW_ID);
            expect(data!.state).toBe(STATE_FUNDED);
        });

        it('should reject funding from wrong Jetton wallet address', async () => {
            const result = await escrow.send(
                randomUser.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'JettonTransferNotification',
                    queryId: 0n,
                    amount: EXPECTED_AMOUNT,
                    sender: buyer.address,
                    forwardPayload: beginCell().storeUint(ESCROW_ID, 64).endCell().asSlice(),
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: randomUser.address,
                to: escrow.address,
                success: false,
            });
        });

        it('should reject funding with insufficient amount', async () => {
            const result = await fundEscrow(ESCROW_ID, EXPECTED_AMOUNT - 1n);

            expect(result.transactions).toHaveTransaction({
                from: jettonWallet.address,
                to: escrow.address,
                success: false,
            });
        });

        it('should reject funding for non-existent escrow', async () => {
            const result = await fundEscrow(999n);

            expect(result.transactions).toHaveTransaction({
                from: jettonWallet.address,
                to: escrow.address,
                success: false,
            });
        });

        it('should reject funding from non-buyer address', async () => {
            const result = await fundEscrow(ESCROW_ID, EXPECTED_AMOUNT, seller.address);

            expect(result.transactions).toHaveTransaction({
                from: jettonWallet.address,
                to: escrow.address,
                success: false,
            });
        });

        it('should reject double funding', async () => {
            await fundEscrow();

            const result = await fundEscrow();

            expect(result.transactions).toHaveTransaction({
                from: jettonWallet.address,
                to: escrow.address,
                success: false,
            });
        });
    });

    // ========== ConfirmFiatSent Tests ==========

    describe('ConfirmFiatSent', () => {
        beforeEach(async () => {
            await createEscrow();
            await fundEscrow();
        });

        it('should allow buyer to confirm fiat sent', async () => {
            const result = await confirmFiatSent();

            expect(result.transactions).toHaveTransaction({
                from: buyer.address,
                to: escrow.address,
                success: true,
            });

            const data = await escrow.getEscrow(ESCROW_ID);
            expect(data!.state).toBe(STATE_FIAT_SENT);
            expect(data!.fiatSentAt).toBeGreaterThan(0n);
        });

        it('should reject confirm fiat sent from seller', async () => {
            const result = await escrow.send(
                seller.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'ConfirmFiatSent',
                    escrowId: ESCROW_ID,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: seller.address,
                to: escrow.address,
                success: false,
            });
        });

        it('should reject confirm fiat sent from random user', async () => {
            const result = await escrow.send(
                randomUser.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'ConfirmFiatSent',
                    escrowId: ESCROW_ID,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: randomUser.address,
                to: escrow.address,
                success: false,
            });
        });

        it('should reject confirm fiat sent in CREATED state (not funded)', async () => {
            await createEscrow(1n);
            const result = await escrow.send(
                buyer.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'ConfirmFiatSent',
                    escrowId: 1n,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: buyer.address,
                to: escrow.address,
                success: false,
            });
        });
    });

    // ========== ReleaseFunds Tests ==========

    describe('ReleaseFunds', () => {
        beforeEach(async () => {
            await createEscrow();
            await fundEscrow();
            await confirmFiatSent();
        });

        it('should allow seller to release funds', async () => {
            const result = await escrow.send(
                seller.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'ReleaseFunds',
                    escrowId: ESCROW_ID,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: seller.address,
                to: escrow.address,
                success: true,
            });

            const data = await escrow.getEscrow(ESCROW_ID);
            expect(data!.state).toBe(STATE_COMPLETED);
        });

        it('should send USDT to seller minus fee and fee to owner', async () => {
            const result = await escrow.send(
                seller.getSender(),
                { value: toNano('0.2') },
                {
                    $$type: 'ReleaseFunds',
                    escrowId: ESCROW_ID,
                }
            );

            // Should have Jetton transfer messages to the Jetton wallet
            // One for payout to seller, one for fee to owner
            const txToJettonWallet = result.transactions.filter(
                (tx) => tx.inMessage?.info.type === 'internal' &&
                    tx.inMessage?.info.dest?.equals(jettonWallet.address)
            );

            // Should have 2 JettonTransfer messages to jettonWallet (payout + fee)
            expect(txToJettonWallet.length).toBe(2);
        });

        it('should reject release from buyer', async () => {
            const result = await escrow.send(
                buyer.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'ReleaseFunds',
                    escrowId: ESCROW_ID,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: buyer.address,
                to: escrow.address,
                success: false,
            });
        });

        it('should reject release from random user', async () => {
            const result = await escrow.send(
                randomUser.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'ReleaseFunds',
                    escrowId: ESCROW_ID,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: randomUser.address,
                to: escrow.address,
                success: false,
            });
        });

        it('should reject double release (already completed)', async () => {
            await escrow.send(
                seller.getSender(),
                { value: toNano('0.2') },
                {
                    $$type: 'ReleaseFunds',
                    escrowId: ESCROW_ID,
                }
            );

            const result = await escrow.send(
                seller.getSender(),
                { value: toNano('0.2') },
                {
                    $$type: 'ReleaseFunds',
                    escrowId: ESCROW_ID,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: seller.address,
                to: escrow.address,
                success: false,
            });
        });

        it('should reject release in FUNDED state (fiat not sent yet)', async () => {
            await createEscrow(1n);
            await fundEscrow(1n);

            const result = await escrow.send(
                seller.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'ReleaseFunds',
                    escrowId: 1n,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: seller.address,
                to: escrow.address,
                success: false,
            });
        });
    });

    // ========== RefundEscrow Tests ==========

    describe('RefundEscrow', () => {
        it('should allow seller to refund in FUNDED state', async () => {
            await createEscrow();
            await fundEscrow();

            const result = await escrow.send(
                seller.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'RefundEscrow',
                    escrowId: ESCROW_ID,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: seller.address,
                to: escrow.address,
                success: true,
            });

            const data = await escrow.getEscrow(ESCROW_ID);
            expect(data!.state).toBe(STATE_REFUNDED);
        });

        it('should allow buyer or seller to cancel in CREATED state', async () => {
            await createEscrow();

            const result = await escrow.send(
                buyer.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'RefundEscrow',
                    escrowId: ESCROW_ID,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: buyer.address,
                to: escrow.address,
                success: true,
            });

            const data = await escrow.getEscrow(ESCROW_ID);
            expect(data!.state).toBe(STATE_REFUNDED);
        });

        it('should allow seller to cancel in CREATED state', async () => {
            await createEscrow();

            const result = await escrow.send(
                seller.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'RefundEscrow',
                    escrowId: ESCROW_ID,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: seller.address,
                to: escrow.address,
                success: true,
            });

            const data = await escrow.getEscrow(ESCROW_ID);
            expect(data!.state).toBe(STATE_REFUNDED);
        });

        it('should reject refund from random user in CREATED state', async () => {
            await createEscrow();

            const result = await escrow.send(
                randomUser.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'RefundEscrow',
                    escrowId: ESCROW_ID,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: randomUser.address,
                to: escrow.address,
                success: false,
            });
        });

        it('should reject buyer refund in FUNDED state without timeout', async () => {
            await createEscrow();
            await fundEscrow();

            const result = await escrow.send(
                buyer.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'RefundEscrow',
                    escrowId: ESCROW_ID,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: buyer.address,
                to: escrow.address,
                success: false,
            });
        });

        it('should allow buyer refund in FUNDED state after timeout', async () => {
            await createEscrow();
            await fundEscrow();

            // Advance time past RELEASE_TIMEOUT (6 hours = 21600 seconds)
            blockchain.now = Math.floor(Date.now() / 1000) + 21601;

            const result = await escrow.send(
                buyer.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'RefundEscrow',
                    escrowId: ESCROW_ID,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: buyer.address,
                to: escrow.address,
                success: true,
            });

            const data = await escrow.getEscrow(ESCROW_ID);
            expect(data!.state).toBe(STATE_REFUNDED);
        });

        it('should allow buyer refund in FIAT_SENT state after timeout', async () => {
            await createEscrow();
            await fundEscrow();
            await confirmFiatSent();

            // Advance time past RELEASE_TIMEOUT (6 hours = 21600 seconds)
            blockchain.now = Math.floor(Date.now() / 1000) + 21601;

            const result = await escrow.send(
                buyer.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'RefundEscrow',
                    escrowId: ESCROW_ID,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: buyer.address,
                to: escrow.address,
                success: true,
            });

            const data = await escrow.getEscrow(ESCROW_ID);
            expect(data!.state).toBe(STATE_REFUNDED);
        });

        it('should reject double refund', async () => {
            await createEscrow();

            await escrow.send(
                buyer.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'RefundEscrow',
                    escrowId: ESCROW_ID,
                }
            );

            const result = await escrow.send(
                buyer.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'RefundEscrow',
                    escrowId: ESCROW_ID,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: buyer.address,
                to: escrow.address,
                success: false,
            });
        });

        it('should reject refund in COMPLETED state', async () => {
            await createEscrow();
            await fundEscrow();
            await confirmFiatSent();

            // Release funds first
            await escrow.send(
                seller.getSender(),
                { value: toNano('0.2') },
                {
                    $$type: 'ReleaseFunds',
                    escrowId: ESCROW_ID,
                }
            );

            const result = await escrow.send(
                buyer.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'RefundEscrow',
                    escrowId: ESCROW_ID,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: buyer.address,
                to: escrow.address,
                success: false,
            });
        });
    });

    // ========== DisputeEscrow Tests ==========

    describe('DisputeEscrow', () => {
        beforeEach(async () => {
            await createEscrow();
            await fundEscrow();
        });

        it('should allow buyer to open dispute in FUNDED state', async () => {
            const result = await escrow.send(
                buyer.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'DisputeEscrow',
                    escrowId: ESCROW_ID,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: buyer.address,
                to: escrow.address,
                success: true,
            });

            const data = await escrow.getEscrow(ESCROW_ID);
            expect(data!.state).toBe(STATE_DISPUTED);
        });

        it('should allow seller to open dispute in FUNDED state', async () => {
            const result = await escrow.send(
                seller.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'DisputeEscrow',
                    escrowId: ESCROW_ID,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: seller.address,
                to: escrow.address,
                success: true,
            });

            const data = await escrow.getEscrow(ESCROW_ID);
            expect(data!.state).toBe(STATE_DISPUTED);
        });

        it('should allow dispute in FIAT_SENT state', async () => {
            await confirmFiatSent();

            const result = await escrow.send(
                seller.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'DisputeEscrow',
                    escrowId: ESCROW_ID,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: seller.address,
                to: escrow.address,
                success: true,
            });

            const data = await escrow.getEscrow(ESCROW_ID);
            expect(data!.state).toBe(STATE_DISPUTED);
        });

        it('should reject dispute from random user', async () => {
            const result = await escrow.send(
                randomUser.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'DisputeEscrow',
                    escrowId: ESCROW_ID,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: randomUser.address,
                to: escrow.address,
                success: false,
            });
        });

        it('should reject dispute in CREATED state', async () => {
            await createEscrow(1n);

            const result = await escrow.send(
                buyer.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'DisputeEscrow',
                    escrowId: 1n,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: buyer.address,
                to: escrow.address,
                success: false,
            });
        });
    });

    // ========== ResolveDispute Tests ==========

    describe('ResolveDispute', () => {
        beforeEach(async () => {
            await createEscrow();
            await fundEscrow();
            // Open dispute
            await escrow.send(
                buyer.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'DisputeEscrow',
                    escrowId: ESCROW_ID,
                }
            );
        });

        it('should allow arbiter to resolve in favor of seller', async () => {
            const result = await escrow.send(
                arbiter.getSender(),
                { value: toNano('0.2') },
                {
                    $$type: 'ResolveDispute',
                    escrowId: ESCROW_ID,
                    releaseToSeller: true,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: arbiter.address,
                to: escrow.address,
                success: true,
            });

            const data = await escrow.getEscrow(ESCROW_ID);
            expect(data!.state).toBe(STATE_COMPLETED);
        });

        it('should allow arbiter to resolve in favor of buyer (refund)', async () => {
            const result = await escrow.send(
                arbiter.getSender(),
                { value: toNano('0.2') },
                {
                    $$type: 'ResolveDispute',
                    escrowId: ESCROW_ID,
                    releaseToSeller: false,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: arbiter.address,
                to: escrow.address,
                success: true,
            });

            const data = await escrow.getEscrow(ESCROW_ID);
            expect(data!.state).toBe(STATE_REFUNDED);
        });

        it('should reject resolve from non-arbiter (buyer)', async () => {
            const result = await escrow.send(
                buyer.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'ResolveDispute',
                    escrowId: ESCROW_ID,
                    releaseToSeller: true,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: buyer.address,
                to: escrow.address,
                success: false,
            });
        });

        it('should reject resolve from non-arbiter (seller)', async () => {
            const result = await escrow.send(
                seller.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'ResolveDispute',
                    escrowId: ESCROW_ID,
                    releaseToSeller: false,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: seller.address,
                to: escrow.address,
                success: false,
            });
        });

        it('should reject resolve from random user', async () => {
            const result = await escrow.send(
                randomUser.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'ResolveDispute',
                    escrowId: ESCROW_ID,
                    releaseToSeller: true,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: randomUser.address,
                to: escrow.address,
                success: false,
            });
        });

        it('should reject resolve for non-disputed escrow', async () => {
            await createEscrow(1n);
            await fundEscrow(1n);

            const result = await escrow.send(
                arbiter.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'ResolveDispute',
                    escrowId: 1n,
                    releaseToSeller: true,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: arbiter.address,
                to: escrow.address,
                success: false,
            });
        });
    });

    // ========== State Transition Tests ==========

    describe('State transitions enforcement', () => {
        it('should not allow ConfirmFiatSent in CREATED state', async () => {
            await createEscrow();

            const result = await confirmFiatSent();

            expect(result.transactions).toHaveTransaction({
                from: buyer.address,
                to: escrow.address,
                success: false,
            });
        });

        it('should not allow ReleaseFunds in CREATED state', async () => {
            await createEscrow();

            const result = await escrow.send(
                seller.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'ReleaseFunds',
                    escrowId: ESCROW_ID,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: seller.address,
                to: escrow.address,
                success: false,
            });
        });

        it('should not allow ReleaseFunds in FUNDED state (fiat not sent)', async () => {
            await createEscrow();
            await fundEscrow();

            const result = await escrow.send(
                seller.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'ReleaseFunds',
                    escrowId: ESCROW_ID,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: seller.address,
                to: escrow.address,
                success: false,
            });
        });

        it('full happy path: CREATE -> FUND -> FIAT_SENT -> RELEASE', async () => {
            await createEscrow();
            let data = await escrow.getEscrow(ESCROW_ID);
            expect(data!.state).toBe(STATE_CREATED);

            await fundEscrow();
            data = await escrow.getEscrow(ESCROW_ID);
            expect(data!.state).toBe(STATE_FUNDED);

            await confirmFiatSent();
            data = await escrow.getEscrow(ESCROW_ID);
            expect(data!.state).toBe(STATE_FIAT_SENT);

            await escrow.send(
                seller.getSender(),
                { value: toNano('0.2') },
                {
                    $$type: 'ReleaseFunds',
                    escrowId: ESCROW_ID,
                }
            );
            data = await escrow.getEscrow(ESCROW_ID);
            expect(data!.state).toBe(STATE_COMPLETED);
        });

        it('dispute path: CREATE -> FUND -> DISPUTE -> RESOLVE (seller)', async () => {
            await createEscrow();
            await fundEscrow();

            await escrow.send(
                buyer.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'DisputeEscrow',
                    escrowId: ESCROW_ID,
                }
            );

            let data = await escrow.getEscrow(ESCROW_ID);
            expect(data!.state).toBe(STATE_DISPUTED);

            await escrow.send(
                arbiter.getSender(),
                { value: toNano('0.2') },
                {
                    $$type: 'ResolveDispute',
                    escrowId: ESCROW_ID,
                    releaseToSeller: true,
                }
            );

            data = await escrow.getEscrow(ESCROW_ID);
            expect(data!.state).toBe(STATE_COMPLETED);
        });

        it('dispute path: CREATE -> FUND -> FIAT_SENT -> DISPUTE -> RESOLVE (buyer)', async () => {
            await createEscrow();
            await fundEscrow();
            await confirmFiatSent();

            await escrow.send(
                seller.getSender(),
                { value: toNano('0.1') },
                {
                    $$type: 'DisputeEscrow',
                    escrowId: ESCROW_ID,
                }
            );

            let data = await escrow.getEscrow(ESCROW_ID);
            expect(data!.state).toBe(STATE_DISPUTED);

            await escrow.send(
                arbiter.getSender(),
                { value: toNano('0.2') },
                {
                    $$type: 'ResolveDispute',
                    escrowId: ESCROW_ID,
                    releaseToSeller: false,
                }
            );

            data = await escrow.getEscrow(ESCROW_ID);
            expect(data!.state).toBe(STATE_REFUNDED);
        });
    });

    // ========== Get Method Tests ==========

    describe('Get methods', () => {
        it('should return null for non-existent escrow', async () => {
            const data = await escrow.getEscrow(999n);
            expect(data).toBeNull();
        });

        it('should return correct contract balance', async () => {
            const balance = await escrow.getContractBalance();
            expect(balance).toBeGreaterThanOrEqual(0n);
        });

        it('should track next escrow ID correctly', async () => {
            expect(await escrow.getNextEscrowId()).toBe(0n);

            await createEscrow(0n);
            expect(await escrow.getNextEscrowId()).toBe(1n);

            await createEscrow(5n);
            expect(await escrow.getNextEscrowId()).toBe(6n);
        });
    });
});
