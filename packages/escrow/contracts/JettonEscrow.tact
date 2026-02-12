import "@stdlib/deploy";

// ========== TEP-74 Messages ==========

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
    sender: Address;
    forwardPayload: Slice as remaining;
}

// ========== Escrow Messages ==========

message CreateEscrow {
    escrowId: Int as uint64;
    seller: Address;
    expectedAmount: Int as coins;
    fiatAmount: Int as uint64;
}

message ConfirmFiatSent {
    escrowId: Int as uint64;
}

message ReleaseFunds {
    escrowId: Int as uint64;
}

message RefundEscrow {
    escrowId: Int as uint64;
}

message DisputeEscrow {
    escrowId: Int as uint64;
}

message ResolveDispute {
    escrowId: Int as uint64;
    releaseToSeller: Bool;
}

message SetJettonWallet {
    newJettonWallet: Address;
}

// ========== Escrow State Constants ==========
// CREATED=0, FUNDED=1, FIAT_SENT=2, COMPLETED=3, REFUNDED=4, DISPUTED=5

// ========== Data Structures ==========

struct EscrowData {
    buyer: Address;
    seller: Address;
    expectedAmount: Int as coins;
    fiatAmount: Int as uint64;
    state: Int as uint8;
    createdAt: Int as uint32;
    fiatSentAt: Int as uint32;
}

// ========== Contract ==========

