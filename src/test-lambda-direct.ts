import dotenv from 'dotenv';
import { handler } from './lambda/index';
import { SQSEvent, Context, Callback } from 'aws-lambda';

// Load environment variables
dotenv.config();

// Create a mock Lambda context
const createContext = (): Context => ({
  callbackWaitsForEmptyEventLoop: true,
  functionName: 'local-lambda',
  functionVersion: 'local',
  invokedFunctionArn: 'local',
  memoryLimitInMB: '128',
  awsRequestId: `local-${Date.now()}`,
  logGroupName: 'local',
  logStreamName: 'local',
  getRemainingTimeInMillis: () => 30000,
  done: () => {},
  fail: () => {},
  succeed: () => {}
});

// Mock SQS event data
const createMockSqsEvent = (eventId: number): SQSEvent => ({
  Records: [
    {
      messageId: `msg-${Date.now()}`,
      receiptHandle: 'mock-receipt-handle',
      body: JSON.stringify({
        eventId: eventId,
        pythFeedId: '0x1234567890abcdef',
        triggerPrice: '50000',
        operator: 'GT',
        actualPrice: '51000',
        timestamp: Date.now(),
        winningOutcome: 'YES',
        vaa: '0x504e41550100000003b801000000040d02897a45be9bfa82e0e3337a475a703cd0f5f61eb634b46e304b335feb97d399773d72e6954e4be3970309cba7f90fffc567709ed16fcf2a33027ef7015bc424ee0003cbdd547a7bd964fc6ca443ef88b3846a1b97d46695cdfa1aaafc439c0ab574f040280d372bf6064ca0d744dc189672cb56a9c273d33adf479322a1ed721556b8010454d8f2caea0c5365e7f6e1f43cf06c395bbd3a3a0bf9516d7c46ce8121d85fb004745a9fdcd5a881240a126a3381a091421c5a7a7928d4a2d712d5edf5a100ca0106ce3421765b9dcd45ae352f41545526d660f8058ee9b182398c280225af01ad541f4b7b220bf71e0c65a107191c4fcbcf6d9de15e14045326eb34a752cf9c014c000a61a317e83473469b6913a0b0b9201acb75ad59bec4b20ecb46843cf9f6f42fe9599aca5631722539f77a4937d76405c99d721e818e714c353ba3b4c9763dde43010bb6389454e0e763a5b9356bd6ca534a153356067c07e45d1d90db3c0203e4c9f80377b569e73e81b8f8398a12ceceb4d371cce55b12a6445afec7c576358ecfff010c44d283159ac0c8a7e58b4c290cfca8f5dc310e6a3e73a2bdf0843925721eb56367c6f70908248d3b78730e3bf4868487677f077daae1fe9470a2cb83c18e6560000d32ff47ee6093cf559dd32f2c6f9188652db1370ce04d3c76d546a4dbeece18765258ed370ebf9de628a8f50be5c58c8a8bc47826809635fa56cd2cc79b1e98cd000e564f9268fb82bfe4ed986b8fcd60807b537de9a0cb67f867bd027b9d917b2c9857396ba815e6c1f5ce73493a924cb66acbb4cca2612be66506142ec6bf4edb2b010fdb781915807d55d819555919ba78e4885afc06960010a8404d1d45c200db549067bb55188af958404b7437cb5a9b0da51f1d6a6f658f32ee8fcf3d004635ac9d0110885de3e1c88d028d00ad67f49e15de98cf55bd058c609c82f385c8f966c4dd96592c657a7dabf7ceb2a75519d4b2d9dc91fffdafe2d09ecaa506305062660afc00115b5016f778e4804a14b6457169bef2799d061b5f6313eb1c940bdd949fed820869c02a7667fd6246f795d9feb632774063ea4ce0fa637443ea75ec108a3ff8e601126068676a360f18477c11bce91dc6a3402d87a9cba19346d5699aa9c98cee08c31d2d5d834a71f2d1fbf27e850b106aa8ea765736fd800c3e840152d48121ca1d00686ddacb00000000001ae101faedac5851e32b9b23b5f9411a8c2bac4aae3ed4dd7b811dd1a72ea4aa710000000008923cb4014155575600000000000d9fcaea00002710732aaf088df80850299111c4f25e6be06248a76c010055004279e31cc369bbcc2faf022b382b080e32a8e689ff20fbc530d2a603eb6cd98b00000000e7f0f5df00000000005a8572fffffff800000000686ddacb00000000686ddacb00000000e859f79800000000004639740cfc0fc2d8615ab0e21e3666f1847ded031eaaa75d22ee1e39cf7e5ec6ca6413b815c3ab87e5d9c0de9423d804b8436811a3398a0416933f00586949fc99a36bc61808cea73aa592404aa5d4d23de3fe39691bfded67e89fa2fef1a43f7553052a90d43943d709185f0d5372516cc9cd52060d22d71f22b54d564737e9275b6d65b8a219b0ef399d6685b68a92af39756bc9f117c445d241014eb20cf36beb87f8ab497c4995fd891ef3b447745b0a69826dc048f88c6aa10bc8d1533b34f78c66e04c002b0e47e10564a8f433b252c50508d7edf35ef865cee5d7224cd76d0924dcbefa2e6f4090fb66aebe2d8d89d3e6'
      }),
      attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: Date.now().toString(),
        SenderId: 'mock-sender',
        ApproximateFirstReceiveTimestamp: Date.now().toString()
      },
      messageAttributes: {},
      md5OfBody: 'mock-md5',
      eventSource: 'aws:sqs',
      eventSourceARN: 'arn:aws:sqs:us-east-1:000000000000:resolution-queue',
      awsRegion: 'us-east-1'
    }
  ]
});

async function testLambdaDirectly() {
  console.log('Testing Lambda function directly...');
  
  try {
    const eventId = 28; // Use the same event ID from your logs
    const mockEvent = createMockSqsEvent(eventId);
    const context = createContext();
    
    console.log(`Testing with event ID: ${eventId}`);
    console.log('Mock SQS event created');
    
    // Create a promise to handle the callback
    const lambdaPromise = new Promise<void>((resolve, reject) => {
      const callback: Callback = (error, result) => {
        if (error) {
          console.error('Lambda handler returned error:', error);
          reject(error);
        } else {
          console.log('Lambda execution result:', result);
          resolve();
        }
      };
      
      // Call the handler
      handler(mockEvent, context, callback);
    });
    
    // Wait for completion with timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Lambda execution timed out after 60 seconds')), 60000);
    });
    
    await Promise.race([lambdaPromise, timeoutPromise]);
    console.log('Lambda execution completed successfully');
    
  } catch (error) {
    console.error('Error testing Lambda:', error);
  }
}

// Run the test
testLambdaDirectly().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
}); 