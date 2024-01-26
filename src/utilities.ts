import {
  Credential,
  Provider,
  Unit,
  Data,
  Translucent,
  Validator,
  PolicyId,
  toUnit,
  UTxO,
  fromHex,
  toHex,
  networkToId,
} from "translucent-cardano";
import { C } from "lucid-cardano";

import {
  LpTokenCalculation,
  Validators,
  TokenData,
  ValidityRange,
  DeployedValidator,
  OutputValue,
  DeployedValidators,
  AssetClass,
  OracelValidatorDetails,
  PriceFeed,
} from "./types";
import {
  CollateralSpend,
  DelayedMergeSpend,
  LeftoversLeftovers,
  LiquidityTokenLiquidityToken,
  OracleValidatorWithdrawValidate,
  OrderContractBorrowOrderContract,
  OrderContractDepositOrderContract,
  OrderContractRepayOrderContract,
  OrderContractWithdrawOrderContract,
  PlaceholderNftPlaceholderNft,
  PoolConfigMint,
  PoolConfigSpend,
  PoolSpend,
} from "./plutus";
import BigNumber from "bignumber.js";
import { signAnything } from "./oracle/oracle_feeds";

const BLOCKFROST_API_KEY = process.env["BLOCKFROST_KEY"];
const BLOCKFROST_URL = process.env["BLOCKFROST_URL"];

export function updateUserValue(
  userValues: OutputValue,
  newValue: OutputValue
): OutputValue {
  // Merge and sum values for existing keys, or add new keys
  for (const [newKey, newVal] of Object.entries(newValue)) {
    userValues[newKey] = (userValues[newKey] || 0n) + newVal;
  }

  // Create a new object with keys sorted, placing 'lovelace' first
  const sortedUserValues: OutputValue = {};
  const keys = Object.keys(userValues).sort((a, b) => {
    if (a === "lovelace") return -1;
    if (b === "lovelace") return 1;
    return a.localeCompare(b);
  });

  keys.forEach((key) => {
    sortedUserValues[key] = userValues[key];
  });

  return sortedUserValues;
}

export function getOutputReference(utxo: UTxO) {
  return {
    transactionId: { hash: utxo.txHash },
    outputIndex: BigInt(utxo.outputIndex),
  };
}

export function toUnitOrLovelace(policyId: PolicyId, assetName?: string): Unit {
  if (policyId + assetName === "") {
    return "lovelace";
  }
  return toUnit(policyId, assetName);
}

export function calculateLpTokens(
  initialCount: bigint,
  alreadyLend: bigint,
  balanceToDeposit: bigint,
  totalLpTokens: bigint
): LpTokenCalculation {
  const initialCountBN = new BigNumber(Number(initialCount));
  const alreadyLendBN = new BigNumber(Number(alreadyLend));
  const balanceToDepositBN = new BigNumber(Number(balanceToDeposit));
  const totalLPTokensBN = new BigNumber(Number(totalLpTokens));

  const lpTokensToDeposit = balanceToDepositBN
    .multipliedBy(totalLPTokensBN)
    .div(initialCountBN.plus(alreadyLendBN));

  const whatValidatorWillExpect = lpTokensToDeposit
    .multipliedBy(initialCountBN.plus(alreadyLendBN))
    .div(totalLPTokensBN);

  return {
    depositAmount: BigInt(Math.floor(whatValidatorWillExpect.toNumber())),
    lpTokenMintAmount: BigInt(Math.floor(lpTokensToDeposit.toNumber())),
  };
}

export async function findAssetQuantity(
  data: UTxO[],
  assetPolicy: string,
  assetName: string
): Promise<number> {
  if (assetPolicy == "") {
    let assetQuantity: number = 0;

    data.forEach((item) => {
      if (item.assets.hasOwnProperty("lovelace")) {
        assetQuantity += Number(item.assets["lovelace"]);
      }
    });

    return assetQuantity;
  } else {
    let assetQuantity: number = 0;
    const assetKey = toUnit(assetPolicy, assetName);
    data.forEach((item) => {
      if (item.assets.hasOwnProperty(assetKey)) {
        assetQuantity += Number(item.assets[assetKey]);
      }
    });

    return assetQuantity;
  }
}

