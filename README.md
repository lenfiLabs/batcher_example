# Lenfi Batcher
Automated batcher to execute Lenfi sequenced orders

This version is using Maestro as translucent provider and some legacy Blockfrost API calls. Script loops thru UTxOs of related contracts and executes transactions on-chain.

Areas to improve:
- Script does not calculate if transactions are profitable
- Scripts loops over unspendable UTXoS over and over. Should be more event based system.
- There is no Oracle valid integration yet. Testnet version uses signAnything of Oracle class.


### Development

```
bun install
```

#### Run script
```
cd src
bun index.ts
```


#### .env example
```
# .env
BLOCKFROST_URL=https://cardano-mainnet.blockfrost.io/api/v0
BLOCKFROST_KEY=
ENVIRONMENT=Mainnet
MAESTRO_KEY=
BATCHER_KEY= {your batcher key ed25519_ format}
```


