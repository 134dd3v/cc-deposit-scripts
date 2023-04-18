import LIFI, {
  ChainId,
  ContractCallQuoteRequest,
  StatusResponse,
  Step,
} from "@lifi/sdk";
import { ethers, BigNumber } from "ethers";
import { config } from "dotenv";

config();

const usdc_ethmain = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const usdc_arbitrum = "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8";
const batching_manager_arbitrum = "0x519eb01fa6ed3d72e96e40770a45b13531cef63d";
const ethmain = new ethers.providers.AlchemyProvider(
  "mainnet",
  process.env.ALCHEMY
);

const signer = new ethers.Wallet(process.env.PRIVATE_KEY ?? "", ethmain);
const usdcAmount = ethers.utils.parseUnits("10", 6);

crosschainDeposit(signer, usdcAmount).catch(console.error);

// ethereum to arbitrum deposit
async function crosschainDeposit(signer: ethers.Signer, usdcAmount: BigNumber) {
  const signerChainId = await signer.getChainId();
  if (signerChainId !== ChainId.ETH) {
    throw new Error(
      "signer chain id is not ethereum, please switch network to ethereum"
    );
  }

  const contract = new ethers.Contract(batching_manager_arbitrum, [
    "function depositUsdc(uint256 amount, address receiver) external",
  ]);

  const toAmount = usdcAmount.toString();
  const deposit_tx = await contract.populateTransaction.depositUsdc(
    toAmount,
    await signer.getAddress()
  );

  // quote
  const quoteRequest: ContractCallQuoteRequest = {
    fromChain: ChainId.ETH,
    fromToken: usdc_ethmain,
    fromAddress: await signer.getAddress(),
    toChain: ChainId.ARB,
    toToken: usdc_arbitrum,
    toAmount,
    toContractAddress: deposit_tx.to!,
    toContractCallData: deposit_tx.data!,
    toContractGasLimit: "3000000",
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