export function calculateInterestAmount(
  interestRate: bigint,
  loanAmount: bigint,
  loanStartTs: bigint,
  currentTs: number
): bigint {
  const secondsInYear = new BigNumber(31536000000);
  const oneMillion = new BigNumber(1000000);
  const interestRateBN = new BigNumber(Number(interestRate));
  const loanAmountBN = new BigNumber(Number(loanAmount));
  const loanStartTsBN = new BigNumber(Number(loanStartTs));
  const currentTsBN = new BigNumber(Number(currentTs));

  const resultInterestAmount = BigInt(
    Math.ceil(
      loanAmountBN
        .multipliedBy(interestRateBN)
        .multipliedBy(currentTsBN.minus(loanStartTsBN))
        .div(secondsInYear.multipliedBy(oneMillion))
        .toNumber()
    )
  );

  if (resultInterestAmount > 0) {
    return resultInterestAmount;
  } else {
    return 1n;
  }
}

export function getValidityRange(lucid: Translucent): ValidityRange {
  const validFromInit = new Date().getTime() - 1 * 60 * 1000;
  const validToInit = new Date(validFromInit + 5 * 60 * 1000); // add 45 minutes (TTL: time to live);
  const validToUnix = Math.floor(validToInit.getTime());

  const validFromSlot = lucid.utils.unixTimeToSlot(validFromInit);
  const validToSlot = lucid.utils.unixTimeToSlot(validToUnix);

  const validFrom = lucid.utils.slotToUnixTime(validFromSlot);
  const validTo = lucid.utils.slotToUnixTime(validToSlot);

  return { validFrom, validTo };
}

export function collectValidators(
  lucid: Translucent,
  poolConfig: PoolConfigSpend["datum"],
  poolTokenName: string,
  govTokenName: string
) {
  // Deploy all related contracts

  const delegatorNftPolicy = new PlaceholderNftPlaceholderNft(3n);
  const delegatorNftPolicyId: PolicyId =
    lucid.utils.mintingPolicyToId(delegatorNftPolicy);

  const tempGovTokenPolicy = new PlaceholderNftPlaceholderNft(7n); // Making up the token. But it could be basically any NFT or even adahandle.
  const govNft = {
    policyId: lucid.utils.mintingPolicyToId(tempGovTokenPolicy),
    assetName: govTokenName,
  };

  const oracleNftPolicy = new PlaceholderNftPlaceholderNft(1n);
  const oracleNftPolicyId: PolicyId =
    lucid.utils.mintingPolicyToId(oracleNftPolicy);

  const poolConfigValidator = new PoolConfigSpend(govNft, poolConfig);
  const poolConfigPolicy = new PoolConfigMint(govNft, poolConfig);
  const poolConfigPolicyId: PolicyId =
    lucid.utils.mintingPolicyToId(poolConfigPolicy);
  const poolValidator = new PoolSpend(delegatorNftPolicyId, poolConfigPolicyId);
  const poolScriptHash = lucid.utils.validatorToScriptHash(poolValidator);

  const lpTokenPolicy = new LiquidityTokenLiquidityToken(
    poolScriptHash,
    poolTokenName
  );
  const lpTokenPolicyId: PolicyId =
    lucid.utils.mintingPolicyToId(lpTokenPolicy);

  const leftoverValidator = new LeftoversLeftovers();
  const leftoverValidatorPkh =
    lucid.utils.validatorToScriptHash(leftoverValidator);

  const mergeScript = new DelayedMergeSpend(poolScriptHash);
  const mergeScriptHash = lucid.utils.validatorToScriptHash(mergeScript);

  const collateralValidator = new CollateralSpend({
    poolScriptHash: poolScriptHash,
    liquidationsPkh: leftoverValidatorPkh,
    paramMergeScriptHash: mergeScriptHash,
  });

  const collateralValidatorHash =
    lucid.utils.validatorToScriptHash(collateralValidator);

  const orderContractBorrow = new OrderContractBorrowOrderContract();
  const orderContractDeposit = new OrderContractDepositOrderContract();
  const orderContractRepay = new OrderContractRepayOrderContract();
  const orderContractWithdraw = new OrderContractWithdrawOrderContract();

  return {
    poolScriptHash,
    delegatorNftPolicy,
    delegatorNftPolicyId,
    poolValidator,
    lpTokenPolicy,
    poolConfigValidator,
    orderContractBorrow,
    orderContractDeposit,
    orderContractWithdraw,
    orderContractRepay,
    lpTokenPolicyId,
    leftoverValidator,
    leftoverValidatorPkh,
    poolConfigPolicy,
    poolConfigPolicyId,
    collateralValidator,
    collateralValidatorHash,
    oracleNftPolicyId,
    oracleNftPolicy,
    mergeScript,
    mergeScriptHash,
    govNft,
  };
}

