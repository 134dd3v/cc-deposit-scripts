import { Contract, BigNumber, ethers } from "ethers";
import { config } from "dotenv";

config();

const arbmain = new ethers.providers.AlchemyProvider(
  "arbitrum",
  process.env.ALCHEMY
);
const vault_batching_manager_arbitrum =
  "0x519eb01fa6ed3d72e96e40770a45b13531cef63d";

async function main() {
  const userDepositAmount = ethers.utils.parseUnits("20", 6);
  const userAddress = "0x134dD282b7b3De06d4f5916c5e801a605b8854C3"; // take from signer

  const batchingManagerUsdc = new ethers.Contract(
    vault_batching_manager_arbitrum,
    ["function depositUsdc(uint256 amount, address receiver) external"]
  );
  const depositPopulate =
    await batchingManagerUsdc.populateTransaction.depositUsdc(
      userDepositAmount,
      userAddress
    );

  const gasEstimatooor = new Contract(
    "0x09F14a67C4932C2698BD3088a810d53434dEe65E",
    [
      "function callMeMaybe(address target, bytes memory input,uint value) external returns (bool success,bytes memory returnData,uint gasConsumed)",
    ],
    arbmain
  );
  const estimatePopulate = await gasEstimatooor.populateTransaction.callMeMaybe(
    depositPopulate.to!,
    depositPopulate.data,
    0
  );

  const result = await arbmain.send("eth_call", [
    {
      to: estimatePopulate.to!,
      input: estimatePopulate.data!,
    },
    "latest",
    {
      // state overrides for usdc contract
      "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8": {
        stateDiff: {
          // usdc balance of 0x09F14a67C4932C2698BD3088a810d53434dEe65E
          "0xce44926508863c8a9ab89fd758fa5e7aacd11c7467d735f9979c7141929fba81":
            "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          // usdc allowance owner 0x09F14a67C4932C2698BD3088a810d53434dEe65E, spender 0x519eb01fa6ed3d72e96e40770a45b13531cef63d
          "0x41f6b4f93b7e7185988fb5ae0fd79e4ce96ccd935820467f88da334cf361d31c":
            "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
      },
    },
  ]);

  const decoded = (await gasEstimatooor.interface.decodeFunctionResult(
    "callMeMaybe",
    result
  )) as unknown as {
    success: boolean;
    returnData: String;
    gasConsumed: BigNumber;
  };

  console.log("success", decoded.success);
  console.log("returnData", decoded.returnData);
  console.log("gasConsumed", decoded.gasConsumed.toNumber());

  if (decoded.success) {
    // use the `decoded.gasConsumed` to perform bridge transaction
  } else {
    // parseError(decoded.returnData)
  }
}

main().catch(console.error);
