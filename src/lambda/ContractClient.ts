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
   * Get the market address for a specific event ID
   */
  async getMarketAddressForEvent(eventId: number): Promise<string> {
    try {
      fetch('https://jsonplaceholder.typicode.com/todos/1')
      .then(response => response.json())
      .then(json => console.log(json))
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
    try {
      console.log(`Calling updatePriceAndFulfill for market ${marketAddress}`);
      
      // Log VAA data info
      console.log(`Processing ${updateData.length} VAAs`);
      updateData.forEach((vaa, index) => {
        console.log(`VAA ${index+1} length: ${vaa.length}`);
      });
      
      // Convert hex strings to proper BytesLike format
      const bytesData = updateData.map(hexString => {
        // Check if the string starts with '0x', if not, add it
        if (!hexString.startsWith('0x')) {
          hexString = '0x' + hexString;
        }
        return hexString;
      });
      
      console.log(`Converted VAAs to BytesLike format`);
      console.log(`Bytes data: ${bytesData}`);
      // Get the fee required by Pyth oracle - now using pythContract instead of oracleContract
      const fee = await this.pythContract.getUpdateFee(bytesData);
      console.log(`Update fee required: ${fee.toString()} wei`);
      
      // Call the contract function with ethers.js v6 pattern
      console.log(`Sending transaction`);
      console.log(`Market address: ${marketAddress}`);
      const updateFee = fee * BigInt(10);
      const tx = await this.oracleContract.updatePriceAndFulfill(
        marketAddress,
        bytesData,
        { value: updateFee }  // Include the fee as value in the transaction
      );
      
      console.log(`Transaction sent! Hash: ${tx.hash}`);
      console.log(`Waiting for transaction confirmation...`);
      
      // Wait for the transaction to be mined
      const receipt = await tx.wait();
      
      console.log(`Transaction confirmed in block ${receipt?.blockNumber}`);
      return tx.hash;
    } catch (error) {
      console.error("Error calling updatePriceAndFulfill:", error);
      throw error;
    }
  }
} 