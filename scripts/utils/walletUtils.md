## Functions

<dl>
<dt><a href="#getNumTransactions">getNumTransactions(signingManager, maxGas, gasPriceGwei)</a> ⇒</dt>
<dd><p>Get the number of transactions costing at most maxGas this account can perform</p></dd>
<dt><a href="#getSigningContractInstance">getSigningContractInstance(ctrAddr, mnemonic, nodeURLs, abiName, fromAddressNo, numSigners, baseDerivationPath)</a></dt>
<dd><p>Returns a set of contract instances, with signing wallets connected to them.</p></dd>
<dt><a href="#getReadOnlyContractInstance">getReadOnlyContractInstance(ctrAddr, nodeURLs, abiName)</a></dt>
<dd><p>Returns a contract instance based on its address and its name</p></dd>
<dt><a href="#getSigningManagersConnectedToFastestNode">getSigningManagersConnectedToFastestNode(ctrAddr, mnemonic, nodeURLs, abiName, fromAddressNo, numSigners, perpId, baseDerivationPath)</a></dt>
<dd><p>Returns a set of contract instances, with signing wallets connected to the fastest responding node (benchmarked against queryAMMState).</p></dd>
</dl>

<a name="getNumTransactions"></a>

## getNumTransactions(signingManager, maxGas, gasPriceGwei) ⇒
<p>Get the number of transactions costing at most maxGas this account can perform</p>

**Kind**: global function  
**Returns**: <p>the number of transactions</p>  

| Param | Default | Description |
| --- | --- | --- |
| signingManager |  | <p>the signingManager to check</p> |
| maxGas |  | <p>the maxGas one transaction will cost</p> |
| gasPriceGwei | <code></code> | <p>(optional) the gasPrice in gwei</p> |

<a name="getSigningContractInstance"></a>

## getSigningContractInstance(ctrAddr, mnemonic, nodeURLs, abiName, fromAddressNo, numSigners, baseDerivationPath)
<p>Returns a set of contract instances, with signing wallets connected to them.</p>

**Kind**: global function  

| Param | Default | Description |
| --- | --- | --- |
| ctrAddr |  | <p>the address where the contract is deployed</p> |
| mnemonic |  | <p>BIP39 mnemonic from which to derive the private keys of the wallets used to sign transactions when interacting with the contract</p> |
| nodeURLs |  | <p>array of node endpoints that the wallets will chose from, to use as RPC providers</p> |
| abiName |  | <p>filename of the contract ABI to use (one of the filenames in the ../../abi/ folder)</p> |
| fromAddressNo | <code>0</code> | <p>the starting address number in the derivation path (addr X has a derivation path of m/44'/60'/0'/0/X)</p> |
| numSigners | <code>1</code> | <p>the total number of contract connected wallets to return (the last will have the derivation path of of m/44'/60'/0'/0/(X+numSigners - 1))</p> |
| baseDerivationPath | <code>m/44&#x27;/60&#x27;/0&#x27;/0</code> | <p>default is m/44'/60'/0'/0</p> |

<a name="getReadOnlyContractInstance"></a>

## getReadOnlyContractInstance(ctrAddr, nodeURLs, abiName)
<p>Returns a contract instance based on its address and its name</p>

**Kind**: global function  

| Param | Description |
| --- | --- |
| ctrAddr | <p>where the contract is deployed</p> |
| nodeURLs | <p>an array of node URLs</p> |
| abiName | <p>the name of the contract (like 'IPerpetualManager')</p> |

<a name="getSigningManagersConnectedToFastestNode"></a>

## getSigningManagersConnectedToFastestNode(ctrAddr, mnemonic, nodeURLs, abiName, fromAddressNo, numSigners, perpId, baseDerivationPath)
<p>Returns a set of contract instances, with signing wallets connected to the fastest responding node (benchmarked against queryAMMState).</p>

**Kind**: global function  

| Param | Description |
| --- | --- |
| ctrAddr | <p>the address where the contract is deployed</p> |
| mnemonic | <p>BIP39 mnemonic from which to derive the private keys of the wallets used to sign transactions when interacting with the contract</p> |
| nodeURLs | <p>array of node endpoints that the wallets will chose from, to use as RPC providers</p> |
| abiName | <p>filename of the contract ABI to use (one of the filenames in the ../../abi/ folder)</p> |
| fromAddressNo | <p>the starting address number in the derivation path (addr X has a derivation path of m/44'/60'/0'/0/X)</p> |
| numSigners | <p>the total number of contract connected wallets to return (the last will have the derivation path of of m/44'/60'/0'/0/(X+numSigners - 1))</p> |
| perpId | <p>the perpId against which to benchmark the queryAMMState</p> |
| baseDerivationPath | <p>default is m/44'/60'/0'/0</p> |

