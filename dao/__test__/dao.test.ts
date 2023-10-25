import {
  describe, test, expect, beforeAll, beforeEach
} from '@jest/globals';
import * as algokit from '@algorandfoundation/algokit-utils';
import algosdk from 'algosdk';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import { DaoClient } from '../contracts/clients/DaoClient';

const fixture = algorandFixture();

let appClient: DaoClient;
let sender: algosdk.Account;
let registeredAsa: bigint;
let algod: algosdk.Algodv2;


describe('Dao', () => {
  beforeEach(fixture.beforeEach);

  const proposal = 'Nueva propuesta';

  const vote = async(inFavor: boolean) => {
    const { appAddress } = await appClient.appClient.getAppReference();
    
    const MBRPayment = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: sender.addr,
      to: appAddress,
      amount: 15_700,
      suggestedParams: await algokit.getTransactionParams(undefined, algod)
    })
    await appClient.vote(
      { MBRPayment, inFavor: true, registeredAsa },
      { sender, boxes: [algosdk.decodeAddress(sender.addr).publicKey]}
      )
  }

  const register = async() => {
    const optinTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: sender.addr,
      to: sender.addr,
      amount: 0,
      suggestedParams: await algokit.getTransactionParams(undefined, algod),
      assetIndex: Number(registeredAsa)
    })
    await algokit.sendTransaction({ from: sender, transaction: optinTxn }, algod);


    // Modificamos el fee para cubrir el transfer de asset y el asset freeze
    await appClient.register({ registeredAsa }, {
      sender,
      sendParams: {
        fee: algokit.microAlgos(3_000)
      }
    })
  }

  const deregister = async() => {
    // Se realiza el closeout del local state y clawback
    await appClient.deregister(
      { registeredAsa },
      { sender, 
        boxes: [algosdk.decodeAddress(sender.addr).publicKey],
        sendParams: { fee: algokit.microAlgos(3_000)} }
    )

    // Verificar que se haya eliminado los votos
    let totalVotesFromMethod = await appClient.getVotes({});
    expect(totalVotesFromMethod.return?.valueOf()).toEqual([BigInt(0), BigInt(0)]);

    // Verificar que no pueda votar ya que no tiene el asset ni tiene opt in
    await expect(vote(true))
    .rejects
    .toThrow()

    // Hacer una txn de closeout al asset

    const { appAddress } = await appClient.appClient.getAppReference();

    const assetClouseOutTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: sender.addr,
      amount: 0,
      suggestedParams: await algokit.getTransactionParams(undefined, algod),
      assetIndex: Number(registeredAsa),
      to: appAddress,
      closeRemainderTo: appAddress

    })

    await algokit.sendTransaction({ from: sender, transaction: assetClouseOutTxn }, algod);
  }

  beforeAll(async () => {
    await fixture.beforeEach();
    const { testAccount, kmd } = fixture.context;
    algod = fixture.context.algod;

    appClient = new DaoClient(
      {
        sender: testAccount,
        resolveBy: 'id',
        id: 0,
      },
      algod,
    );

    sender = await algokit.getOrCreateKmdWalletAccount({
      name: 'not-creator',
      fundWith: algokit.algos(10)
    }, algod, kmd)

    algod.setBlockOffsetTimestamp(1).do();
    await appClient.create.createApplication({proposal, length: 60});
  });

  test('bootstrap no creador', async() => {
    await expect(appClient.bootstrap({}, { 
      sender,
      sendParams: { 
        fee: algokit.microAlgos(2_000) 
      } 
    })).rejects.toThrow();
  })

  test('bootstrap', async() => {
    // Enviamos fondos al contrato para cubrir balance minimo
    await appClient.appClient.fundAppAccount(algokit.microAlgos(200_000));
    // Hacemos que nuestra transaccion cubra la comision de la transaccion interna
    const bootstrapResult = await appClient.bootstrap({}, { 
      sendParams: { 
        fee: algokit.microAlgos(2_000) 
      } 
    });
    registeredAsa = bootstrapResult.return!.valueOf();
  })

  test('bootstrap doble', async() => {
    await expect(appClient.bootstrap({}, { 
      sendParams: { 
        fee: algokit.microAlgos(2_000) 
      } 
    })).rejects.toThrow();
  })

  test('votar sin asset', async() => {
    await expect(vote(true)).rejects.toThrow()
  })

  test('register', async() => {
    register();
  })

  test('getRegisteredAsa', async () => {
    const asaFromMethod = await appClient.getRegisteredAsa({});
    expect(asaFromMethod.return?.valueOf()).toBe(registeredAsa);
  });

  test('getProposal', async () => {
    const proposalFromMethod = await appClient.getProposal({});
    expect(proposalFromMethod.return?.valueOf()).toBe(proposal);
  });

  test('votacion', async () => {
    await vote(true);
    const totalVotesFromMethod = await appClient.getVotes({});
    expect(totalVotesFromMethod.return?.valueOf()).toEqual([BigInt(1), BigInt(1)]);
    
  })


  test('deregister', async() => {
    await deregister();
    await register();
    await vote(true)
    const totalVotesFromMethod = await appClient.getVotes({});
    expect(totalVotesFromMethod.return?.valueOf()).toEqual([BigInt(1), BigInt(1)]);

  })

  test('voteAfterTime', async() => {
    await deregister();
    algod.setBlockOffsetTimestamp(120).do();
    await register();
    await expect(vote(true)).rejects.toThrow();
  })

});