export type OutputReference = {
  transactionId: { hash: string };
  outputIndex: bigint;
};

export const OutputReferenceT = Object.assign({
  title: "OutputReference",
  dataType: "constructor",
  index: 0,
  fields: [
    {
      title: "transactionId",
      description:
        "A unique transaction identifier, as the hash of a transaction body. Note that the transaction id\n isn't a direct hash of the `Transaction` as visible on-chain. Rather, they correspond to hash\n digests of transaction body as they are serialized on the network.",
      anyOf: [
        {
          title: "TransactionId",
          dataType: "constructor",
          index: 0,
          fields: [{ dataType: "bytes", title: "hash" }],
        },
      ],
    },
    { dataType: "integer", title: "outputIndex" },
  ],
});

export function getValueFromMap<K, V>(
  map: Map<string, Map<string, V>>,
  policy: string,
  assetName: string
): V | null {
  // Access the nested map using the first key
  const nestedMap = map.get(policy);

  // If the nested map exists, retrieve the value using the second key
  if (nestedMap) {
    return nestedMap.get(assetName) || null;
  }

  // Return null if the keys are not found
  return null;
}

export function nameFromUTxO(utxo: UTxO) {
  const { hash_blake2b256 } = C;
  const the_output_reference = Data.to<OutputReference>(
    {
      transactionId: { hash: utxo.txHash },
      outputIndex: BigInt(utxo.outputIndex),
    },
    OutputReferenceT
  );
  const assetName = toHex(hash_blake2b256(fromHex(the_output_reference)));
  return assetName;
}

// Collects artifacts needed for basically every pool transaction.
export async function getPoolArtifacts(
  poolTokenName: string,
  validators: Validators,
  lucid: Translucent
) {
  const poolUTxO = await lucid.provider.getUtxoByUnit(
    validators.poolScriptHash + poolTokenName
  );
  const poolDatumMapped: PoolSpend["datum"] = Data.from<PoolSpend["datum"]>(
    poolUTxO.datum!,
    PoolSpend["datum"]
  );

  const configUTxO = await lucid.provider.getUtxoByUnit(
    toUnit(
      validators.poolConfigPolicyId,
      poolDatumMapped.params.poolConfigAssetname
    )
  );

  if (configUTxO == null) {
    throw "Could not find pool config";
  }

  const poolConfigDatum: PoolConfigSpend["datum"] = Data.from<
    PoolConfigSpend["datum"]
  >(configUTxO.datum!, PoolConfigSpend["datum"]);

  return {
    configUTxO,
    poolUTxO,
    poolDatumMapped,
    poolConfigDatum,
  };
}

export function getExpectedValueMap(value: Map<string, Map<string, bigint>>) {
  const toReceive: { [assetId: string]: bigint } = {};

  for (const [policyId, assetMap] of value) {
    for (const [assetName, amount] of assetMap) {
      toReceive[toUnitOrLovelace(policyId, assetName)] = amount;
    }
  }

  return toReceive;
}

