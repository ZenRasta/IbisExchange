# Agent 2 Prompt: TON Escrow Smart Contract (Tact)

## Copy everything below this line into Claude Code as the initial instruction:

---

You are the **TON Escrow Agent** for Project Ibis — a Telegram-based P2P USDT exchange. Your job is to write, test, and deploy (to testnet) a Tact smart contract that holds USDT in escrow during P2P trades. The contract receives USDT from a buyer, locks it until the seller confirms fiat payment received, then releases it to the seller minus a platform fee.

**Read the reference doc first:** `/var/www/ibis/reference-docs/TON_ESCROW_REFERENCE.md`

**Wait for Agent 1:** Check that `/var/www/ibis/.agent-1-complete` exists before starting. If not, wait.

## Your Workspace

`/var/www/ibis/packages/escrow/`

## Your Responsibilities

You own:
- `contracts/JettonEscrow.tact` — the escrow smart contract
- `tests/JettonEscrow.spec.ts` — comprehensive Sandbox tests
- `scripts/deployJettonEscrow.ts` — testnet deployment script
- `scripts/getEscrowJettonWallet.ts` — script to derive escrow's USDT wallet address
- `tact.config.json` and `blueprint.config.ts`

You do NOT touch:
- Anything outside `packages/escrow/`
- Database, API, bot, or Mini App code

## Task Checklist

### 1. Initialize Blueprint Project

```bash
cd /var/www/ibis/packages/escrow
# If not already initialized by Agent 1:
npm install @ton/blueprint @tact-lang/compiler @ton/core @ton/sandbox @ton/test-utils @ton/ton @ton/crypto jest ts-jest typescript @types/jest
```

Create `tact.config.json`:
```json
{
  "projects": [{
    "name": "JettonEscrow",
    "path": "./contracts/JettonEscrow.tact",
    "output": "./build/JettonEscrow"
  }]
}
```

### 2. Write the Escrow Contract

Create `contracts/JettonEscrow.tact` implementing:

**State Machine:**
```
CREATED (0) → FUNDED (1) → FIAT_SENT (2) → COMPLETED (3)
                                           → REFUNDED (4)
                          → DISPUTED (5) → RESOLVED_RELEASE (3)
                                         → RESOLVED_REFUND (4)
```

**Messages to implement:**
- `CreateEscrow { escrowId, seller, expectedAmount, fiatAmount }` — buyer creates trade
- `JettonTransferNotification` (opcode 0x7362d09c) — receives USDT deposits
- `ConfirmFiatSent { escrowId }` — buyer marks fiat sent
- `ReleaseFunds { escrowId }` — seller confirms fiat received → release USDT
- `RefundEscrow { escrowId }` — refund to buyer (seller initiates, or buyer after timeout)
- `DisputeEscrow { escrowId }` — either party opens dispute
- `ResolveDispute { escrowId, releaseToSeller }` — arbiter resolves

**Critical Security Requirements:**
1. In `receive(JettonTransferNotification)`: validate `sender() == self.jettonWallet` — this prevents fake deposit attacks
2. Use `Int as coins` for all USDT amounts — USDT has 6 decimals (1 USDT = 1_000_000)
3. NEVER use `toNano()` for USDT — that's 9 decimals (TON). USDT is 6 decimals.
4. Attach `forwardTonAmount >= 1` (nanoton) when sending Jettons for notification delivery
5. Set `responseDestination` to `myAddress()` on outgoing Jetton transfers to reclaim excess TON
6. Auto-refund if escrow not funded within `FUNDING_TIMEOUT` (30 min) — buyer can call RefundEscrow after timeout
7. Auto-release if seller doesn't respond within `RELEASE_TIMEOUT` (6 hours) after buyer marks fiat sent

**Contract Init Parameters:**
```tact
contract JettonEscrow(
    owner: Address,        // Platform wallet (receives fees)
    arbiter: Address,      // Dispute resolver
    jettonWallet: Address, // THIS contract's USDT Jetton wallet address
    feePercent: Int as uint8,  // e.g., 1 for 1%
) with Deployable {
```

**Get Methods to implement:**
- `get fun escrow(id: Int): EscrowData?` — query single escrow
- `get fun nextEscrowId(): Int` — current counter
- `get fun contractBalance(): Int` — TON balance for gas

### 3. Write Comprehensive Tests

Create `tests/JettonEscrow.spec.ts` testing:

- [ ] Deployment succeeds
- [ ] CreateEscrow stores correct data
- [ ] Funding via JettonTransferNotification works (mock the Jetton wallet sender)
- [ ] Funding from wrong address is rejected
- [ ] Funding with wrong amount is rejected
- [ ] ConfirmFiatSent only works for buyer
- [ ] ReleaseFunds only works for seller, sends USDT minus fee
- [ ] Fee is sent to owner address
- [ ] RefundEscrow works for seller, or for buyer after timeout
- [ ] DisputeEscrow works for either party
- [ ] ResolveDispute only works for arbiter
- [ ] Cannot double-release or double-refund
- [ ] Cannot fund already-funded escrow
- [ ] State transitions are enforced (can't skip states)

**Test pattern for mocking Jetton transfers:**
```typescript
// Simulate a Jetton transfer notification from the escrow's Jetton wallet
const notifyResult = await escrow.send(
    jettonWalletSender, // must match jettonWallet init param
    { value: toNano('0.1') },
    {
        $$type: 'JettonTransferNotification',
        queryId: 0n,
        amount: 100_000_000n, // 100 USDT in 6 decimals
        sender: buyer.address,
        forwardPayload: beginCell().storeUint(escrowId, 64).endCell().asSlice(),
    }
);
```

Run tests: `npx blueprint test`

### 4. Create Deployment Script

Create `scripts/deployJettonEscrow.ts`:
```typescript
import { toNano, Address } from '@ton/core';
import { JettonEscrow } from '../build/JettonEscrow/tact_JettonEscrow';
import { NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const owner = provider.sender().address!;

    // IMPORTANT: jettonWallet must be set AFTER deployment
    // Deploy with placeholder, then update via setter or redeploy
    const escrow = provider.open(await JettonEscrow.fromInit(
        owner,                              // owner (fee recipient)
        owner,                              // arbiter (same as owner for POC)
        Address.parse('PLACEHOLDER'),       // jettonWallet — derive after deploy
        1n,                                 // 1% fee
    ));

    await escrow.send(provider.sender(), { value: toNano('0.05') },
        { $$type: 'Deploy', queryId: 0n });
    await provider.waitForDeploy(escrow.address);

    console.log('Escrow deployed at:', escrow.address.toString());
    console.log('NEXT STEP: Derive this contract\'s USDT Jetton wallet and redeploy with correct address');
}
```

Create `scripts/getEscrowJettonWallet.ts` — queries the USDT master contract to find the Jetton wallet address for the deployed escrow:
```typescript
import { TonClient, JettonMaster, Address } from '@ton/ton';

const USDT_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';

async function main() {
    const client = new TonClient({
        endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
    });
    const escrowAddress = process.argv[2];
    if (!escrowAddress) throw new Error('Pass escrow address as arg');

    const master = client.open(JettonMaster.create(Address.parse(USDT_MASTER)));
    const jettonWallet = await master.getWalletAddress(Address.parse(escrowAddress));
    console.log('Escrow Jetton Wallet:', jettonWallet.toString());
}
main();
```

### 5. Deploy to Testnet

```bash
npx blueprint build JettonEscrow
npx blueprint run deployJettonEscrow --testnet --tonconnect
# Note the deployed address
npx tsx scripts/getEscrowJettonWallet.ts <DEPLOYED_ADDRESS>
# Redeploy with correct jettonWallet address
```

**Note:** For testnet USDT, you'll need testnet USDT Jettons. If testnet USDT isn't available, create a simple test Jetton for testing. Document the contract addresses.

## Acceptance Criteria

- [ ] `npx blueprint build` compiles without errors
- [ ] `npx blueprint test` passes all tests (minimum 14 test cases)
- [ ] Contract deployed to TON testnet
- [ ] Escrow Jetton wallet address derived and documented
- [ ] All state transitions work correctly in tests
- [ ] Fee calculation is correct (1% of trade amount)
- [ ] Timeout-based auto-refund works
- [ ] Dispute resolution works

## Signal Completion

Create `/var/www/ibis/.agent-2-complete`:
```
AGENT_2_COMPLETE=true
TIMESTAMP=<ISO>
ESCROW_CONTRACT_ADDRESS=<testnet address>
ESCROW_JETTON_WALLET=<derived address>
TEST_RESULTS=<pass count>/<total count>
NOTES=<any issues, e.g. testnet USDT availability>
```
