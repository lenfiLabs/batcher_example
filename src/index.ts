import { BigNumber } from "bignumber.js";
import {
  Maestro,
  Data,
  Translucent,
  Provider,
  toUnit,
  Credential,
  UTxO,
  MaestroSupportedNetworks,
} from "translucent-cardano";
import deployedValidatorsJson from "./../deployedValidators.json";
import deployedLpsJson from "./../deployedLps.json";
import deployedOraclessJson from "./../deployedOracles.json";
import { MaestroClient, Configuration } from "@maestro-org/typescript-sdk";

import {
  BatcherOutput,
  BorrowMetadataStandard,
  DeployedLPs,
  DeployedValidators,
  OracelValidatorDetails,
  OutputValue,
  PriceFeed,
  Validators,
  ValidityRange,
} from "./types";

import {
  calculateInterestAmount,
  collectValidators,
  findAssetQuantity,
  generateReceiverAddress,
  getPoolArtifacts,
  getValidityRange,
  getValueFromMapBorrow,
  getExpectedValueMap,
  getOutputReference,
  toUnitOrLovelace,
  updateUserValue,
  parseValidators,
  nameFromUTxO,
  getValueFromMap,
  collectOracleDetails,
  getInterestRates,
  getAdaAmountIfSold,
  getAdaAmountIfBought,
  assetGainAdaSale,
  calculateReceivedLptokens,
  getPlatformFee,
} from "./utilities";
import { GOV_TOKEN_NAME } from "./constants";

import {
  CollateralMint,
  CollateralSpend,
  DelayedMergeSpend,
  DelayedMergeWithdrawValidate,
  LeftoversLeftovers,
  LiquidityTokenLiquidityToken,
  OracleValidatorWithdrawValidate,
  OrderContractBorrowOrderContract,
  OrderContractDepositOrderContract,
  OrderContractOutputreftype,
  OrderContractRepayOrderContract,
  OrderContractWithdrawOrderContract,
  PoolSpend,
} from "./plutus";

mainLoop();

async function mainLoop() {
  while (true) {
    console.log("Starting batcher Process. Will build Translucent.");

    const maestroNetwork: MaestroSupportedNetworks =
      process.env.ENVIRONMENT === "Mainnet"
        ? process.env.ENVIRONMENT
        : "Preprod";

    const provider: Provider = new Maestro({
      network: maestroNetwork,
      apiKey: process.env.MAESTRO_KEY || "",
    });

    const lucid = await Translucent.new(provider, maestroNetwork);

    // Order validators are not parameterized by pool or gov tokens.
    const validators = collectValidators(
      lucid,
      "", // Order validators are not parameterized by pool token name.
      GOV_TOKEN_NAME // Gov token name
    );
    // console.log("validators", validators);

    const depositBatcherAddress = lucid.utils.validatorToAddress(
      validators.orderContractDeposit
    );

    const depositBatcherUtxos: UTxO[] = await lucid.utxosAt(
      depositBatcherAddress
    );

    const withdrawBatcherAddress = lucid.utils.validatorToAddress(
      validators.orderContractWithdraw
    );
    const withdrawBatcherUtxos: UTxO[] = await lucid.utxosAt(
      withdrawBatcherAddress
    );

    const repayBatcherAddress = lucid.utils.validatorToAddress(
      validators.orderContractRepay
    );

    const repayBatcherUtxos: UTxO[] = await lucid.utxosAt(repayBatcherAddress);

    const borrowBatcherAddress = lucid.utils.validatorToAddress(
      validators.orderContractBorrow
    );
    const borrowBatcherUtxos: UTxO[] =
      await lucid.utxosAt(borrowBatcherAddress);

    // TODO: this is bad method. Since some of these orders could be spendable at the momennt.

    for (const batcherUtxo of depositBatcherUtxos) {
      console.log("Current tx hash", batcherUtxo.txHash);

      if (batcherUtxo.datum != "d87980") {
        // This is validator deployment TX, that we can conveniently ignore.
        console.log("Deposit");
        // try {
        const txHash = await doThedeposit(lucid, batcherUtxo);
        console.log(`Deposited TX hash: ${txHash}`);
        // } catch {
        //   console.log(`Could not complete order TXhash ${batcherUtxo.txHash}.`);
        // }
      }
    }

    // // Withdraw actions
    for (const batcherUtxo of withdrawBatcherUtxos) {
      console.log("Current tx hash", batcherUtxo.txHash);
      if (batcherUtxo.datum != "d87980") {
        // try {
        console.log("Withdraw");

        const txHash = await doTheWithdraw(lucid, batcherUtxo);
        console.log(`Withdrew TX hash: ${txHash}`);
        // } catch {
        //   console.log(`Could not complete order TXhash ${batcherUtxo.txHash}.`);
        // }
      }
    }

    // // REPAY actions
    for (const batcherUtxo of repayBatcherUtxos) {
      // await new Promise(f => setTimeout(f, 1000));
      console.log("Current tx hash", batcherUtxo.txHash);

      if (batcherUtxo.datum != "d87980") {
        // try {
        console.log("Repay");
        const txHash = await doTheRepay(lucid, batcherUtxo);
        console.log(`Repaid TX hash: ${txHash}`);
        // } catch {
        //   console.log(`Could not complete order TXhash ${batcherUtxo.txHash}.`);
        // }
      }
    }

    // // Borrow actions
    for (const batcherUtxo of borrowBatcherUtxos) {
      console.log("Current tx hash", batcherUtxo.txHash);
      if (batcherUtxo.datum != "d87980") {
        // try {
        console.log("this is borrow");
        const txHash = await doTheBorrow(lucid, batcherUtxo);
        console.log(`Borrowed TX hash: ${txHash}`);
        // } catch {
        //   console.log(`Could not complete order TXhash ${batcherUtxo.txHash}.`);
        // }
      }
    }

    // Merges are created when borrower/liquidator repays or liquidates the loan without closing it.
    // You can close the loan and collect additional fee that was required to be paid in above action.

    const mergeScriptHash = lucid.utils.validatorToScriptHash(
      validators.mergeScript
    );

    const mergeCredential: Credential = {
      type: "Script",
      hash: mergeScriptHash,
    };

    const mergeUtxos: UTxO[] = await lucid.provider.getUtxos(mergeCredential);

    for (const mergeUtxo of mergeUtxos) {
      console.log("Current tx hash", mergeUtxo.txHash);
      if (mergeUtxo.datum != "d87980") {
        const txHash = await doTheMerge(lucid, mergeUtxo);

        // } catch {
        //   console.log(`Could not complete order TXhash ${batcherUtxo.txHash}.`);
        // }
      }
    }

    // You are free to test liquidating your own (even overcollaterized) loan. Keep in mind you will need to adjust token price in oracleDetails.
    const utxoToLiquidate = await lucid.utxosByOutRef([
      {
        txHash:
          "eaf4d594c79e92bef951eac80f5b7db6cc24fcab3b9339660f85faf116706427",
        outputIndex: 1,
      },
    ]);

    const txHash = await doTheLiquidation(lucid, utxoToLiquidate[0]);

    console.log("liquidation TX hash", txHash);

    await new Promise((f) => setTimeout(f, 30000));
  }
}

