import { Account, Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { homedir } from 'os';
import * as fs from 'fs';
import { findLargestTokenAccountForOwner, getAllObligations, getParsedReservesMap, notify, sleep, Wallet } from './utils';
import BN = require('bn.js');
import { Obligation, ObligationParser } from './layouts/obligation';
import { EnrichedReserve, Reserve, ReserveParser } from './layouts/reserve';
import { refreshReserveInstruction } from './instructions/refreshReserve';
import { refreshObligationInstruction } from './instructions/refreshObligation';
import { liquidateObligationInstruction } from './instructions/liquidateObligation';
import { AccountLayout, Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';

async function runPartialLiquidator() {
  const cluster = process.env.CLUSTER || 'mainnet-beta'
  const clusterUrl = process.env.CLUSTER_URL || "https://api.devnet.solana.com"
  const checkInterval = parseFloat(process.env.CHECK_INTERVAL || "1000.0")
  const connection = new Connection(clusterUrl, 'singleGossip')

  // The address of the Port Finance on the blockchain
  const programId = new PublicKey(process.env.PROGRAM_ID || "3dQ9quWN8gjqRhrtaQhxGpKU2fLjCz4bAVuzmjms7Rxg")

  // liquidator's keypair
  const keyPairPath = process.env.KEYPAIR || homedir() + '/.config/solana/id.json'
  const payer = new Account(JSON.parse(fs.readFileSync(keyPairPath, 'utf-8')))

  console.log(`partial liquidator launched cluster=${cluster}`);

  const parsedReserveMap = await getParsedReservesMap(connection, programId);
  const wallets: Map<string, { publicKey: PublicKey; tokenAccount: Wallet }> = new Map();
  const reserves:EnrichedReserve[] = [];
  parsedReserveMap.forEach(
    (reserve) => reserves.push(reserve)
  );
  const liquidityWallets = Promise.all(
    reserves.map(
      reserve => findLargestTokenAccountForOwner(connection, payer, reserve.reserve.liquidity.mintPubkey)
    )
  );
  console.log("liquidity completed")
  const collateralWallets = Promise.all(
    reserves.map(
      reserve => findLargestTokenAccountForOwner(connection, payer, reserve.reserve.collateral.mintPubkey)
    )
  );
  for (let i = 0; i < reserves.length; i++) {
    wallets.set(reserves[i].reserve.liquidity.mintPubkey.toBase58(), liquidityWallets[i]);
    wallets.set(reserves[i].reserve.collateral.mintPubkey.toBase58(), collateralWallets[i]);
  }
  

  while (true) {
    try {

      const liquidatedAccounts = await getLiquidatedObligations(connection, programId);
      console.log(`payer account ${payer.publicKey.toBase58()}, we have ${liquidatedAccounts.length} accounts`)
      for (const liquidatedAccount of liquidatedAccounts) {
        console.log("liquidated...")
        await liquidateAccount(connection, programId, payer, liquidatedAccount, parsedReserveMap, wallets);
      }

    } catch (e) {
      notify(`unknown error: ${e}`);
      console.error(e);
    } finally {
      await sleep(checkInterval)
    }
    break;
  }

}

async function liquidateAccount(connection: Connection, programId: PublicKey, payer: Account, obligation: Obligation, parsedReserveMap: Map<string, EnrichedReserve>, wallets: Map<string, { publicKey: PublicKey; tokenAccount: Wallet }>) {
  const accountRentExempt = await connection.getMinimumBalanceForRentExemption(
    AccountLayout.span,
  );
  const lendingMarket: PublicKey = parsedReserveMap.values().next().value.reserve.lendingMarket;
  const [lendingMarketAuthority] = await PublicKey.findProgramAddress(
    [lendingMarket.toBuffer()],
    programId,
  );
  const transaction = new Transaction();
  parsedReserveMap.forEach(
    (reserve: EnrichedReserve) => {
      transaction.add(
        refreshReserveInstruction(
          reserve.publicKey,
          programId,
          reserve.reserve.liquidity.oracleOption === 0 ?
            undefined : reserve.reserve.liquidity.oraclePubkey
        )
      );
    }
  );
  // TODO: choose a more sensible value
  const repayReserve:EnrichedReserve = parsedReserveMap[obligation.borrows[0].borrowReserve.toBase58()];
  const withdrawReserve:EnrichedReserve = parsedReserveMap[obligation.deposits[0].depositReserve.toBase58()];
  
  const transferAuthority = new Account();
  
  if (!wallets.has(repayReserve.reserve.liquidity.mintPubkey.toBase58()) || 
      !wallets.has(withdrawReserve.reserve.collateral.mintPubkey.toBase58())) {
    return;
  }
  
  transaction.add(
    refreshObligationInstruction(
      obligation.publicKey,
      obligation.deposits.map(deposit => deposit.depositReserve),
      obligation.borrows.map(borrow => borrow.borrowReserve),
      programId
    ),
    Token.createApproveInstruction(
      TOKEN_PROGRAM_ID,
      wallets.get(repayReserve.reserve.liquidity.mintPubkey.toBase58())!.publicKey,
      transferAuthority.publicKey,
      payer.publicKey,
      [],
      1000000,
    ),
    liquidateObligationInstruction(
      new BN('18446744073709551615', 10),
      wallets.get(repayReserve.reserve.liquidity.mintPubkey.toBase58())!.publicKey,
      wallets.get(withdrawReserve.reserve.collateral.mintPubkey.toBase58())!.publicKey!,
      repayReserve.publicKey,
      repayReserve.reserve.liquidity.supplyPubkey,
      withdrawReserve.publicKey,
      withdrawReserve.reserve.collateral.supplyPubkey,
      obligation.publicKey,
      lendingMarket,
      lendingMarketAuthority,
      transferAuthority.publicKey,
      programId,
    )
  );
  connection.sendTransaction(
    transaction,
    [payer]
  );
}

async function getLiquidatedObligations(connection: Connection, programId: PublicKey) {
  const obligations = await getAllObligations(connection, programId)
  
  return obligations
    .filter(
      obligation => obligation.unhealthyBorrowValue.lt(obligation.borrowedValue)
    );
}

runPartialLiquidator()

