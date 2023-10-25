import { Contract } from '@algorandfoundation/tealscript';

// eslint-disable-next-line no-unused-vars
class Dao extends Contract {

  proposal = GlobalStateKey<string>();
  totalVotes = GlobalStateKey<number>();
  favorVotes = GlobalStateKey<number>();
  registeredAsa = GlobalStateKey<Asset>();

  individualFavor = BoxMap<Address, boolean>();

  endTime = GlobalStateKey<number>();
    
  createApplication(proposal: string, length: number): void {
    this.proposal.value = proposal;
    this.endTime.value = globals.latestTimestamp + length;
  }

  bootstrap(): Asset {
    verifyTxn(this.txn, { sender: this.app.creator })
    assert(!this.registeredAsa.exists)
    const registeredAsa = sendAssetCreation({
      configAssetTotal: 1_000,
      configAssetFreeze: this.app.address,
      configAssetClawback: this.app.address
    })
    this.registeredAsa.value = registeredAsa;
    return registeredAsa;
  }

  register(registeredAsa: Asset): void {
    // Verificamos que el solicitante no tenga el asset aun
    assert(this.txn.sender.assetBalance(this.registeredAsa.value) === 0)

    // Enviar asset al miembro que se registre
    sendAssetTransfer({
      xferAsset: this.registeredAsa.value,
      assetReceiver: this.txn.sender,
      assetAmount: 1
    });

    // Congelarle el asset
    sendAssetFreeze({
      freezeAsset: this.registeredAsa.value,
      freezeAssetAccount: this.txn.sender,
      freezeAssetFrozen: true
    })
  }

  deregister(registeredAsa: Asset): void {
    // Eliminar el voto del usuario del total de votos
    if(this.individualFavor(this.txn.sender).exists) {
      this.totalVotes.value = this.totalVotes.value - 1;
      // Eliminar el voto del usuario si fue a favor del total a favor
      if(this.individualFavor(this.txn.sender).value) {
        this.favorVotes.value = this.favorVotes.value - 1;
      }
    }

    const preMBR = this.app.address.minBalance;
    this.individualFavor(this.txn.sender).delete();

    // Regresar el MBR enviado del box
    sendPayment({
      receiver: this.txn.sender,
      amount: preMBR - this.app.address.minBalance
    })

    // Hacer clawback para quitar el asset que ya tiene el user
    sendAssetTransfer({
      xferAsset: this.registeredAsa.value,
      assetAmount: 1,
      assetReceiver: this.app.address,
      assetSender: this.txn.sender
    })
  }

  vote(MBRPayment: PayTxn, inFavor: boolean, registeredAsa: Asset): void {
    assert(this.txn.sender.assetBalance(this.registeredAsa.value) >= 1)
    assert(!this.individualFavor(this.txn.sender).exists)
    assert(globals.latestTimestamp < this.endTime.value)

    const preBoxMBR = this.app.address.minBalance;
    this.individualFavor(this.txn.sender).value = inFavor;

    verifyTxn(MBRPayment, {
      receiver: this.app.address,
      amount: this.app.address.minBalance - preBoxMBR
    })

    this.totalVotes.value = this.totalVotes.value + 1;
    if (inFavor) this.favorVotes.value = this.favorVotes.value + 1;
  }

  getProposal(): string {
    return this.proposal.value;
  }

  getVotes(): [number, number] {
    return [this.totalVotes.value, this.favorVotes.value];
  } 

  getRegisteredAsa(): Asset {
    return this.registeredAsa.value;
  }

}
