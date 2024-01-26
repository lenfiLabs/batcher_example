import { PoolConfigSpend } from "./plutus";

// Default transactions parameters applied when pool is created. Most of them can be changed later.
export const defaultConfig: PoolConfigSpend['datum'] = {
  liquidationThreshold: 1800000n,
  initialCollateralRatio: 1900000n,
  poolFee: 0n,
  mergeActionFee: 0n,
  minTransition: 0n,
  minLoan: 0n,
  minFee: 0n,
  loanFeeDetails: {
    tier_1Fee: 0n,
    tier_1Threshold: 100000n,
    tier_2Fee: 0n,
    tier_2Threshold: 450000n,
    tier_3Fee: 0n,
    tier_3Threshold: 600000n,
    liquidationFee: 25000n,
    platformFeeCollectorAddress: {
      paymentCredential: {
        VerificationKeyCredential: ['06e8ffe98775e0be22aac778e5e4d814c4bc58d58a554219fc9d5287'],
      },
      stakeCredential: null,
    },
  },
  interestParams: {
    optimalUtilization: 450000n,
    baseInterestRate: 30000n,
    rslope1: 75000n,
    rslope2: 300000n,
  },
}

// Gove token is used to control above configs.
export const GOV_TOKEN_NAME = '5c0fa59f531904a5bc00f1ccda5637c3a190f85ecc641eacb0caf0793a8a67b9'