async function doThedeposit(
  lucid: Translucent,
  batcherUtxo: UTxO
): Promise<string> {
  let batcherDatumMapped: OrderContractDepositOrderContract["datum"];

  try {
    batcherDatumMapped = await lucid.datumOf(
      batcherUtxo,
      OrderContractDepositOrderContract.datum
    );
  } catch {
    throw "Could not cast batcher datum type.";
  }

  const poolNftName = batcherDatumMapped.poolNftCs.assetName;
  let continuingOutputIdx = 0n;

  const validators: Validators = collectValidators(
    lucid,
    poolNftName,
    GOV_TOKEN_NAME
  );

  const poolArtifacts = await getPoolArtifacts(poolNftName, validators, lucid);
  const poolAddress = poolArtifacts.poolUTxO.address;
  var poolDatumMapped = poolArtifacts.poolDatumMapped;

  const lpTokensToReceive: number = calculateReceivedLptokens(
    poolDatumMapped.balance,
    poolDatumMapped.lentOut,
    batcherDatumMapped.order.depositAmount,
    poolDatumMapped.totalLpTokens
  );

  // const lpTokensToDeposit = lpTokensToDepositDetails.lpTokenMintAmount // THIS is known bug in SC (requires to mint more LP than needed) Is fixed in later version.

  const batcherRedeemer: OrderContractDepositOrderContract["redeemer"] = {
    Process: {
      poolOref: getOutputReference(poolArtifacts.poolUTxO),
      additionalData: undefined,
    },
  };

  const receiverAddress = generateReceiverAddress(
    lucid,
    batcherDatumMapped.order.partialOutput.address
  );

  const toReceive = {
    [poolDatumMapped.params.lpToken.policyId +
    poolDatumMapped.params.lpToken.assetName]: BigInt(lpTokensToReceive),
  };

  let valueForUserToReceive: OutputValue = {};

  for (const [policyId, assetMap] of batcherDatumMapped.order.partialOutput
    .value) {
    for (const [assetName, amount] of assetMap) {
      valueForUserToReceive[toUnitOrLovelace(policyId, assetName)] = amount;
    }
  }

  // Add new value to the datum value
  valueForUserToReceive = updateUserValue(valueForUserToReceive, toReceive);

  const deployedValidators: DeployedValidators = parseValidators(
    deployedValidatorsJson
  );
  const deployedLps: DeployedLPs = deployedLpsJson;

  const deployedLpRef = poolDatumMapped.params.lpToken.policyId;

  let lpValidatorRef: UTxO[] = [];

  if (deployedLps[deployedLpRef] !== undefined) {
    lpValidatorRef = await lucid.utxosByOutRef([
      {
        txHash: deployedLps[poolDatumMapped.params.lpToken.policyId].txHash,
        outputIndex:
          deployedLps[poolDatumMapped.params.lpToken.policyId].txOref,
      },
    ]);
  }

  let datum = "";

  const thisOref: OrderContractOutputreftype["_redeemer"] = {
    transactionId: { hash: batcherUtxo.txHash },
    outputIndex: BigInt(batcherUtxo.outputIndex),
  };

  datum = Data.to(thisOref, OrderContractOutputreftype._redeemer);

  const receiverDetails: BatcherOutput = {
    receiverAddress,
    datum: { inline: datum },
    value: valueForUserToReceive,
  };
  const balanceToDeposit = batcherDatumMapped.order.depositAmount;

  poolDatumMapped.balance = BigInt(
    poolDatumMapped.balance +
      BigInt(balanceToDeposit) +
      poolArtifacts.poolConfigDatum.poolFee
  );

  poolDatumMapped.totalLpTokens = BigInt(
    poolDatumMapped.totalLpTokens + BigInt(lpTokensToReceive)
  );

  const poolRedeemer: PoolSpend["redeemer"] = {
    wrapper: {
      action: {
        Continuing: [
          {
            LpAdjust: {
              valueDelta: balanceToDeposit,
              continuingOutput: continuingOutputIdx,
            },
          },
        ],
      },
      configRef: getOutputReference(poolArtifacts.configUTxO),
      order: getOutputReference(batcherUtxo),
    },
  };

  const lpTokenRedeemer: LiquidityTokenLiquidityToken["redeemer"] = {
    TransitionPool: {
      poolOref: getOutputReference(poolArtifacts.poolUTxO),
      continuingOutput: continuingOutputIdx,
    },
  };

  let metadata = {
    msg: ["Lenfi: deposit executed."],
  };

  const loanAssetName = toUnitOrLovelace(
    poolDatumMapped.params.loanCs.policyId,
    poolDatumMapped.params.loanCs.assetName
  );

  if (process.env.BATCHER_KEY == null) {
    throw "BATCHER_KEY is not defined";
  }

  lucid.selectWalletFromPrivateKey(
    process.env.BATCHER_KEY // On production you will must have your own wallet.
  );

  let tx = lucid
    .newTx()
    .readFrom([deployedValidators.poolValidator])
    .collectFrom(
      [poolArtifacts.poolUTxO],
      Data.to(poolRedeemer, PoolSpend.redeemer)
    )
    .readFrom([deployedValidators.orderContractDeposit])
    .collectFrom(
      [batcherUtxo],
      Data.to(batcherRedeemer, OrderContractDepositOrderContract.redeemer)
    )
    .readFrom([poolArtifacts.configUTxO])
    .payToContract(
      poolAddress,
      { inline: Data.to(poolDatumMapped, PoolSpend.datum) },
      {
        [loanAssetName]: poolDatumMapped.balance,
        [toUnit(validators.poolScriptHash, poolNftName)]: BigInt(1),
      }
    )
    .payToContract(
      receiverDetails.receiverAddress,
      receiverDetails.datum,
      receiverDetails.value
    )
    .readFrom(lpValidatorRef)
    .mintAssets(
      {
        [toUnit(validators.lpTokenPolicyId, poolNftName)]:
          BigInt(lpTokensToReceive),
      },
      Data.to(lpTokenRedeemer, LiquidityTokenLiquidityToken.redeemer)
    )
    .attachMetadata(674, metadata);

  if (lpValidatorRef.length == 0) {
    console.log("Did not find LP policy. Will attach");

    tx.attachMintingPolicy(validators.lpTokenPolicy);
  }

  const completedTx = await tx.complete();

  console.log("Off-chain validation passed, will sign the transaction");

  const signedTx = await completedTx.sign().complete();
  // const txHash = await signedTx.submit();
  const txHash = "";
  await lucid.awaitTx(txHash);
  return txHash;
}