export function generateReceiverAddress(
  lucid: Translucent,
  recipientAddress: any
) {
  const paymentCredential: Credential = lucid.utils.keyHashToCredential(
    recipientAddress.paymentCredential.VerificationKeyCredential[0]
  );

  const stakeCredential =
    recipientAddress.stakeCredential &&
    recipientAddress.stakeCredential.Inline &&
    recipientAddress.stakeCredential.Inline[0] &&
    recipientAddress.stakeCredential.Inline[0].VerificationKeyCredential
      ? lucid.utils.keyHashToCredential(
          recipientAddress.stakeCredential.Inline[0]
            .VerificationKeyCredential[0]
        )
      : undefined;

  const receiverAddress = lucid.utils.credentialToAddress(
    paymentCredential,
    stakeCredential
  );

  return receiverAddress;
}

type AssetName = string;
type Amount = BigInt;

export function getValueFromMapBorrow(
  batcherDatum:
    | OrderContractBorrowOrderContract["datum"]
    | OrderContractRepayOrderContract["datum"],
  targetPolicyId: PolicyId,
  targetAssetName: AssetName
): bigint | null {
  const valueMap: Map<PolicyId, Map<AssetName, Amount>> | undefined =
    batcherDatum?.order?.expectedOutput?.value;

  if (!valueMap) {
    return null;
  }

  for (const [policyId, assetMap] of valueMap.entries()) {
    if (policyId === targetPolicyId) {
      for (const [assetName, amount] of assetMap.entries()) {
        if (assetName === targetAssetName) {
          // Returns the first found amount that matches policyId and assetName.
          return amount;
        }
      }
    }
  }

  return null;
}

type Deposit = {
  policyId: string;
  assetName: string;
  amount: number;
};

type AggregatedDeposits = Map<string, Map<string, bigint>>;

export const aggregateDeposits = (deposits: Deposit[]): AggregatedDeposits => {
  const result = new Map<string, Map<string, bigint>>();
  for (const deposit of deposits) {
    const { policyId, assetName, amount } = deposit;

    let assetMap = result.get(policyId);
    if (!assetMap) {
      assetMap = new Map<string, bigint>();
      result.set(policyId, assetMap);
    }

    let currentAmount = assetMap.get(assetName) || BigInt(0);
    currentAmount += BigInt(amount);
    assetMap.set(assetName, currentAmount);
  }

  // Sort by policyId, assetName and then amount
  const sortedResult = new Map<string, Map<string, bigint>>(
    [...result.entries()].sort()
  );

  for (const [policyId, assetMap] of sortedResult) {
    const sortedAssetMap = new Map<string, bigint>(
      [...assetMap.entries()].sort()
    );
    sortedResult.set(policyId, sortedAssetMap);
  }

  return sortedResult;
};

export function parseValidators(json: any): DeployedValidators {
  const validators: DeployedValidators = {};
  for (const key in json) {
    validators[key] = {
      ...json[key],
      assets: {
        ...json[key].assets,
        lovelace: BigInt(json[key].assets.lovelace),
      },
    };
  }
  return validators;
}
type InterestParams = {
  optimalUtilization: bigint;
  baseInterestRate: bigint;
  rslope1: bigint;
  rslope2: bigint;
};

export function getInterestRates(
  interestParams: InterestParams,
  loanAmount: bigint,
  lentOut: bigint,
  balance: bigint
): bigint {
  // These are parameters hardcoded into contract. It can be moved to referencable UTXO
  // in order to be updatable, but with the same validator hash
  const optimalUtilizationBN = new BigNumber(
    Number(interestParams.optimalUtilization)
  );
  const baseInterestRateBN = new BigNumber(
    Number(interestParams.baseInterestRate * 1000000n)
  );
  const rslope1BN = new BigNumber(Number(interestParams.rslope1));
  const rslope2BN = new BigNumber(Number(interestParams.rslope2));
  const oneMillionBN = new BigNumber(1000000);
  const loanAmountBN = new BigNumber(Number(loanAmount));
  const lentOutBN = new BigNumber(Number(lentOut));
  const balanceBN = new BigNumber(Number(balance));

  const utilizationRateBN = new BigNumber(
    lentOutBN
      .plus(loanAmountBN)
      .multipliedBy(oneMillionBN)
      .dividedBy(balanceBN.plus(lentOutBN))
  );

  if (utilizationRateBN.lte(optimalUtilizationBN)) {
    const utilizationCharge = utilizationRateBN.multipliedBy(rslope1BN);
    // Base interest rate + charge for utilied loan
    return BigInt(
      Math.floor(
        baseInterestRateBN.plus(utilizationCharge).dividedBy(1000000).toNumber()
      )
    );
  } else {
    const lowCharge = rslope1BN.multipliedBy(optimalUtilizationBN);
    const highCharge = utilizationRateBN
      .minus(optimalUtilizationBN)
      .multipliedBy(rslope2BN);

    return BigInt(
      Math.floor(
        Number(
          baseInterestRateBN
            .plus(lowCharge)
            .plus(highCharge)
            .dividedBy(1000000)
            .toNumber()
        )
      )
    );
  }
}

