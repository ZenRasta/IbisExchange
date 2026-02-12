import { TonClient, Address } from '@ton/ton';
import { prisma, USDT_DECIMALS, ESCROW_FUNDING_TIMEOUT } from '@ibis/shared';
import { redis, connectRedis } from '@ibis/shared';
import { notificationService } from './notificationService';

/**
 * Monitors the escrow contract for incoming USDT Jetton transfers.
 * Uses polling approach (every 5 seconds) as a reliable fallback.
 */
export class TonMonitor {
    private client: TonClient;
    private escrowAddress: string;
    private lastProcessedLt: string = '0';
    private pollInterval: ReturnType<typeof setInterval> | null = null;
    private isRunning = false;

    constructor() {
        const isTestnet = process.env.TON_TESTNET === 'true' || process.env.NODE_ENV !== 'production';
        this.client = new TonClient({
            endpoint: isTestnet
                ? 'https://testnet.toncenter.com/api/v2/jsonRPC'
                : 'https://toncenter.com/api/v2/jsonRPC',
            apiKey: process.env.TONCENTER_API_KEY,
        });
        this.escrowAddress = process.env.ESCROW_CONTRACT_ADDRESS || '';
    }

    /**
     * Start polling for new transactions every 5 seconds.
     */
    async startPolling(): Promise<void> {
        if (!this.escrowAddress) {
            console.warn('TON Monitor: ESCROW_CONTRACT_ADDRESS not set, skipping polling');
            return;
        }

        if (this.isRunning) return;
        this.isRunning = true;

        console.log(`TON Monitor: Starting polling for escrow ${this.escrowAddress}`);

        // Load last processed LT from Redis if available
        try {
            await connectRedis();
            const savedLt = await redis.get('ton_monitor:last_lt');
            if (savedLt) {
                this.lastProcessedLt = savedLt;
            }
        } catch (err) {
            console.error('TON Monitor: Failed to load last LT from Redis:', err);
        }

        this.pollInterval = setInterval(async () => {
            try {
                await this.poll();
            } catch (err) {
                console.error('TON Monitor poll error:', err);
            }
        }, 5000);

        // Also start checking for escrow timeouts
        setInterval(async () => {
            try {
                await this.checkEscrowTimeouts();
            } catch (err) {
                console.error('TON Monitor timeout check error:', err);
            }
        }, 30000); // Check every 30 seconds
    }

    /**
     * Stop polling.
     */
    stopPolling(): void {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        this.isRunning = false;
        console.log('TON Monitor: Stopped polling');
    }

    /**
     * Poll for new transactions on the escrow address.
     */
    private async poll(): Promise<void> {
        try {
            const address = Address.parse(this.escrowAddress);
            const txs = await this.client.getTransactions(address, { limit: 10 });

            for (const tx of txs) {
                const lt = tx.lt.toString();
                if (BigInt(lt) <= BigInt(this.lastProcessedLt)) continue;

                await this.processTransaction(tx);
                this.lastProcessedLt = lt;

                // Save last processed LT to Redis
                try {
                    await redis.set('ton_monitor:last_lt', lt);
                } catch {
                    // Non-critical
                }
            }
        } catch (err) {
            // TonClient may throw on network errors — log but don't crash
            console.error('TON Monitor: Poll failed:', err);
        }
    }

    /**
     * Process a single transaction from the escrow contract.
     * Looks for Jetton transfer notifications (internal messages with op=0x7362d09c).
     */
    async processTransaction(tx: unknown): Promise<void> {
        // The transaction object from @ton/ton is complex.
        // For Jetton transfers, we look at internal messages with the transfer_notification opcode.
        // The forward payload typically contains the escrow ID.
        try {
            const transaction = tx as Record<string, unknown>;
            const inMessage = transaction.inMessage as Record<string, unknown> | undefined;
            if (!inMessage) return;

            const body = inMessage.body;
            if (!body) return;

            // Try to parse as Jetton transfer notification (op=0x7362d09c)
            // This is a simplified approach — real implementation would parse the Cell
            // For POC, we match deposit events by looking at the escrow contract state
            // or by webhook data from TonAPI

            console.log('TON Monitor: Processing transaction', JSON.stringify(transaction).substring(0, 200));

            // Attempt to extract escrow ID and amount from transaction
            // This would need to be adapted based on the actual escrow contract format
            await this.tryMatchDeposit(transaction);
        } catch (err) {
            console.error('TON Monitor: Error processing transaction:', err);
        }
    }