async function doTheWithdraw(
  lucid: Translucent,
  batcherUtxo: UTxO
): Promise<string> {
  let batcherDatumMapped: OrderContractWithdrawOrderContract["datum"];

  try {
    batcherDatumMapped = await lucid.datumOf(
      batcherUtxo,
      OrderContractWithdrawOrderContract.datum
    );
  } catch {
    throw "Could not cast batcher datum type.";
  }

  const continuingOutputIdx = 0n;
  const poolNftName = batcherDatumMapped.poolNftCs.assetName;

  const validators: Validators = collectValidators(
    lucid,
    poolNftName,
    GOV_TOKEN_NAME
  );

  const poolArtifacts = await getPoolArtifacts(poolNftName, validators, lucid);
  const poolAddress = poolArtifacts.poolUTxO.address;
  var poolDatumMapped = poolArtifacts.poolDatumMapped;

  const lpTokensInBatcher: number = await findAssetQuantity(
    [batcherUtxo],
    validators.lpTokenPolicyId,
    poolDatumMapped.params.poolNftName
  );


  if (batcherDatumMapped.order.lpTokensBurn > lpTokensInBatcher) {
    console.log("Trying to withdraw more than available");
    return "";
  }

  if (Number(lpTokensInBatcher) === 0) {
    console.log("Trying to withdraw 0");
    return "";
  }

  const initialCountBN = new BigNumber(
    Number(batcherDatumMapped.order.lpTokensBurn)
  );
  const balanceBN = new BigNumber(
    Number(poolDatumMapped.balance + poolDatumMapped.lentOut)
  );
  const totalLPTokensBN = new BigNumber(Number(poolDatumMapped.totalLpTokens));

  let amountToReceive = BigInt(
    Math.floor(
      initialCountBN
        .multipliedBy(balanceBN)
        .dividedToIntegerBy(totalLPTokensBN)
        .toNumber()
    )
  );

  poolDatumMapped.balance =
    poolDatumMapped.balance -
    BigInt(amountToReceive) +
    poolArtifacts.poolConfigDatum.poolFee;

  poolDatumMapped.totalLpTokens =
    poolDatumMapped.totalLpTokens -
    BigInt(batcherDatumMapped.order.lpTokensBurn);

  if (Number(poolDatumMapped.totalLpTokens) === 0) {
    console.log("Trying to withdraw all");
    return "";
  }

  const poolRedeemer: PoolSpend["redeemer"] = {
    wrapper: {
      action: {
        Continuing: [
          {
            LpAdjust: {
              valueDelta: amountToReceive * -1n,
              continuingOutput: continuingOutputIdx,
            },
          },
        ],
      },
      configRef: getOutputReference(poolArtifacts.configUTxO),
      order: getOutputReference(batcherUtxo),
    },
  };

  const lpTokenRedeemer: LiquidityTokenLiquidityToken["redeemer"] = {
    TransitionPool: {
      poolOref: getOutputReference(poolArtifacts.poolUTxO),
      continuingOutput: continuingOutputIdx,
    },
  };

  const batcherRedeemer: OrderContractDepositOrderContract["redeemer"] = {
    Process: {
      poolOref: getOutputReference(poolArtifacts.poolUTxO),
      additionalData: undefined,
    },
  };

  const deployedValidators: DeployedValidators = parseValidators(
    deployedValidatorsJson
  );
  const deployedLps: DeployedLPs = deployedLpsJson;
  const deployedLpRef = poolDatumMapped.params.lpToken.policyId;
  let lpValidatorRef: UTxO[] = [];

  if (deployedLps[deployedLpRef] !== undefined) {
    lpValidatorRef = await lucid.utxosByOutRef([
      {
        txHash: deployedLps[poolDatumMapped.params.lpToken.policyId].txHash,
        outputIndex:
          deployedLps[poolDatumMapped.params.lpToken.policyId].txOref,
      },
    ]);
  }

  let datum = "";

  const thisOref: OrderContractOutputreftype["_redeemer"] = {
    transactionId: { hash: batcherUtxo.txHash },
    outputIndex: BigInt(batcherUtxo.outputIndex),
  };

  datum = Data.to(thisOref, OrderContractOutputreftype._redeemer);
  const receiverAddress = generateReceiverAddress(
    lucid,
    batcherDatumMapped.order.partialOutput.address
  );

  let metadata = {
    msg: ["Lenfi: withdraw executed."],
  };

  const toReceive = {
    [toUnitOrLovelace(
      poolDatumMapped.params.loanCs.policyId,
      poolDatumMapped.params.loanCs.assetName
    )]: amountToReceive,
  };

  let valueForUserToReceive: OutputValue = {};

  for (const [policyId, assetMap] of batcherDatumMapped.order.partialOutput
    .value) {
    for (const [assetName, amount] of assetMap) {
      valueForUserToReceive[toUnitOrLovelace(policyId, assetName)] = amount;
    }
  }

  // Add new value to the datum value
  valueForUserToReceive = updateUserValue(valueForUserToReceive, toReceive);

  const receiverDetails: BatcherOutput = {
    receiverAddress,
    datum: { inline: datum },
    value: valueForUserToReceive,
  };

  if (process.env.BATCHER_KEY == null) {
    throw "BATCHER_KEY is not defined";
  }

  lucid.selectWalletFromPrivateKey(
    process.env.BATCHER_KEY // On production you will must have your own wallet.
  );

  let tx = lucid
    .newTx()
    .readFrom([deployedValidators.poolValidator])
    .collectFrom(
      [poolArtifacts.poolUTxO],
      Data.to(poolRedeemer, PoolSpend.redeemer)
    )
    .readFrom([deployedValidators.orderContractWithdraw])
    .collectFrom(
      [batcherUtxo],
      Data.to(batcherRedeemer, OrderContractWithdrawOrderContract.redeemer)
    )
    .readFrom([poolArtifacts.configUTxO])
    .payToContract(
      poolAddress,
      { inline: Data.to(poolDatumMapped, PoolSpend.datum) },
      {
        [toUnitOrLovelace(
          poolDatumMapped.params.loanCs.policyId,
          poolDatumMapped.params.loanCs.assetName
        )]: poolDatumMapped.balance,
        [toUnit(validators.poolScriptHash, poolNftName)]: BigInt(1),
      }
    )
    .payToContract(
      receiverDetails.receiverAddress,
      receiverDetails.datum,
      receiverDetails.value
    )
    .readFrom(lpValidatorRef)
    .mintAssets(
      {
        [toUnit(validators.lpTokenPolicyId, poolNftName)]: BigInt(
          BigInt(batcherDatumMapped.order.lpTokensBurn) * -1n
        ),
      },
      Data.to(lpTokenRedeemer, LiquidityTokenLiquidityToken.redeemer)
    )
    .attachMetadata(674, metadata);

  if (lpValidatorRef.length == 0) {
    console.log("Did not find LP policy. Will attach");

    tx.attachMintingPolicy(validators.lpTokenPolicy);
  }

  const txBuild = await tx.complete();

  console.log("Off-chain validation passed, will sign the transaction");

  const signedTx = await txBuild.sign().complete();
  const txHash = await signedTx.submit();
  await lucid.awaitTx(txHash);
  return txHash;
}