export async function collectOracleDetails(
  oracleNft: AssetClass,
  asset: AssetClass,
  lucid: Translucent,
) {
  const oracleUtxo = await lucid.provider.getUtxoByUnit(
    toUnit(oracleNft.policyId, oracleNft.assetName)
  );
  // This is data feed that we require oracle to sign. In testnet oracle will sign any data. See oracle_feeds.ts
  const data: PriceFeed = {
    Aggregated: [
      {
        token: {
          policyId: asset.policyId,
          assetName: asset.assetName,
        },
        tokenPriceInLovelaces: 1n,
        denominator: 2n,
        validTo: BigInt(new Date().getTime() + 120000000),
      },
    ],
  };

  const loanOracleDetailsFeed = await signAnything(data);

  const oracleValidatorHash = lucid.utils.getAddressDetails(oracleUtxo.address)
    .paymentCredential?.hash;

  const oracelRewardAddress = C.RewardAddress.new(
    networkToId(lucid.network),
    C.StakeCredential.from_scripthash(
      C.ScriptHash.from_hex(oracleValidatorHash || "")
    )
  )
    .to_address()
    .to_bech32(undefined);

  return {
    nftReferenceUtxo: oracleUtxo,
    rewardAddress: oracelRewardAddress,
    redeemer: loanOracleDetailsFeed,
    scriptReferenceUtxo: oracleUtxo,
    oracleValidatorHash // This is not correct for the moment. Probably should get this from DB and pass it over here.
  };
}

export function getAdaAmountIfBought(
  assetAPolicyId: PolicyId,
  assetATokenName: string,
  oracleDatum: OracleValidatorWithdrawValidate["redeemer"],
  assetAmount: bigint
): bigint {
  if ("Pooled" in oracleDatum.data) {
    // Existing logic for Pooled
    const pooledData = oracleDatum.data.Pooled.find(
      (item) =>
        item.token.policyId === assetAPolicyId &&
        item.token.assetName === assetATokenName
    );
    if (!pooledData) {
      throw "Token not found in Pooled price feed 1 ";
    }
    const assetAmountBN = new BigNumber(Number(assetAmount));
    const tokenAAmountBN = new BigNumber(Number(pooledData.tokenAAmount));
    const tokenBAmountBN = new BigNumber(Number(pooledData.tokenBAmount));

    return BigInt(
      Math.floor(
        Number(
          assetAmountBN
            .multipliedBy(1000)
            .multipliedBy(tokenBAmountBN)
            .dividedBy(tokenAAmountBN.minus(assetAmountBN).multipliedBy(997))
        )
      )
    );
  } else if ("Aggregated" in oracleDatum.data) {
    // New logic for Aggregated
    const aggregatedData = oracleDatum.data.Aggregated.find(
      (item) =>
        item.token.policyId === assetAPolicyId &&
        item.token.assetName === assetATokenName
    );
    if (!aggregatedData) {
      throw "Token not found in Aggregated price feed 2";
    }
    return BigInt(
      Math.floor(
        Number(
          new BigNumber(Number(assetAmount))
            .multipliedBy(Number(aggregatedData.tokenPriceInLovelaces))
            .dividedBy(Number(aggregatedData.denominator))
        )
      )
    );
  } else {
    throw "Invalid price feed data";
  }
}

