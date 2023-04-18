import LIFI, {
  ChainId,
  ContractCallQuoteRequest,
  StatusResponse,
  Step,
} from "@lifi/sdk";
import { ethers, BigNumber } from "ethers";
import { config } from "dotenv";

config();

const usdc_optimism = "0x7F5c764cBc14f9669B88837ca1490cCa17c31607";
const usdc_arbitrum = "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8";
const senior_vault_arbitrum = "0xf9305009FbA7E381b3337b5fA157936d73c2CF36";
const opmain = new ethers.providers.AlchemyProvider(
  "optimism",
  process.env.ALCHEMY
);

const signer = new ethers.Wallet(process.env.PRIVATE_KEY ?? "", opmain);
const usdcAmount = ethers.utils.parseUnits("0.1", 6);

crosschainDeposit(signer, usdcAmount).catch(console.error);

// optimism to arbitrum deposit
async function crosschainDeposit(signer: ethers.Signer, usdcAmount: BigNumber) {
  const signerChainId = await signer.getChainId();
  if (signerChainId !== ChainId.OPT) {
    throw new Error(
      "signer chain id is not optimism, please switch network to optimism"
    );
  }

  const contract = new ethers.Contract(senior_vault_arbitrum, [
    "function deposit(uint256 assets, address receiver) external returns (uint256 shares)",
  ]);

  const toAmount = usdcAmount.toString();
  const deposit_tx = await contract.populateTransaction.deposit(
    toAmount,
    await signer.getAddress()
  );

  // quote
  const quoteRequest: ContractCallQuoteRequest = {
    fromChain: ChainId.OPT,
    fromToken: usdc_optimism,
    fromAddress: await signer.getAddress(),
    toChain: ChainId.ARB,
    toToken: usdc_arbitrum,
    toAmount,
    toContractAddress: deposit_tx.to!,
    toContractCallData: deposit_tx.data!,
    toContractGasLimit: "2500000",
    allowBridges: ["stargate"],
  };

  const lifi = new LIFI({});
  const quote = await lifi.getContractCallQuote(quoteRequest);
  console.log("quote generated");

  // Approval
  if (quote.action.fromToken.address !== ethers.constants.AddressZero) {
    // check approval
    const approval = await lifi.getTokenApproval(
      signer,
      quote.action.fromToken,
      quote.estimate.approvalAddress
    );
    if (!approval) {
      throw "Failed to load approval";
    }

    // set approval
    if (BigNumber.from(approval).lt(quote.action.fromAmount)) {
      console.log("approving");
      await lifi.approveToken({
        signer,
        token: quote.action.fromToken,
        amount: BigNumber.from(quote.action.fromAmount).mul(100).toString(),
        approvalAddress: quote.estimate.approvalAddress,
      });
      console.log("approve done");
    }
  }

  // execute transaction
  const tx = await signer.sendTransaction(quote.transactionRequest!);
  const rc = await tx.wait();
  console.log("rc", rc.transactionHash); // display in UI

  // wait for execution
  let result: StatusResponse;
  do {
    await new Promise((res) => {
      setTimeout(() => {
        res(null);
      }, 5000);
    });
    result = await lifi.getStatus({
      txHash: rc.transactionHash,
      bridge: quote.tool,
      fromChain: quote.action.fromChainId,
      toChain: quote.action.toChainId,
    });
    console.log("in progress");
    console.log(result.sending.txLink);
    console.log(result.receiving?.txLink);
  } while (result.status !== "DONE" && result.status !== "FAILED");
  console.log("done");
}
