# TON_ESCROW_REFERENCE.md — Tact Smart Contract Technical Reference

## Key Facts

- **Language:** Tact v1.6.x (TypeScript-like syntax for TON)
- **Framework:** Blueprint (@ton/blueprint v0.42.x)
- **Testing:** Sandbox (@ton/sandbox) with Jest
- **USDT Master (mainnet):** `EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs`
- **USDT Decimals:** 6 (NOT 9 — never use toNano for USDT)
- **Jetton Standard:** TEP-74 (transfer opcode 0xf8a7ea5, notification opcode 0x7362d09c)

## Jetton Transfer Flow (How USDT Moves on TON)

```
User → User's USDT Wallet → Escrow's USDT Wallet → Escrow Contract (notification)
         (0xf8a7ea5)           (0x178d4519)            (0x7362d09c)
```

1. User sends `transfer` to their own USDT Jetton wallet
2. User's wallet sends `internal_transfer` to recipient's Jetton wallet
3. Recipient's wallet sends `transfer_notification` to the recipient (if forward_ton_amount > 0)
4. Recipient's wallet sends `excesses` to response_destination (returns unused TON)

## CRITICAL: Validating Jetton Deposits

The escrow contract's `jettonWallet` init parameter MUST be the address of the escrow contract's own USDT Jetton wallet. Derive it after deployment by calling `get_wallet_address(escrow_address)` on the USDT master contract.

In the `receive(JettonTransferNotification)` handler:
```tact
require(sender() == self.jettonWallet, "Invalid jetton wallet");
```
Without this, ANYONE can send a fake `JettonTransferNotification` message directly to the escrow.

## Tact Message Definitions

```tact
// Standard TEP-74 messages — MUST use exact opcodes
message(0xf8a7ea5) JettonTransfer {
    queryId: Int as uint64;
    amount: Int as coins;
    destination: Address;
    responseDestination: Address;
    customPayload: Cell?;
    forwardTonAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

message(0x7362d09c) JettonTransferNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;       // Original sender (the user who initiated the transfer)
    forwardPayload: Slice as remaining;  // Contains escrow ID
}
```

## Sending Jettons from the Contract

```tact
send(SendParameters{
    to: self.jettonWallet,      // Send to OUR Jetton wallet
    value: ton("0.06"),          // Gas for the transfer chain
    mode: SendIgnoreErrors,
    body: JettonTransfer{
        queryId: 0,
        amount: usdtAmount,      // In 6-decimal units
        destination: recipient,   // Where the USDT goes
        responseDestination: myAddress(), // Get excess TON back
        customPayload: null,
        forwardTonAmount: 1,     // Must be >0 for notification
        forwardPayload: emptySlice(),
    }.toCell(),
});
```

## Blueprint Testing Pattern

```typescript
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano, beginCell } from '@ton/core';
import '@ton/test-utils';

let blockchain: Blockchain;
let deployer: SandboxContract<TreasuryContract>;

beforeEach(async () => {
    blockchain = await Blockchain.create();
    deployer = await blockchain.treasury('deployer');
});

// To test Jetton notifications, create a treasury that acts as the Jetton wallet:
const fakeJettonWallet = await blockchain.treasury('jettonWallet');
// Then pass fakeJettonWallet.address as the jettonWallet init param
// And send JettonTransferNotification FROM fakeJettonWallet.getSender()
```

## Useful Links

- Tact docs: https://docs.tact-lang.org
- Tact Jetton cookbook: https://docs.tact-lang.org/cookbook/jettons/
- DeFi cookbook (escrow examples): https://github.com/tact-lang/defi-cookbook
- Blueprint docs: https://docs.ton.org/contract-dev/blueprint/overview
- TEP-74 standard: https://github.com/ton-blockchain/TEPs/blob/master/text/0074-jettons-standard.md