contract JettonEscrow with Deployable {

    // Timeouts in seconds
    const FUNDING_TIMEOUT: Int = 1800;   // 30 minutes
    const RELEASE_TIMEOUT: Int = 21600;  // 6 hours

    // State constants
    const STATE_CREATED: Int = 0;
    const STATE_FUNDED: Int = 1;
    const STATE_FIAT_SENT: Int = 2;
    const STATE_COMPLETED: Int = 3;
    const STATE_REFUNDED: Int = 4;
    const STATE_DISPUTED: Int = 5;

    owner: Address;
    arbiter: Address;
    jettonWallet: Address;
    feeBps: Int as uint16;    // Fee in basis points (50 = 0.5%)
    nextId: Int as uint64;

    // Maps for escrow fields
    buyers: map<Int as uint64, Address>;
    sellers: map<Int as uint64, Address>;
    expectedAmounts: map<Int as uint64, Int as coins>;
    fiatAmounts: map<Int as uint64, Int as coins>;
    states: map<Int as uint64, Int as uint8>;
    createdAts: map<Int as uint64, Int as uint32>;
    fiatSentAts: map<Int as uint64, Int as uint32>;

    init(owner: Address, arbiter: Address, jettonWallet: Address, feeBps: Int) {
        self.owner = owner;
        self.arbiter = arbiter;
        self.jettonWallet = jettonWallet;
        self.feeBps = feeBps;
        self.nextId = 0;
    }

    // ========== Receiver: Deploy (null body) ==========
    // Deployable trait handles Deploy message

    // ========== Receiver: SetJettonWallet (owner-only, post-deploy) ==========
    receive(msg: SetJettonWallet) {
        require(sender() == self.owner, "Only owner can set jetton wallet");
        self.jettonWallet = msg.newJettonWallet;
        cashback(sender());
    }

    // ========== Receiver: CreateEscrow ==========
    receive(msg: CreateEscrow) {
        let id: Int = msg.escrowId;

        // Ensure this escrow ID has not been used
        require(self.states.get(id) == null, "Escrow ID already exists");

        // Assign and increment next ID if needed
        if (id >= self.nextId) {
            self.nextId = id + 1;
        }

        // Store escrow data
        self.buyers.set(id, sender());
        self.sellers.set(id, msg.seller);
        self.expectedAmounts.set(id, msg.expectedAmount);
        self.fiatAmounts.set(id, msg.fiatAmount);
        self.states.set(id, self.STATE_CREATED);
        self.createdAts.set(id, now());
        self.fiatSentAts.set(id, 0);

        // Return excess TON to sender
        cashback(sender());
    }

    // ========== Receiver: JettonTransferNotification ==========
    receive(msg: JettonTransferNotification) {
        // CRITICAL: Validate that this notification comes from our Jetton wallet
        require(sender() == self.jettonWallet, "Invalid jetton wallet");

        // Parse escrow ID from forward payload
        let escrowId: Int = msg.forwardPayload.loadUint(64);

        // Verify escrow exists and is in CREATED state
        let state: Int? = self.states.get(escrowId);
        require(state != null, "Escrow not found");
        require(state!! == self.STATE_CREATED, "Escrow not in CREATED state");

        // Verify the funding amount matches
        let expectedAmount: Int? = self.expectedAmounts.get(escrowId);
        require(expectedAmount != null, "Expected amount not found");
        require(msg.amount >= expectedAmount!!, "Insufficient funding amount");

        // Check funding timeout
        let createdAt: Int? = self.createdAts.get(escrowId);
        require(createdAt != null, "Created time not found");
        require(now() - createdAt!! <= self.FUNDING_TIMEOUT, "Funding timeout expired");

        // Verify the sender (original Jetton transfer initiator) is the buyer
        let buyer: Address? = self.buyers.get(escrowId);
        require(buyer != null, "Buyer not found");
        require(msg.sender == buyer!!, "Only buyer can fund escrow");

        // Update state to FUNDED
        self.states.set(escrowId, self.STATE_FUNDED);
    }

    // ========== Receiver: ConfirmFiatSent ==========
    receive(msg: ConfirmFiatSent) {
        let id: Int = msg.escrowId;

        let state: Int? = self.states.get(id);
        require(state != null, "Escrow not found");
        require(state!! == self.STATE_FUNDED, "Escrow not in FUNDED state");

        // Only buyer can confirm fiat sent
        let buyer: Address? = self.buyers.get(id);
        require(buyer != null, "Buyer not found");
        require(sender() == buyer!!, "Only buyer can confirm fiat sent");

        // Update state
        self.states.set(id, self.STATE_FIAT_SENT);
        self.fiatSentAts.set(id, now());

        cashback(sender());
    }

    // ========== Receiver: ReleaseFunds ==========
    receive(msg: ReleaseFunds) {
        let id: Int = msg.escrowId;

        let state: Int? = self.states.get(id);
        require(state != null, "Escrow not found");
        require(state!! == self.STATE_FIAT_SENT, "Escrow not in FIAT_SENT state");

        // Only seller can release
        let seller: Address? = self.sellers.get(id);
        require(seller != null, "Seller not found");
        require(sender() == seller!!, "Only seller can release funds");

        // Calculate fee and payout using basis points
        let amount: Int = self.expectedAmounts.get(id)!!;
        let fee: Int = (amount * self.feeBps) / 10000;
        let payout: Int = amount - fee;

        // Update state to COMPLETED
        self.states.set(id, self.STATE_COMPLETED);

        // Send USDT to seller (minus fee)
        self._sendJettons(seller!!, payout);

        // Send fee to owner
        if (fee > 0) {
            self._sendJettons(self.owner, fee);
        }
    }

    // ========== Receiver: RefundEscrow ==========
    receive(msg: RefundEscrow) {
        let id: Int = msg.escrowId;

        let state: Int? = self.states.get(id);
        require(state != null, "Escrow not found");

        let buyer: Address? = self.buyers.get(id);
        require(buyer != null, "Buyer not found");
        let seller: Address? = self.sellers.get(id);
        require(seller != null, "Seller not found");

        let senderAddr: Address = sender();

        if (state!! == self.STATE_CREATED) {
            // If not funded yet, either party can cancel
            require(senderAddr == buyer!! || senderAddr == seller!!, "Not authorized");
            self.states.set(id, self.STATE_REFUNDED);
            cashback(senderAddr);
            return;
        }

        if (state!! == self.STATE_FUNDED) {
            // Seller can refund anytime in FUNDED state
            if (senderAddr == seller!!) {
                self.states.set(id, self.STATE_REFUNDED);
                let amount: Int = self.expectedAmounts.get(id)!!;
                self._sendJettons(buyer!!, amount);
                return;
            }
            // Buyer can refund after RELEASE_TIMEOUT if seller doesn't act
            require(senderAddr == buyer!!, "Not authorized");
            let createdAt: Int = self.createdAts.get(id)!!;
            require(now() - createdAt > self.RELEASE_TIMEOUT, "Release timeout not expired");
            self.states.set(id, self.STATE_REFUNDED);
            let amount: Int = self.expectedAmounts.get(id)!!;
            self._sendJettons(buyer!!, amount);
            return;
        }

        if (state!! == self.STATE_FIAT_SENT) {
            // After fiat sent, buyer can get refund after RELEASE_TIMEOUT if seller doesn't release
            require(senderAddr == buyer!!, "Only buyer can request refund after fiat sent");
            let fiatSentAt: Int = self.fiatSentAts.get(id)!!;
            require(now() - fiatSentAt > self.RELEASE_TIMEOUT, "Release timeout not expired");
            self.states.set(id, self.STATE_REFUNDED);
            let amount: Int = self.expectedAmounts.get(id)!!;
            self._sendJettons(buyer!!, amount);
            return;
        }

        // Cannot refund in other states
        require(false, "Cannot refund in current state");
    }

    // ========== Receiver: DisputeEscrow ==========
    receive(msg: DisputeEscrow) {
        let id: Int = msg.escrowId;

        let state: Int? = self.states.get(id);
        require(state != null, "Escrow not found");
        // Can dispute from FUNDED or FIAT_SENT states
        require(state!! == self.STATE_FUNDED || state!! == self.STATE_FIAT_SENT, "Cannot dispute in current state");

        let buyer: Address? = self.buyers.get(id);
        let seller: Address? = self.sellers.get(id);
        require(buyer != null && seller != null, "Escrow data missing");

        // Either party can open dispute
        let senderAddr: Address = sender();
        require(senderAddr == buyer!! || senderAddr == seller!!, "Only buyer or seller can dispute");

        self.states.set(id, self.STATE_DISPUTED);

        cashback(senderAddr);
    }

    // ========== Receiver: ResolveDispute ==========
    receive(msg: ResolveDispute) {
        let id: Int = msg.escrowId;

        // Only arbiter can resolve
        require(sender() == self.arbiter, "Only arbiter can resolve disputes");

        let state: Int? = self.states.get(id);
        require(state != null, "Escrow not found");
        require(state!! == self.STATE_DISPUTED, "Escrow not in DISPUTED state");

        let amount: Int = self.expectedAmounts.get(id)!!;
        let buyer: Address = self.buyers.get(id)!!;
        let seller: Address = self.sellers.get(id)!!;

        if (msg.releaseToSeller) {
            // Release to seller minus fee (same as normal release)
            let fee: Int = (amount * self.feeBps) / 10000;
            let payout: Int = amount - fee;
            self.states.set(id, self.STATE_COMPLETED);
            self._sendJettons(seller, payout);
            if (fee > 0) {
                self._sendJettons(self.owner, fee);
            }
        } else {
            // Refund to buyer
            self.states.set(id, self.STATE_REFUNDED);
            self._sendJettons(buyer, amount);
        }
    }

    // ========== Internal: Send Jettons ==========
    fun _sendJettons(to: Address, amount: Int) {
        send(SendParameters{
            to: self.jettonWallet,
            value: ton("0.06"),
            mode: SendIgnoreErrors,
            body: JettonTransfer{
                queryId: 0,
                amount: amount,
                destination: to,
                responseDestination: myAddress(),
                customPayload: null,
                forwardTonAmount: 1,
                forwardPayload: emptySlice(),
            }.toCell(),
        });
    }

    // ========== Get Methods ==========

    get fun escrow(id: Int): EscrowData? {
        let state: Int? = self.states.get(id);
        if (state == null) {
            return null;
        }
        return EscrowData{
            buyer: self.buyers.get(id)!!,
            seller: self.sellers.get(id)!!,
            expectedAmount: self.expectedAmounts.get(id)!!,
            fiatAmount: self.fiatAmounts.get(id)!!,
            state: state!!,
            createdAt: self.createdAts.get(id)!!,
            fiatSentAt: self.fiatSentAts.get(id)!!,
        };
    }

    get fun nextEscrowId(): Int {
        return self.nextId;
    }

    get fun contractBalance(): Int {
        return myBalance();
    }

    get fun jettonWalletAddress(): Address {
        return self.jettonWallet;
    }
}
