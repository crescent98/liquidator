import {
  Connection,
  PublicKey,
  Account,
  SystemProgram,
} from '@solana/web3.js';
import axios from 'axios';
import { blob, struct, nu64 } from 'buffer-layout';
import { AccountLayout, Token } from '@solana/spl-token';
import { TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from './ids';
import Big from 'big.js';
import { AccountInfo as TokenAccount } from '@solana/spl-token';
import { parseTokenAccount } from '@project-serum/common';


export const STAKING_PROGRAM_ID = new PublicKey(
  'stkarvwmSzv2BygN5e2LeTwimTczLWHCKPKGC2zVLiq',
);
export const ZERO: Big = new Big(0);

export function notify(content: string) {
  if (process.env.WEBHOOK_URL) {
    axios.post(process.env.WEBHOOK_URL, { text: content });
  }
  console.log(content);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const getUnixTs = () => {
  return new Date().getTime() / 1000;
};

// export async function findLargestTokenAccountForOwner(
//   connection: Connection,
//   owner: Keypair,
//   mint: PublicKey,
// ): Promise<{ publicKey: PublicKey; tokenAccount: Wallet }> {
//   const response = await connection.getTokenAccountsByOwner(
//     owner.publicKey,
//     { mint },
//     connection.commitment,
//   );
//   let max = new BN(0);
//   let maxTokenAccount: TokenAccount | null = null;
//   let maxPubkey: null | PublicKey = null;

//   for (const { pubkey, account } of response.value) {
//     const tokenAccount = parseTokenAccount(account.data);
//     if (tokenAccount.amount.gt(max) ) {
//       maxTokenAccount = tokenAccount;
//       max = tokenAccount.amount;
//       maxPubkey = pubkey;
//     }
//   }

//   if (maxPubkey && maxTokenAccount) {
//     return {publicKey: maxTokenAccount.address, tokenAccount: {
//       mint: maxTokenAccount.mint,
//       owner: maxTokenAccount.owner,
//       amount: max
//     }};
//   } else {
//     console.log('creating new token account');
//     const transaction = new Transaction();
//     const aTokenAccountPubkey = (
//       await PublicKey.findProgramAddress(
//         [
//           owner.publicKey.toBuffer(),
//           TOKEN_PROGRAM_ID.toBuffer(),
//           mint.toBuffer(),
//         ],
//         ATOKEN_PROGRAM_ID,
//       )
//     )[0];

//     transaction.add(
//       Token.createAssociatedTokenAccountInstruction(
//         ATOKEN_PROGRAM_ID,
//         TOKEN_PROGRAM_ID,
//         mint,
//         aTokenAccountPubkey,
//         owner.publicKey,
//         owner.publicKey,
//       ),
//     );
//     await connection.sendTransaction(transaction, [owner]);
//     return {
//       publicKey: aTokenAccountPubkey,
//       tokenAccount: { mint, amount: 0, owner: owner.publicKey },
//     };
//   }
// }

export const ACCOUNT_LAYOUT = struct([
  blob(32, 'mint'),
  blob(32, 'owner'),
  nu64('amount'),
  blob(93),
]);

export function createTokenAccount(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  accountRentExempt: number,
  mint: PublicKey,
  owner: PublicKey,
  signers: Account[],
) {
  const account = createUninitializedAccount(
    instructions,
    payer,
    accountRentExempt,
    signers,
  );

  instructions.push(
    Token.createInitAccountInstruction(
      new PublicKey(TOKEN_PROGRAM_ID),
      mint,
      account,
      owner,
    ),
  );

  return account;
}

export function createUninitializedAccount(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  amount: number,
  signers: Account[],
) {
  const account = new Account();
  instructions.push(
    SystemProgram.createAccount({
      fromPubkey: payer,
      newAccountPubkey: account.publicKey,
      lamports: amount,
      space: AccountLayout.span,
      programId: new PublicKey(TOKEN_PROGRAM_ID),
    }),
  );

  signers.push(account);

  return account.publicKey;
}

export async function getOwnedTokenAccounts(
  connection: Connection,
  publicKey: PublicKey,
): Promise<TokenAccount[]> {
  // @ts-ignore
  let res = await connection.getProgramAccounts(
    TOKEN_PROGRAM_ID,
    {
      filters: [
        {
          memcmp: {
            offset: ACCOUNT_LAYOUT.offsetOf('owner'),
            bytes: publicKey.toBase58(),
          }
        }, 
        {
          dataSize: ACCOUNT_LAYOUT.span,
        }
      ]
    }
  );
  return (
    res
      // @ts-ignore
      .map(r => {
        const tokenAccount = parseTokenAccount(r.account.data);
        tokenAccount.address = r.pubkey;
        return tokenAccount;
      })
  );
}

export interface Wallet {
  mint: PublicKey;
  owner: PublicKey;
  amount: number;
}
