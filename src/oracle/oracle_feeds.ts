import { PriceFeed } from "../types";
import { Data } from "lucid-cardano";

import { Oracle } from "./oracle";
import {
  OracleValidatorFeedType,
  OracleValidatorWithdrawValidate,
} from "../plutus";


// TESTNET ONLY. Oracle will sign any price feed data for convenience of testing.
// In production, the oracle will only sign data that is valid, additionally oracle will be multi-sig. Therefore will require to add multiple redeemers.
export const signAnything = async (
  data: PriceFeed
): Promise<OracleValidatorWithdrawValidate["redeemer"]> => {
  const oracle = new Oracle({ readFromFile: "./tests/pool/oracle/keys.sk" });

  const datum = Data.to(data, OracleValidatorFeedType["_redeemer"]);
  const signedData = await oracle.signFeed(datum);

  const result: OracleValidatorWithdrawValidate["redeemer"] = {
    data: data,
    signatures: [
      {
        signature: signedData.signature,
        keyPosition: 0n,
      },
    ],
  };
  return result;
};