async function doTheBorrow(
  lucid: Translucent,
  batcherUtxo: UTxO
): Promise<string> {
  const batcherDatumMapped: OrderContractBorrowOrderContract["datum"] =
    await lucid.datumOf(batcherUtxo, OrderContractBorrowOrderContract.datum);

  const poolNftName = batcherDatumMapped.poolNftCs.assetName;
  let continuingOutputIdx = 0n;

  const validators: Validators = collectValidators(
    lucid,
    poolNftName,
    GOV_TOKEN_NAME
  );
  const poolArtifacts = await getPoolArtifacts(poolNftName, validators, lucid);
  const poolAddress = poolArtifacts.poolUTxO.address;

  const poolStakeCredentials: Credential = {
    type: "Script",
    hash: poolNftName,
  };

  const collateralContractAddress = lucid.utils.validatorToAddress(
    validators.collateralValidator,
    poolStakeCredentials
  );

  var poolDatumMapped: PoolSpend["datum"] = poolArtifacts.poolDatumMapped;
  const poolConfigDatum = poolArtifacts.poolConfigDatum;

  const borrowerTokenName = nameFromUTxO(poolArtifacts.poolUTxO);
  const collateralAmount = batcherDatumMapped.order.minCollateralAmount;

  const expectedOrderValue = batcherDatumMapped.order.expectedOutput.value;

  const loanAmount: bigint | null = getValueFromMap(
    expectedOrderValue,
    poolArtifacts.poolDatumMapped.params.loanCs.policyId,
    poolArtifacts.poolDatumMapped.params.loanCs.assetName
  );

  if (typeof loanAmount != "bigint") {
    throw "Could not find amount to receive";
  }

  if (loanAmount >= poolDatumMapped.balance) {
    console.log("trying to borrow more than pool has");
    return "";
  }

  poolDatumMapped.balance =
    poolDatumMapped.balance - loanAmount + poolConfigDatum.poolFee;
  poolDatumMapped.lentOut = poolDatumMapped.lentOut + loanAmount;

  let interestRate = getInterestRates(
    poolConfigDatum.interestParams,
    loanAmount,
    poolDatumMapped.lentOut,
    poolDatumMapped.balance
  );

  if (Number(interestRate) > Number(batcherDatumMapped.order.maxInterestRate)) {
    console.log("Interest rate is too high");
    return "";
  }

  const poolRedeemer: PoolSpend["redeemer"] = {
    wrapper: {
      action: {
        Continuing: [
          {
            Borrow: {
              loanAmount: loanAmount,
              collateralAmount: collateralAmount,
              borrowerTn: borrowerTokenName,
              interestRate: interestRate,
              continuingOutput: continuingOutputIdx,
            },
          },
        ],
      },
      configRef: getOutputReference(poolArtifacts.configUTxO),
      order: getOutputReference(batcherUtxo),
    },
  };

  const batcherRedeemer: OrderContractBorrowOrderContract["redeemer"] = {
    Process: {
      poolOref: getOutputReference(poolArtifacts.poolUTxO),
      additionalData: {
        borrowerTokenName: borrowerTokenName,
        additionalAda: 0n,
      },
    },
  };

  const borrowerTokenRedeemer: CollateralMint["redeemer"] = {
    mints: [
      {
        outputReference: {
          transactionId: { hash: poolArtifacts.poolUTxO.txHash },
          outputIndex: BigInt(poolArtifacts.poolUTxO.outputIndex),
        },
        outputPointer: 1n,
      },
    ],
    burns: [],
  };

  const validityRange: ValidityRange = getValidityRange(lucid);

  let collateralData: CollateralSpend["datum"] = {
    poolNftName: poolNftName,
    loanCs: poolDatumMapped.params.loanCs,
    loanAmount: loanAmount,
    poolConfig: poolArtifacts.poolConfigDatum,
    collateralCs: poolDatumMapped.params.collateralCs,
    collateralAmount: collateralAmount,
    interestRate: interestRate,
    depositTime: BigInt(validityRange.validFrom),
    borrowerTn: borrowerTokenName,
    oracleCollateralAsset: poolDatumMapped.params.oracleCollateralAsset,
    oracleLoanAsset: poolDatumMapped.params.oracleLoanAsset,
    tag: {
      transactionId: { hash: batcherUtxo.txHash },
      outputIndex: BigInt(batcherUtxo.outputIndex),
    },
    lentOut: poolDatumMapped.lentOut - loanAmount,
    balance: poolDatumMapped.balance + loanAmount,
  };

  const maestroNetwork: MaestroSupportedNetworks =
    process.env.ENVIRONMENT === "Mainnet" ? process.env.ENVIRONMENT : "Preprod";

  if (process.env.MAESTRO_KEY == null) {
    throw "MAESTRO_KEY is not defined";
  }

  let maestroClient = new MaestroClient(
    new Configuration({
      apiKey: process.env.MAESTRO_KEY,
      network: maestroNetwork,
    })
  );

  const transactionInfo = await maestroClient.transactions.txInfo(
    batcherUtxo.txHash
  );
  const transactionMetadata: BorrowMetadataStandard =
    transactionInfo.data.metadata;

  let oracleDetails: OracelValidatorDetails[] = [];

  if (poolDatumMapped.params.loanCs.policyId !== "") {
    const oracleResult = await collectOracleDetails(
      poolDatumMapped.params.oracleLoanAsset,
      poolDatumMapped.params.loanCs,
      Number(transactionMetadata["404"]?.a),
      Number(transactionMetadata["404"]?.l),
      lucid,
      oracleDetails
    );
    oracleDetails = oracleResult.oracleDetails;
  }

  if (poolDatumMapped.params.collateralCs.policyId !== "") {
    const oracleResult = await collectOracleDetails(
      poolDatumMapped.params.oracleCollateralAsset,
      poolDatumMapped.params.collateralCs,
      Number(transactionMetadata["405"]?.a),
      Number(transactionMetadata["405"]?.l),
      lucid,
      oracleDetails
    );
    oracleDetails = oracleResult.oracleDetails;
  }

  let metadata = {
    msg: ["Lenfi: borrow executed."],
  };

  const receiverAddress = generateReceiverAddress(
    lucid,
    batcherDatumMapped.order.partialOutput.address
  );

  const loanToReceive = getExpectedValueMap(
    batcherDatumMapped.order.expectedOutput.value
  );

  const partialOutput = getExpectedValueMap(
    batcherDatumMapped.order.partialOutput.value
  );

  partialOutput[toUnit(validators.collateralValidatorHash, borrowerTokenName)] =
    1n;

  const toReceive = {
    [toUnit(validators.collateralValidatorHash, borrowerTokenName)]: 1n,
  };

  let valueForUserToReceive: OutputValue = {};

  for (const [policyId, assetMap] of batcherDatumMapped.order.partialOutput
    .value) {
    for (const [assetName, amount] of assetMap) {
      valueForUserToReceive[toUnitOrLovelace(policyId, assetName)] = amount;
    }
  }
  // Add new value to the datum value
  valueForUserToReceive = updateUserValue(valueForUserToReceive, toReceive);

  const receiverDetails: BatcherOutput[] = [
    {
      receiverAddress, // partial output
      datum: "",
      value: valueForUserToReceive,
    },
    {
      receiverAddress,
      datum: "",
      value: loanToReceive,
    },
  ];

  if (process.env.BATCHER_KEY == null) {
    throw "BATCHER_KEY is not defined";
  }

  lucid.selectWalletFromPrivateKey(process.env.BATCHER_KEY);
  const deployedValidators: DeployedValidators = parseValidators(
    deployedValidatorsJson
  );

  const tx = lucid
    .newTx()
    .readFrom([deployedValidators.poolValidator])
    .collectFrom(
      [poolArtifacts.poolUTxO],
      Data.to(poolRedeemer, PoolSpend.redeemer)
    )
    .readFrom([poolArtifacts.configUTxO])
    .payToContract(
      poolAddress,
      { inline: Data.to(poolDatumMapped, PoolSpend.datum) },
      {
        [toUnitOrLovelace(
          poolDatumMapped.params.loanCs.policyId,
          poolDatumMapped.params.loanCs.assetName
        )]: BigInt(poolDatumMapped.balance),
        [toUnit(validators.poolScriptHash, poolNftName)]: 1n,
      }
    )
    .payToContract(
      collateralContractAddress,
      { inline: Data.to(collateralData, CollateralSpend.datum) },
      {
        [toUnitOrLovelace(
          poolDatumMapped.params.collateralCs.policyId,
          poolDatumMapped.params.collateralCs.assetName
        )]: BigInt(collateralAmount),
      }
    )
    .readFrom([deployedValidators.orderContractBorrow])
    .collectFrom(
      [batcherUtxo],
      Data.to(batcherRedeemer, OrderContractBorrowOrderContract.redeemer)
    )
    .payToAddress(receiverDetails[0].receiverAddress, receiverDetails[0].value)
    .payToAddress(receiverDetails[1].receiverAddress, receiverDetails[1].value)
    .readFrom([deployedValidators.collateralValidator])
    .mintAssets(
      {
        [toUnit(validators.collateralValidatorHash, borrowerTokenName)]: 1n,
      },
      Data.to(borrowerTokenRedeemer, CollateralMint.redeemer)
    )
    .validFrom(validityRange.validFrom)
    .validTo(validityRange.validTo)
    .attachMetadata(674, metadata);

  oracleDetails.forEach(async (oracle) => {
    tx.withdraw(
      oracle.rewardAddress,
      0n,
      Data.to(oracle.redeemer, OracleValidatorWithdrawValidate.redeemer)
    )
      .readFrom([oracle.scriptReferenceUtxo])
      .readFrom([oracle.nftReferenceUtxo]);
  });

  const completedTx = await tx.complete();

  console.log("Off-chain validation passed, will sign the transaction");
  const signedTx = await completedTx.sign().complete();
  const txHash = await signedTx.submit();

  await lucid.awaitTx(txHash);
  return txHash;
}

