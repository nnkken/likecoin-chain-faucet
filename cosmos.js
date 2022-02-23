const secp256k1 = require('secp256k1');
const { bech32 } = require('bech32');
const createHash = require('create-hash');
const jsonStringify = require('fast-json-stable-stringify');
const bip39 = require('bip39');
const bip32 = require('bip32');
const axios = require('axios');

const { chainId, mnemonic, endpoint, denom, } = require('./config.js');

const api = axios.create({ baseURL: endpoint });

// the code of `seedToPrivateKey` is derived from @lunie/cosmos-key
// https://github.com/luniehq/cosmos-keys/blob/2586e7af82fc52c2c2603383e850a1969539f4f1/src/cosmos-keys.ts
function seedToPrivateKey(mnemonic, hdPath = `m/44'/118'/0'/0/0`) {
  const seed = bip39.mnemonicToSeedSync(mnemonic)
  const masterKey = bip32.fromSeed(seed)
  const { privateKey } = masterKey.derivePath(hdPath)
  return privateKey
}

function createSigner(privateKey) {
  const publicKeyArr = secp256k1.publicKeyCreate(privateKey, true);
  const publicKey = Buffer.from(publicKeyArr);
  const sha256 = createHash('sha256');
  const ripemd = createHash('ripemd160');
  sha256.update(publicKey);
  ripemd.update(sha256.digest());
  const rawAddr = ripemd.digest();
  const cosmosAddress = bech32.encode('cosmos', bech32.toWords(rawAddr));
  console.log(`address: ${cosmosAddress}`);
  const sign = (msg) => {
    const msgSha256 = createHash('sha256');
    msgSha256.update(msg);
    const msgHash = msgSha256.digest();
    const { signature: signatureArr } = secp256k1.ecdsaSign(msgHash, privateKey);
    const signature = Buffer.from(signatureArr)
    return { signature, publicKey };
  }
  return { cosmosAddress, sign };
}

const seed = mnemonic;
const privKey = seedToPrivateKey(seed);
const signer = createSigner(privKey);

async function send(to, amount) {
  console.log({ method: send, to, amount });
  const from = signer.cosmosAddress;
  const queryRes = await api.get(`/auth/accounts/${from}`)
  const { sequence, account_number } = queryRes.data.result.value;
  const tx = {
    msgs: [{
        type: 'cosmos-sdk/MsgSend',
        value: {
          from_address: from,
          to_address: to,
          amount: [{ denom, amount: amount.toFixed() }],
        }
      }],
    fee: {
      amount: [{ denom, amount: '80000000' }],
      gas: '80000'
    },
    chain_id: chainId,
    account_number,
    sequence,
    memo: '',
  }
  const signBytes = jsonStringify(tx);
  signer.sign(signBytes);
  const { signature, publicKey } = signer.sign(signBytes)
  const signatures = [{
    signature: signature.toString('base64'),
    pub_key: {
      type: 'tendermint/PubKeySecp256k1',
      value: publicKey.toString('base64'),
    },
  }];
  tx.msg = tx.msgs;
  delete tx.msgs;
  tx.signatures = signatures;
  const req = { mode: 'block', tx };
  return api.post('/txs', req)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

class RateLimiter {
  constructor() {
    this.queue = [];
    this.working = false;
  }

  enqueue(to, amount) {
    const job = { to, amount };
    const promise = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    this.queue.push(job);
    this._doWork();
    return promise;
  }

  async _doWork() {
    if (this.working) {
      return;
    }
    this.working = true;
    while (this.queue.length > 0) {
      try {
        const { to, amount, resolve, reject } = this.queue.shift();
        try {
          const res = await send(to, amount);
          resolve(res.data);
          console.log(`Rate limiter sleeping at ${new Date()}`);
          await sleep(30000);
          console.log(`Rate limiter wake up at ${new Date()}`);
        } catch (err) {
          reject(err);
        }
      } catch (err) {
        console.error(err);
      }
    }
    this.working = false;
  }
}

const rateLimiter = new RateLimiter();
module.exports = { sendTx: (to, amount) => rateLimiter.enqueue(to, amount) };
