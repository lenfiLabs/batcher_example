import {C, toHex} from 'lucid-cardano'
import * as ed  from '@noble/ed25519'

type OracleOptions = {readFromFile: string} | 'NewKey'
export class Oracle {
  private privateKey: string
  publicKey: string
  constructor(options: OracleOptions) {
    if (options === 'NewKey') {
      const privateKey = C.PrivateKey.generate_ed25519()
      this.privateKey = toHex(privateKey.as_bytes())
      const pubKey = privateKey.to_public()
      this.publicKey = toHex(pubKey.as_bytes())
      pubKey.free()
      privateKey.free()
    } else {
      const theKey = 'ed25519_sk1wqtk0sghhlupsyj2n0k5wywgufa6jmwsc30auphhjfpd2d6ncwks46huac'
      const privateKey = C.PrivateKey.from_bech32(theKey)
      this.privateKey = toHex(privateKey.as_bytes())
      const pubKey = privateKey.to_public()
      this.publicKey = toHex(pubKey.as_bytes())
      pubKey.free()
      privateKey.free()
    }
  }

  async signFeed(payload: string) {
    const signature = await ed.signAsync(payload, this.privateKey)
    return {
      data: payload,
      signature: toHex(signature),
    }
  }
}
