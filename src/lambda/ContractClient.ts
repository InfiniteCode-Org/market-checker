import Web3 from 'web3';
import { AbiItem } from 'web3-utils';

// Smart contract ABI (interface)
const ORACLE_ABI: AbiItem[] = [
  {
    inputs: [
      { name: 'market', type: 'address' },
      { name: 'updateData', type: 'bytes[]' }
    ],
    name: 'updatePriceAndFulfill',
    outputs: [],
    stateMutability: 'payable',
    type: 'function'
  },
  {
    inputs: [
      { name: 'updateData', type: 'bytes[]' }
    ],
    name: 'getUpdateFee',
    outputs: [
      { name: '', type: 'uint256' }
    ],
    stateMutability: 'view',
    type: 'function'
  }
];

export class ContractClient {
  private web3: Web3;
  private contract: any;
  private account: any;

  constructor(
    providerUrl: string,
    contractAddress: string,
    privateKey: string
  ) {
    this.web3 = new Web3(providerUrl);
    this.contract = new this.web3.eth.Contract(ORACLE_ABI, contractAddress);
    this.account = this.web3.eth.accounts.privateKeyToAccount(privateKey);
    this.web3.eth.accounts.wallet.add(this.account);
    
    console.log(`ContractClient initialized for contract at ${contractAddress}`);
  }

  /**
   * Call the updatePriceAndFulfill function on the Oracle contract
   */
  async updatePriceAndFulfill(marketAddress: string, updateData: string[], gasPrice: string): Promise<string> {
    try {
      console.log(`Calling updatePriceAndFulfill for market ${marketAddress}`);
      
      // Get the fee required by Pyth oracle
      const fee = await this.contract.methods.getUpdateFee(updateData).call();
      console.log(`Update fee required: ${fee} wei`);
      
      // Prepare the transaction
      const tx = this.contract.methods.updatePriceAndFulfill(
        marketAddress,
        updateData
      );
      
      // Estimate gas
      const gasEstimate = await tx.estimateGas({
        from: this.account.address,
        value: fee
      });
      
      console.log(`Gas estimate: ${gasEstimate}, using gas price: ${gasPrice} gwei`);
      
      // Send the transaction
      const receipt = await tx.send({
        from: this.account.address,
        gas: Math.floor(gasEstimate * 1.2), // Add 20% buffer
        gasPrice: this.web3.utils.toWei(gasPrice, 'gwei'),
        value: fee
      });
      
      console.log(`Transaction successful, hash: ${receipt.transactionHash}`);
      return receipt.transactionHash;
    } catch (error) {
      console.error("Error calling updatePriceAndFulfill:", error);
      throw error;
    }
  }
} 