async function doTheRepay(
  lucid: Translucent,
  batcherUtxo: UTxO
): Promise<string> {
  const batcherDatumMapped: OrderContractRepayOrderContract["datum"] =
    await lucid.datumOf(batcherUtxo, OrderContractRepayOrderContract.datum);
  const continuingOutputIdx = 0n;

  const poolNftName = batcherDatumMapped.poolNftCs.assetName;

  const validators: Validators = await collectValidators(
    lucid,
    poolNftName,
    GOV_TOKEN_NAME
  );

  const poolArtifacts = await getPoolArtifacts(poolNftName, validators, lucid);
  var poolDatumMapped: PoolSpend["datum"] = poolArtifacts.poolDatumMapped;
  const poolAddress = poolArtifacts.poolUTxO.address;

  const receiverAddress = generateReceiverAddress(
    lucid,
    batcherDatumMapped.order.expectedOutput.address
  );

  const utxosToConsumeCollateral: UTxO[] = await lucid.utxosByOutRef([
    {
      txHash: batcherDatumMapped.order.order.transactionId.hash,
      outputIndex: Number(batcherDatumMapped.order.order.outputIndex),
    },
  ]);

  const utxoToConsumeCollateral = utxosToConsumeCollateral[0];

  const collateralDatumMapped: CollateralSpend["datum"] = await lucid.datumOf(
    utxoToConsumeCollateral,
    CollateralSpend.datum
  );

  const validityRange: ValidityRange = getValidityRange(lucid);

  // Calculate amount of LP tokens to be minted
  const acumulatedInterest = calculateInterestAmount(
    collateralDatumMapped.interestRate,
    collateralDatumMapped.loanAmount,
    collateralDatumMapped.depositTime,
    validityRange.validTo
  );

  const loanPlusInterest =
    acumulatedInterest + collateralDatumMapped.loanAmount;

  poolDatumMapped.balance =
    poolDatumMapped.balance +
    loanPlusInterest +
    poolArtifacts.poolConfigDatum.poolFee;

  poolDatumMapped.lentOut =
    poolDatumMapped.lentOut - BigInt(collateralDatumMapped.loanAmount);

  const poolRedeemer: PoolSpend["redeemer"] = {
    wrapper: {
      action: {
        Continuing: [
          {
            CloseLoan: {
              loanAmount: BigInt(collateralDatumMapped.loanAmount),
              repayAmount:
                BigInt(collateralDatumMapped.loanAmount) +
                BigInt(acumulatedInterest),
              continuingOutput: continuingOutputIdx,
            },
          },
        ],
      },
      configRef: getOutputReference(poolArtifacts.configUTxO),
      order: getOutputReference(batcherUtxo),
    },
  };

  const collateralAmount = getValueFromMapBorrow(
    batcherDatumMapped,
    poolDatumMapped.params.collateralCs.policyId,
    poolDatumMapped.params.collateralCs.assetName
  );

  if (typeof collateralAmount != "bigint") {
    throw "Could not find amount to receive";
  }

  const collateralRedeemer: CollateralSpend["redeemer"] = {
    wrapper: {
      action: "CollateralRepay",
      interest: acumulatedInterest,
      mergeType: {
        ImmediateWithPool: [
          {
            transactionId: {
              hash: poolArtifacts.poolUTxO.txHash,
            },
            outputIndex: BigInt(poolArtifacts.poolUTxO.outputIndex),
          },
        ],
      },
    },
  };

  const burnRedeemer: CollateralMint["redeemer"] = {
    mints: [],
    burns: [{ tokenName: collateralDatumMapped.borrowerTn }],
  };

  const batcherRedeemer: OrderContractRepayOrderContract["redeemer"] = {
    Process: {
      poolOref: {
        transactionId: { hash: poolArtifacts.poolUTxO.txHash },
        outputIndex: BigInt(poolArtifacts.poolUTxO.outputIndex),
      },
      additionalData: undefined,
    },
  };

  const deployedValidators: DeployedValidators = parseValidators(
    deployedValidatorsJson
  );

  let metadata = {
    msg: ["Lenfi: REPAY EXECUTED the pool."],
  };

  const collateralToReceive = getExpectedValueMap(
    batcherDatumMapped.order.expectedOutput.value
  );

  if (process.env.BATCHER_KEY == null) {
    throw "BATCHER_KEY is not defined";
  }

  lucid.selectWalletFromPrivateKey(
    process.env.BATCHER_KEY // On production you will must have your own wallet.
  );

  const tx = lucid
    .newTx()
    .readFrom([deployedValidators.poolValidator])
    .readFrom([poolArtifacts.configUTxO])
    .collectFrom(
      [poolArtifacts.poolUTxO],
      Data.to(poolRedeemer, PoolSpend.redeemer)
    )
    .readFrom([deployedValidators.orderContractRepay])
    .collectFrom(
      [batcherUtxo],
      Data.to(batcherRedeemer, OrderContractRepayOrderContract.redeemer)
    )
    .readFrom([deployedValidators.collateralValidator])
    .collectFrom(
      [utxoToConsumeCollateral],
      Data.to(collateralRedeemer, CollateralSpend.redeemer)
    )
    .payToContract(
      poolAddress,
      { inline: Data.to(poolDatumMapped, PoolSpend.datum) },
      {
        [toUnitOrLovelace(
          poolDatumMapped.params.loanCs.policyId,
          poolDatumMapped.params.loanCs.assetName
        )]: poolDatumMapped.balance,
        [toUnit(validators.poolScriptHash, poolNftName)]: BigInt(1),
      }
    )
    .payToAddress(receiverAddress, collateralToReceive)
    .mintAssets(
      {
        [toUnit(
          batcherDatumMapped.order.burnAsset.policyId,
          batcherDatumMapped.order.burnAsset.assetName
        )]: BigInt(-1),
      },
      Data.to(burnRedeemer, CollateralMint.redeemer)
    )
    .attachMetadata(674, metadata)
    .validFrom(validityRange.validFrom)
    .validTo(validityRange.validTo);

  const platformFee = getPlatformFee(
    collateralDatumMapped.loanAmount,
    collateralDatumMapped.balance,
    collateralDatumMapped.lentOut,
    collateralDatumMapped.poolConfig.loanFeeDetails
  );

  if (platformFee > 0n) {
    const datum = Data.to(collateralDatumMapped.borrowerTn);

    let feeAmount = (acumulatedInterest * platformFee) / 1000000n;

    const fee_receiver_address = generateReceiverAddress(
      lucid,
      poolArtifacts.poolConfigDatum.loanFeeDetails.platformFeeCollectorAddress
    );

    tx.payToContract(
      fee_receiver_address,
      {
        inline: datum,
      },
      {
        [toUnitOrLovelace(
          poolDatumMapped.params.loanCs.policyId,
          poolDatumMapped.params.loanCs.assetName
        )]: feeAmount,
      }
    );
  }
  const txBuild = await tx.complete();

  console.log("Off-chain validation passed, will sign the transaction");

  const signedTx = await txBuild.sign().complete();
  const txHash = await signedTx.submit();
  await lucid.awaitTx(txHash);
  return txHash;
}

