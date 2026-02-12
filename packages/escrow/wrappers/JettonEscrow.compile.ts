import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
    lang: 'tact',
    target: 'contracts/JettonEscrow.tact',
    options: {
        debug: true,
    },
};
