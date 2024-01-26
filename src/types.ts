import { UTxO } from "translucent-cardano";
import { collectValidators } from "./utilities";
import { OracleValidatorWithdrawValidate } from "./plutus";

export type Validators = ReturnType<typeof collectValidators>;

export type DeployedValidators = Record<string, UTxO>;
export type DeployedLPs = Record<string, { txHash: string; txOref: number }>;

export interface LpTokenCalculation {
  depositAmount: bigint;
  lpTokenMintAmount: bigint;
}

export interface AssetClass {
  policyId: string
  assetName: string
}

export type OracelValidatorDetails = {
  nftReferenceUtxo: UTxO
  rewardAddress: string
  redeemer: OracleValidatorWithdrawValidate['redeemer']
  scriptReferenceUtxo: UTxO
}

export type PriceFeed =
  | {
      Aggregated: [
        {
          token: {policyId: string; assetName: string}
          tokenPriceInLovelaces: bigint
          denominator: bigint
          validTo: bigint
        },
      ]
    }
  | {
      Pooled: [
        {
          token: {policyId: string; assetName: string}
          tokenAAmount: bigint
          tokenBAmount: bigint
          validTo: bigint
        },
      ]
    }
export interface WithdrawDetails {
  withdrawAmount: number;
  lpTokenBurnAmount: number;
}

export type BatcherOutput = {
  receiverAddress: string;
  datum:
    | {
        inline: string; // datum is an object with an 'inline' property, which is a string
      }
    | "";
  value: OutputValue;
};

export type OutputValue = { [key: string]: bigint };

export interface ValidityRange {
  validFrom: number;
  validTo: number;
}

export interface TxObject {
  txHash: string;
  outputIndex: number;
  assets: { lovelace: bigint };
  address: string;
  datumHash: string | undefined;
  datum: string;
  scriptRef: string | null;
}

export type asset = {
  policyId: string;
  assetName: string;
  amount: number;
};

export interface TokenData {
  accepted_as_collateral: boolean;
  accepted_as_loan: boolean;
  decimals: number;
  liquidation_threshold: number;
  oracle_nft_id: string;
  token_id: string;
  token_nice_name: string;
  token_policy: string;
  token_name: string;
  initial_collateral_ratio: number;
}

export interface OracleDatum {
  poolNftPolicyId: string;
  poolNftName: string;
  oracleNftPolicyId: string;
  oracleNftName: string;
  tokenaAPolicyId: string;
  tokenaAName: string;
  tokenaBPolicyId: string;
  tokenaBName: string;
  tokenAAmount: bigint;
  tokenBAmount: bigint;
  expirationTime: bigint;
}

export type DeployedValidator = {
  validatorName: string;
  txHash: string;
  outputIndex: number;
};

export type aadaNftAction = "MintR" | "BurnR";

export type DatumValue = {
  utxo: string;
  datum: string; // Seems to be a hex string, you might want to convert it into a human-readable form
};