async function doTheMerge(
  lucid: Translucent,
  mergeUtxo: UTxO
): Promise<string> {
  const mergeDatumMapped: DelayedMergeSpend["_datum"] = await lucid.datumOf(
    mergeUtxo,
    DelayedMergeSpend._datum
  );
  console.log("merge datym:", mergeDatumMapped);
  const continuingOutputIdx = 0n;

  const poolTokenName = mergeDatumMapped.poolNftName;
  const validityRange: ValidityRange = getValidityRange(lucid);
  const validators: Validators = await collectValidators(
    lucid,
    poolTokenName,
    GOV_TOKEN_NAME
  );

  const poolArtifacts = await getPoolArtifacts(
    poolTokenName,
    validators,
    lucid
  );

  var poolDatumMapped: PoolSpend["datum"] = poolArtifacts.poolDatumMapped;

  const poolAddress = poolArtifacts.poolUTxO.address;

  const utxoToConsumeMerge: UTxO[] = await lucid.utxosByOutRef([
    {
      txHash: mergeUtxo.txHash,
      outputIndex: Number(mergeUtxo.outputIndex),
    },
  ]);

  const mergeContractRedeemer: DelayedMergeSpend["_r"] = {
    wrapper: Data.void(),
  };

  const poolRedeemer: PoolSpend["redeemer"] = {
    wrapper: {
      action: {
        Continuing: [
          {
            CloseLoan: {
              loanAmount: mergeDatumMapped.loanAmount,
              repayAmount: mergeDatumMapped.repayAmount,
              continuingOutput: 0n,
            },
          },
        ],
      },
      configRef: {
        transactionId: { hash: poolArtifacts.configUTxO.txHash },
        outputIndex: BigInt(poolArtifacts.configUTxO.outputIndex),
      },
      order: null,
    },
  };

  poolDatumMapped.balance =
    poolDatumMapped.balance +
    mergeDatumMapped.repayAmount +
    poolArtifacts.poolConfigDatum.poolFee;

  poolDatumMapped.lentOut =
    poolDatumMapped.lentOut - mergeDatumMapped.loanAmount;

  const deployedValidators: DeployedValidators = parseValidators(
    deployedValidatorsJson
  );

  let metadata = {
    msg: ["Lenfi: MERGE to the pool."],
  };

  if (process.env.BATCHER_KEY == null) {
    throw "BATCHER_KEY is not defined";
  }

  lucid.selectWalletFromPrivateKey(
    process.env.BATCHER_KEY // On production you will must have your own wallet.
  );
  const tx = await lucid
    .newTx()
    .readFrom([deployedValidators.poolValidator])
    .collectFrom(
      [poolArtifacts.poolUTxO],
      Data.to(poolRedeemer, PoolSpend.redeemer)
    )
    .payToContract(
      poolAddress,
      {
        inline: Data.to(poolDatumMapped, PoolSpend.datum),
      },
      {
        [toUnitOrLovelace(
          poolDatumMapped.params.loanCs.policyId,
          poolDatumMapped.params.loanCs.assetName
        )]: poolDatumMapped.balance,
        [toUnit(validators.poolScriptHash, poolTokenName)]: 1n,
      }
    )
    .readFrom([deployedValidators.mergeScript])
    .collectFrom(
      utxoToConsumeMerge,
      Data.to(mergeContractRedeemer, DelayedMergeSpend._r)
    )
    .readFrom([poolArtifacts.configUTxO])
    .attachMetadata(674, metadata)
    .withdraw(
      lucid.utils.validatorToRewardAddress(validators.mergeScript),
      0n,
      Data.to(poolTokenName, DelayedMergeWithdrawValidate.poolNftNameRedeemer)
    )
    .complete();

  console.log("Off-chain validation passed, will sign the transaction");

  const signedTx = await tx.sign().complete();
  const txHash = await signedTx.submit();
  await lucid.awaitTx(txHash);
  return txHash;
}