export function getAdaAmountIfSold(
  assetAPolicyId: PolicyId,
  assetATokenName: string,
  oracleDatum: OracleValidatorWithdrawValidate["redeemer"],
  assetAmount: bigint
): bigint {
  if ("Pooled" in oracleDatum.data) {
    // Existing logic for Pooled
    const pooledData = oracleDatum.data.Pooled.find(
      (item) =>
        item.token.policyId === assetAPolicyId &&
        item.token.assetName === assetATokenName
    );
    if (!pooledData) {
      throw "Token not found in Pooled price feed";
    }
    const assetAmountBN = new BigNumber(Number(assetAmount));
    const tokenAAmountBN = new BigNumber(Number(pooledData.tokenAAmount));
    const tokenBAmountBN = new BigNumber(Number(pooledData.tokenBAmount));

    return BigInt(
      Math.floor(
        Number(
          assetAmountBN
            .multipliedBy(997)
            .multipliedBy(tokenBAmountBN)
            .dividedBy(
              tokenAAmountBN
                .multipliedBy(1000)
                .plus(assetAmountBN.multipliedBy(997))
            )
        )
      )
    );
  } else if ("Aggregated" in oracleDatum.data) {
    // New logic for Aggregated
    const aggregatedData = oracleDatum.data.Aggregated.find(
      (item) =>
        item.token.policyId === assetAPolicyId &&
        item.token.assetName === assetATokenName
    );
    if (!aggregatedData) {
      throw "Token not found in Aggregated price feed 1";
    }
    return BigInt(
      Math.floor(
        Number(
          new BigNumber(Number(assetAmount))
            .multipliedBy(Number(aggregatedData.tokenPriceInLovelaces))
            .dividedBy(Number(aggregatedData.denominator))
        )
      )
    );
  } else {
    throw "Invalid price feed data";
  }
}

export function assetGainAdaSale(
  oracleDatum: OracleValidatorWithdrawValidate["redeemer"],
  sellAmount: bigint,
  assetAPolicyId: string,
  assetATokenName: string
): bigint {
  if ("Pooled" in oracleDatum.data) {
    const pooledData = oracleDatum.data.Pooled.find(
      (item) =>
        item.token.policyId === assetAPolicyId &&
        item.token.assetName === assetATokenName
    );
    if (!pooledData) {
      throw new Error("Token not found in Pooled price feed");
    }

    const sellAmountBN = new BigNumber(Number(sellAmount));
    const token1AmountBN = new BigNumber(Number(pooledData.tokenBAmount));
    const token2AmountBN = new BigNumber(Number(pooledData.tokenAAmount));

    const nominator = sellAmountBN
      .multipliedBy(997)
      .multipliedBy(token1AmountBN);
    const denominator = token2AmountBN
      .multipliedBy(1000)
      .plus(sellAmountBN.multipliedBy(997));

    const result = BigInt(
      nominator
        .dividedBy(denominator)
        .integerValue(BigNumber.ROUND_FLOOR)
        .toString()
    );

    return result;

    // return amount;
  } else if ("Aggregated" in oracleDatum.data) {
    const aggregatedData = oracleDatum.data.Aggregated.find(
      (item) =>
        item.token.policyId === assetAPolicyId &&
        item.token.assetName === assetATokenName
    );
    if (!aggregatedData) {
      throw new Error("Token not found in Aggregated price feed");
    }

    // Assuming a similar calculation is required for Aggregated data
    // Replace with the appropriate logic as needed
    const adaSellAmountBN = new BigNumber(Number(sellAmount));

    const priceInLovelaces = new BigNumber(
      Number(aggregatedData.tokenPriceInLovelaces)
    );
    const denominator = new BigNumber(Number(aggregatedData.denominator));

    return BigInt(
      adaSellAmountBN
        .dividedBy(priceInLovelaces.dividedBy(denominator))
        .integerValue(BigNumber.ROUND_FLOOR)
        .toString()
    );
  } else {
    throw new Error("Invalid price feed data");
  }
}
