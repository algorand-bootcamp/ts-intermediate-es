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

    await appClient.create.createApplication({proposal});
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
    await expect(appClient.vote({inFavor: true, registeredAsa })).rejects.toThrow()
  })

  test('optin', async() => {
    try {

      const optinTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        from: sender.addr,
        to: sender.addr,
        amount: 0,
        suggestedParams: await algokit.getTransactionParams(undefined, algod),
        assetIndex: Number(registeredAsa)
      })
      await algokit.sendTransaction({ from: sender, transaction: optinTxn }, algod);


      // Modificamos el fee para cubrir el transfer de asset y el asset freeze
      await appClient.optIn.optInToApplication({ registeredAsa }, {
        sender,
        sendParams: {
          fee: algokit.microAlgos(3_000)
        }
      })
    } catch(e) {
      console.warn(e);
      throw e;
    }
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
    await appClient.vote({ inFavor: true, registeredAsa }, { sender });
    const totalVotesFromMethod = await appClient.getVotes({});
    expect(totalVotesFromMethod.return?.valueOf()).toEqual([BigInt(1), BigInt(1)]);
    
  })


  test('closeout', async() => {
    // Se realiza el closeout del local state y clawback
    await appClient.closeOut.closeOutOfApplication(
      { registeredAsa },
      { sender, sendParams: { fee: algokit.microAlgos(2_000)} }
    )

    // Verificar que se haya eliminado los votos
    let totalVotesFromMethod = await appClient.getVotes({});
    expect(totalVotesFromMethod.return?.valueOf()).toEqual([BigInt(0), BigInt(0)]);

    // Verificar que no pueda votar ya que no tiene el asset ni tiene opt in
    await expect(appClient.vote({ inFavor: true, registeredAsa }, { sender }))
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

    // Hasta acá ya se eliminó completamente la relación de la cuenta con el app

    const optinTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: sender.addr,
      to: sender.addr,
      amount: 0,
      suggestedParams: await algokit.getTransactionParams(undefined, algod),
      assetIndex: Number(registeredAsa)
    })
    await algokit.sendTransaction({ from: sender, transaction: optinTxn }, algod);

    await appClient.optIn.optInToApplication({ registeredAsa }, {
      sender,
      sendParams: {
        fee: algokit.microAlgos(3_000)
      }
    })
    

    await appClient.vote({ inFavor: true, registeredAsa }, { sender })
    totalVotesFromMethod = await appClient.getVotes({});
    expect(totalVotesFromMethod.return?.valueOf()).toEqual([BigInt(1), BigInt(1)]);

  })

});