// This is liquidation TX generation logic. However you need to figure out which loan (utxo in collateral contract) can be liquidated.
async function doTheLiquidation(
  lucid: Translucent,
  collateralUtxo: UTxO
): Promise<string> {
  console.log("this is liquidation");

  const collateralDatumMapped: CollateralSpend["datum"] = await lucid.datumOf(
    collateralUtxo,
    CollateralSpend.datum
  );

  let continuingOutputIdx = 0n;
  let tx = lucid.newTx();

  const validators: Validators = collectValidators(
    lucid,
    collateralDatumMapped.poolNftName,
    GOV_TOKEN_NAME
  );
  const poolNftName = collateralDatumMapped.poolNftName;

  const poolArtifacts = await getPoolArtifacts(poolNftName, validators, lucid);
  var poolDatumMapped: PoolSpend["datum"] = poolArtifacts.poolDatumMapped;
  const poolAddress = poolArtifacts.poolUTxO.address;

  const validityRange: ValidityRange = getValidityRange(lucid);

  const poolStakeCredentials: Credential = {
    type: "Script",
    hash: poolNftName,
  };

  // Calculate amount of LP tokens to be minted
  const accumulatedInterest = calculateInterestAmount(
    collateralDatumMapped.interestRate,
    collateralDatumMapped.loanAmount,
    collateralDatumMapped.depositTime,
    validityRange.validTo
  );

  const loanPlusInterest =
    accumulatedInterest + collateralDatumMapped.loanAmount;

  poolDatumMapped.balance =
    poolDatumMapped.balance +
    loanPlusInterest +
    poolArtifacts.poolConfigDatum.poolFee;

  poolDatumMapped.lentOut =
    poolDatumMapped.lentOut - BigInt(collateralDatumMapped.loanAmount);

  const collateralRedeemer: CollateralSpend["redeemer"] = {
    wrapper: {
      action: { CollateralLiquidate: [continuingOutputIdx] },
      interest: accumulatedInterest,
      mergeType: {
        ImmediateWithPool: [
          {
            transactionId: {
              hash: poolArtifacts.poolUTxO.txHash,
            },
            outputIndex: BigInt(poolArtifacts.poolUTxO.outputIndex),
          },
        ],
      },
    },
  };

  let oracleDetails: OracelValidatorDetails[] = [];

  // When liquidating you have to define asset price.
  const loanAssetPrice = {
    amount: 200000000000000,
    lovelaces: 200000000000000,
  };

  const collateralAssetPrice = {
    amount: 100000000000000,
    lovelaces: 500000000000000,
  };

  let debtValueInAda = collateralDatumMapped.loanAmount + accumulatedInterest;
  let loanTokenPriceFeed: PriceFeed = {
    Pooled: [
      {
        token: { policyId: "", assetName: "" },
        tokenAAmount: 0n,
        tokenBAmount: 0n,
        validTo: 0n,
      },
    ],
  };

  let collateralTokenPriceFeed: PriceFeed = {
    Pooled: [
      {
        token: { policyId: "", assetName: "" },
        tokenAAmount: 0n,
        tokenBAmount: 0n,
        validTo: 0n,
      },
    ],
  };

  if (poolDatumMapped.params.loanCs.policyId !== "") {
    const oracleDetailsResult = await collectOracleDetails(
      poolDatumMapped.params.oracleLoanAsset,
      poolDatumMapped.params.loanCs,
      loanAssetPrice.amount,
      loanAssetPrice.lovelaces,
      lucid,
      oracleDetails
    );
    oracleDetails = oracleDetailsResult.oracleDetails;
    loanTokenPriceFeed = oracleDetailsResult.data;
  }

  if (poolDatumMapped.params.collateralCs.policyId !== "") {
    const oracleDetailsResult = await collectOracleDetails(
      poolDatumMapped.params.oracleCollateralAsset,
      poolDatumMapped.params.collateralCs,
      collateralAssetPrice.amount,
      collateralAssetPrice.lovelaces,
      lucid,
      oracleDetails
    );
    oracleDetails = oracleDetailsResult.oracleDetails;
    collateralTokenPriceFeed = oracleDetailsResult.data;
  }

  if (poolDatumMapped.params.loanCs.policyId != "") {
    // Loan is non-ADA so oracle will have first item.
    debtValueInAda = getAdaAmountIfBought(
      poolDatumMapped.params.loanCs.policyId,
      poolDatumMapped.params.loanCs.assetName,
      loanTokenPriceFeed,
      collateralDatumMapped.loanAmount + accumulatedInterest
    );
  }

  let collateralValueInAda = collateralDatumMapped.collateralAmount;

  if (poolDatumMapped.params.collateralCs.policyId != "") {
    // Only collateral is non ADA
    collateralValueInAda = getAdaAmountIfSold(
      poolDatumMapped.params.collateralCs.policyId,
      poolDatumMapped.params.collateralCs.assetName,
      collateralTokenPriceFeed,
      collateralDatumMapped.collateralAmount
    );
  }

  // This is amount of remaining collateral liquidator can take
  const feePercentage = new BigNumber(
    Number(collateralDatumMapped.poolConfig.loanFeeDetails.liquidationFee)
  );

  let feeAmount = Math.floor(
    new BigNumber(Number(collateralValueInAda))
      .minus(Number(debtValueInAda))
      .multipliedBy(feePercentage)
      .dividedBy(1000000)
      .toNumber()
  );

  // Protocol has min liquidation fee. Which should cover TX costs and pool fee.
  if (feeAmount < collateralDatumMapped.poolConfig.minLiquidationFee) {
    feeAmount = Number(collateralDatumMapped.poolConfig.minLiquidationFee);
  }

  const remainingCollateralValue = new BigNumber(Number(collateralValueInAda))
    .minus(Number(debtValueInAda))
    .minus(feeAmount);

  let remaminingValueInCollateral = new BigNumber(0);

  if (collateralDatumMapped.collateralCs.policyId == "") {
    remaminingValueInCollateral = remainingCollateralValue;
  } else {
    remaminingValueInCollateral = new BigNumber(
      Number(
        assetGainAdaSale(
          collateralTokenPriceFeed,
          BigInt(Math.ceil(Number(remainingCollateralValue.toNumber()))),
          collateralDatumMapped.collateralCs.policyId,
          collateralDatumMapped.collateralCs.assetName
        )
      )
    );
  }

  const healthFactor = new BigNumber(Number(collateralValueInAda))
    .multipliedBy(1000000)
    .dividedBy(Number(debtValueInAda))
    .dividedBy(Number(collateralDatumMapped.poolConfig.liquidationThreshold));

  let payToAddresOutout = 0n;
  if (remaminingValueInCollateral.gt(0) && healthFactor.lt(1)) {
    const leftoverAddress = lucid.utils.validatorToAddress(
      validators.leftoverValidator,
      poolStakeCredentials
    );

    const liquidationDatum: LeftoversLeftovers["datum"] = {
      policyId: validators.collateralValidatorHash,
      assetName: collateralDatumMapped.borrowerTn,
    };

    // Compensate borrower remaining collateral
    tx.payToContract(
      leftoverAddress,
      {
        inline: Data.to(liquidationDatum, LeftoversLeftovers.datum),
      },
      {
        [toUnitOrLovelace(
          poolDatumMapped.params.collateralCs.policyId,
          poolDatumMapped.params.collateralCs.assetName
        )]: BigInt(Math.ceil(Number(remaminingValueInCollateral.toNumber()))),
      }
    );

    payToAddresOutout += 1n;
  }

  const poolRedeemer: PoolSpend["redeemer"] = {
    wrapper: {
      action: {
        Continuing: [
          {
            CloseLoan: {
              loanAmount: collateralDatumMapped.loanAmount,
              repayAmount: loanPlusInterest,
              continuingOutput: payToAddresOutout,
            },
          },
        ],
      },
      configRef: {
        transactionId: { hash: poolArtifacts.configUTxO.txHash },
        outputIndex: BigInt(poolArtifacts.configUTxO.outputIndex),
      },
      order: null,
    },
  };

  const deployedValidators: DeployedValidators = parseValidators(
    deployedValidatorsJson
  );

  let metadata = {
    msg: ["Lenfi: ."],
  };

  if (process.env.BATCHER_KEY == null) {
    throw "BATCHER_KEY is not defined";
  }

  lucid.selectWalletFromPrivateKey(
    process.env.BATCHER_KEY // On production you will must have your own wallet.
  );

  tx.collectFrom(await lucid.wallet.getUtxos());

  tx.readFrom([deployedValidators.poolValidator])
    .readFrom([poolArtifacts.configUTxO])
    .collectFrom(
      [poolArtifacts.poolUTxO],
      Data.to(poolRedeemer, PoolSpend.redeemer)
    )
    .readFrom([deployedValidators.collateralValidator])
    .collectFrom(
      [collateralUtxo],
      Data.to(collateralRedeemer, CollateralSpend.redeemer)
    )
    .payToContract(
      poolAddress,
      { inline: Data.to(poolDatumMapped, PoolSpend.datum) },
      {
        [toUnitOrLovelace(
          poolDatumMapped.params.loanCs.policyId,
          poolDatumMapped.params.loanCs.assetName
        )]: poolDatumMapped.balance,
        [toUnit(validators.poolScriptHash, poolNftName)]: BigInt(1),
      }
    )
    .validFrom(validityRange.validFrom)
    .validTo(validityRange.validTo)
    .attachMetadata(674, metadata);

  // For each oracle item read and add details to TX
  oracleDetails.forEach(async (oracle) => {
    tx.withdraw(
      oracle.rewardAddress,
      0n,
      Data.to(oracle.redeemer, OracleValidatorWithdrawValidate.redeemer)
    )
      .readFrom([oracle.scriptReferenceUtxo])
      .readFrom([oracle.nftReferenceUtxo]);
  });

  const platformFee = getPlatformFee(
    collateralDatumMapped.loanAmount,
    collateralDatumMapped.balance,
    collateralDatumMapped.lentOut,
    collateralDatumMapped.poolConfig.loanFeeDetails
  );

  if (platformFee > 0n) {
    const datum = Data.to(collateralDatumMapped.borrowerTn);

    let feeAmount = (accumulatedInterest * platformFee) / 1000000n;

    const fee_receiver_address = generateReceiverAddress(
      lucid,
      poolArtifacts.poolConfigDatum.loanFeeDetails.platformFeeCollectorAddress
    );

    tx.payToContract(
      fee_receiver_address,
      {
        inline: datum,
      },
      {
        [toUnitOrLovelace(
          poolDatumMapped.params.loanCs.policyId,
          poolDatumMapped.params.loanCs.assetName
        )]: feeAmount,
      }
    );
  }

  const txBuild = await tx.complete();
  console.log("Off-chain validation passed, will sign the transaction");

  const signedTx = await txBuild.sign().complete();

  const txHash = await signedTx.submit();
  console.log("submitted");
  await lucid.awaitTx(txHash);
  return txHash;
}