    /**
     * Try to match a deposit transaction to a pending trade.
     */
    private async tryMatchDeposit(tx: Record<string, unknown>): Promise<void> {
        // In a real implementation, parse the Jetton transfer notification
        // to extract the escrow ID and deposited amount.
        // For now, log and handle via webhook as primary method.
        console.log('TON Monitor: Attempting to match deposit to pending trade');
    }

    /**
     * Match a confirmed deposit to a pending trade.
     * Called by webhook handler or polling when deposit is detected.
     */
    async matchDepositToTrade(
        escrowId: number,
        amount: bigint,
        sender: string,
        txHash?: string
    ): Promise<void> {
        // Convert from Jetton decimals (6 for USDT)
        const usdtAmount = Number(amount) / Math.pow(10, USDT_DECIMALS);

        // Find pending trade with matching escrow ID
        const trade = await prisma.trade.findFirst({
            where: {
                escrowId,
                status: 'AWAITING_ESCROW',
            },
            include: {
                buyer: true,
                seller: true,
            },
        });

        if (!trade) {
            console.warn(`TON Monitor: No pending trade found for escrow ID ${escrowId}`);
            return;
        }

        // Verify amount matches (allow small rounding difference)
        if (Math.abs(usdtAmount - trade.amount) > 0.01) {
            console.warn(
                `TON Monitor: Amount mismatch for trade ${trade.id}. Expected ${trade.amount}, got ${usdtAmount}`
            );
            return;
        }

        // Update trade status
        await prisma.trade.update({
            where: { id: trade.id },
            data: {
                status: 'ESCROW_LOCKED',
                escrowTxHash: txHash || null,
                escrowLockedAt: new Date(),
            },
        });

        // Clear escrow funding timeout
        try {
            await redis.del(`trade:timeout:${trade.id}`);
        } catch {
            // Non-critical
        }

        // Set fiat payment timeout (6 hours)
        try {
            await redis.set(`trade:fiat_timeout:${trade.id}`, Date.now().toString(), { EX: 21600 });
        } catch {
            // Non-critical
        }

        console.log(`TON Monitor: Escrow locked for trade ${trade.id}`);

        // Notify both parties
        notificationService.publishTradeEvent({
            type: 'ESCROW_LOCKED',
            tradeId: trade.id,
            buyerTelegramId: trade.buyer.telegramId,
            sellerTelegramId: trade.seller.telegramId,
            amount: trade.amount,
            fiatAmount: trade.fiatAmount,
            paymentMethod: trade.paymentMethod,
            bankDetails: trade.bankDetails || undefined,
        });
    }

    /**
     * Verify that an escrow release was completed on-chain.
     */
    async verifyRelease(tradeId: string): Promise<boolean> {
        const trade = await prisma.trade.findUnique({ where: { id: tradeId } });
        if (!trade || !trade.escrowId) return false;

        // In production, query the escrow contract state to confirm release
        // For POC, we trust the release transaction hash
        return !!trade.releaseTxHash;
    }

    /**
     * Check for trades that have timed out waiting for escrow funding.
     */
    private async checkEscrowTimeouts(): Promise<void> {
        const timeoutThreshold = new Date(Date.now() - ESCROW_FUNDING_TIMEOUT * 1000);

        const timedOutTrades = await prisma.trade.findMany({
            where: {
                status: 'AWAITING_ESCROW',
                createdAt: { lte: timeoutThreshold },
            },
            include: { buyer: true, seller: true },
        });

        for (const trade of timedOutTrades) {
            console.log(`TON Monitor: Trade ${trade.id} timed out waiting for escrow`);

            await prisma.$transaction(async (tx) => {
                await tx.trade.update({
                    where: { id: trade.id },
                    data: { status: 'EXPIRED' },
                });

                // Restore order remaining amount
                await tx.order.update({
                    where: { id: trade.orderId },
                    data: {
                        remainingAmount: { increment: trade.amount },
                        status: 'ACTIVE',
                    },
                });
            });

            notificationService.publishTradeEvent({
                type: 'ESCROW_TIMEOUT',
                tradeId: trade.id,
                buyerTelegramId: trade.buyer.telegramId,
                sellerTelegramId: trade.seller.telegramId,
                amount: trade.amount,
                fiatAmount: trade.fiatAmount,
            });
        }
    }
}

export const tonMonitor = new TonMonitor();
