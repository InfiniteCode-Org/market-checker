import { ethers } from 'ethers';

// Smart contract ABI (interface)
const ORACLE_ABI = [
  {
    inputs: [
      { name: 'market', type: 'address' },
      { name: 'updateData', type: 'bytes[]' }
    ],
    name: 'updatePriceAndFulfill',
    outputs: [],
    stateMutability: 'payable',
    type: 'function'
  }
];

// Pyth Contract ABI (for getUpdateFee)
const PYTH_ABI = [
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

// Market Factory ABI (just the marketAddress mapping function)
const MARKET_FACTORY_ABI = [
  {
    inputs: [
      { name: 'eventId', type: 'uint256' }
    ],
    name: 'marketAddress',
    outputs: [
      { name: '', type: 'address' }
    ],
    stateMutability: 'view',
    type: 'function'
  }
];

export class ContractClient {
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet;
  private oracleContract: ethers.Contract;
  private marketFactoryContract: ethers.Contract;
  private pythContract: ethers.Contract;

  constructor(
    providerUrl: string,
    oracleContractAddress: string,
    marketFactoryContractAddress: string,
    pythContractAddress: string,
    privateKey: string
  ) {
    // Setup ethers.js v6
    this.provider = new ethers.JsonRpcProvider(providerUrl);
    this.signer = new ethers.Wallet(privateKey, this.provider);
    
    // Create ethers contract instances
    this.oracleContract = new ethers.Contract(oracleContractAddress, ORACLE_ABI, this.signer);
    this.marketFactoryContract = new ethers.Contract(marketFactoryContractAddress, MARKET_FACTORY_ABI, this.provider);
    this.pythContract = new ethers.Contract(pythContractAddress, PYTH_ABI, this.provider);
    
    console.log(`ContractClient initialized with ethers.js v6`);
    console.log(`Oracle at: ${oracleContractAddress}`);
    console.log(`Market Factory at: ${marketFactoryContractAddress}`);
    console.log(`Pyth Contract at: ${pythContractAddress}`);
  }

  /**
   * Verify the Pyth contract interface
   */
  async verifyPythContract(): Promise<void> {
    try {
      console.log(`Verifying Pyth contract at ${this.pythContract.target}...`);
      
      // Try to get the contract code
      const code = await this.provider.getCode(this.pythContract.target);
      if (code === '0x') {
        throw new Error('No contract found at the specified address');
      }
      
      console.log(`Contract found at ${this.pythContract.target}`);
      
      // Try to call getUpdateFee with empty data to test the interface
      try {
        await this.pythContract.getUpdateFee([]);
        console.log('✓ getUpdateFee function is available');
      } catch (error) {
        console.warn('⚠ getUpdateFee function may not be available or may have different signature');
        console.warn('Error details:', error);
      }
    } catch (error) {
      console.error('Error verifying Pyth contract:', error);
      throw error;
    }
  }

  /**
   * Get the market address for a specific event ID
   */
  async getMarketAddressForEvent(eventId: number): Promise<string> {
    try {
     
      console.log(`Fetching market address for event ID ${eventId}`);
      
      const marketAddress = await this.marketFactoryContract.marketAddress(eventId);
      
      if (!marketAddress || marketAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error(`No market address found for event ID ${eventId}`);
      }
      
      console.log(`Found market address ${marketAddress} for event ID ${eventId}`);
      return marketAddress;
    } catch (error) {
      console.error(`Error fetching market address for event ${eventId}:`, error);
      throw error;
    }
  }

  /**
   * Call the updatePriceAndFulfill function on the Oracle contract
   */
  async updatePriceAndFulfill(marketAddress: string, updateData: string[]): Promise<string> {
    console.log(`Calling updatePriceAndFulfill for market ${marketAddress}`);
    
    // Log VAA data info
    console.log(`Processing ${updateData.length} VAAs`);
    updateData.forEach((vaa, index) => {
      console.log(`VAA ${index+1} length: ${vaa.length}`);
    });
    
    console.log("updateData", updateData);
    // Convert hex strings to proper BytesLike format
    const bytesData = updateData.map(hexString => {
      if (!hexString.startsWith('0x')) {
        hexString = '0x' + hexString;
      }
      console.log("hexString", hexString);
      return hexString;
    });
    
    console.log(`Converted VAAs to BytesLike format`);
    
    // Try to get the fee from Pyth contract, with fallback
    let fee: bigint;
    try {
      console.log(`Attempting to get update fee from Pyth contract...`);
      fee = await this.pythContract.getUpdateFee(bytesData);
      console.log(`Update fee required: ${fee.toString()} wei`);
    } catch (feeError) {
      console.warn(`Failed to get update fee from Pyth contract:`, feeError);
      console.log(`Using fallback fee calculation...`);
      // Fallback: calculate a reasonable fee based on data size
      const estimatedGas = 200000; // Rough estimate for price update
      const gasPrice = await this.provider.getFeeData();
      fee = (gasPrice.gasPrice || BigInt(20000000000)) * BigInt(estimatedGas);
      console.log(`Calculated fallback fee: ${fee.toString()} wei`);
    }
    
    // Fetch the latest nonce from the network (pending)
    const latestNonce = await this.provider.getTransactionCount(this.signer.address, 'pending');
    console.log(`Fetched latest nonce from network: ${latestNonce}`);
    
    // Get current gas price
    const feeData = await this.provider.getFeeData();
    const gasPrice = feeData.gasPrice || BigInt(20000000000); // 20 gwei default
    
    console.log(`Using gas price: ${gasPrice.toString()} wei (${gasPrice / BigInt(1000000000)} gwei)`);
    
    // Call the contract function
    console.log(`Sending transaction`);
    console.log(`Market address: ${marketAddress}`);
    const updateFee = fee * BigInt(10);
    
    try {
      const tx = await this.oracleContract.updatePriceAndFulfill(
        marketAddress,
        bytesData,
        { 
          value: updateFee, 
          nonce: latestNonce,
          gasPrice: gasPrice
        }
      );
      
      console.log(`Transaction sent! Hash: ${tx.hash}`);
      console.log(`Transaction details:`, {
        hash: tx.hash,
        nonce: latestNonce,
        gasPrice: gasPrice.toString(),
        value: updateFee.toString(),
        to: this.oracleContract.target,
        from: this.signer.address
      });
      
      // Wait for confirmation with a reasonable timeout
      console.log(`Waiting for transaction confirmation...`);
      
      const receipt = await tx.wait(1); // Wait for 1 confirmation
      console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
      console.log(`You can verify the transaction at: https://hyperevmscan.io/tx/${tx.hash}`);
      return tx.hash;
    } catch (error: any) {
      console.error(`Contract call failed:`, error);
      
      // Decode custom errors if available
      if (error.data && error.data.startsWith('0x')) {
        console.log(`Contract error data: ${error.data}`);
        
        // Common custom error patterns
        const errorMap: { [key: string]: string } = {
          '0x19abf40e': 'INSUFFICIENT_FEE - The fee provided is too low',
          '0x4e487b71': 'INVALID_MARKET - Market address is invalid or not found',
          '0x8f4eb604': 'MARKET_ALREADY_RESOLVED - Market has already been resolved',
          '0x5c975abb': 'PAUSED - Contract is paused',
          '0x8456cb59': 'UNAUTHORIZED - Caller is not authorized',
          '0x8da5cb5b': 'OWNER_ONLY - Only owner can call this function'
        };
        
        const errorCode = error.data;
        const errorMessage = errorMap[errorCode] || `Unknown custom error: ${errorCode}`;
        console.log(`Decoded error: ${errorMessage}`);
      }
      
      throw error;
    }
  }
}

