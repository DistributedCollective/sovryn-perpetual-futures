import { queryAMMState } from "./perpQueries";

const ethers = require("ethers");
var path = require("path");
const BN = ethers.BigNumber;

export function getSigningManagerInstances(
    ctrAddr,
    ctrAbi,
    nodeUrl,
    mnemonic,
    fromAddressNo: number = 0,
    numSigners: number = 5,
    baseDerivationPath: string = "m/44'/60'/0'/0"
) {
    const provider = new ethers.providers.JsonRpcProvider(nodeUrl);
    const signingManagers = Array();
    for (let derivation = fromAddressNo; derivation < fromAddressNo + numSigners; derivation++) {
        const path = `${baseDerivationPath}/${derivation}`;
        const mnemonicWallet = ethers.Wallet.fromMnemonic(mnemonic, path);
        const signer = mnemonicWallet.connect(provider);
        const signingContractManager = new ethers.Contract(ctrAddr, ctrAbi, signer);
        signingManagers.push(signingContractManager);
    }

    return signingManagers;
}

export function getSigningManagerFromPK(ctrAddr, ctrAbi, nodeUrl, pk) {
    const provider = new ethers.providers.JsonRpcProvider(nodeUrl);
    const wallet = new ethers.Wallet(pk);
    const signer = wallet.connect(provider);
    const signingContractManager = new ethers.Contract(ctrAddr, ctrAbi, signer);
    return signingContractManager;
}

export function getReadOnlyManagerInstance(ctrAddr, ctrAbi, nodeUrl) {
    const provider = new ethers.providers.JsonRpcProvider(nodeUrl);
    const manager = new ethers.Contract(ctrAddr, ctrAbi, provider);
    return manager;
}

export type FundedLiquidator = {
    [liquidatorAddress: string]: number | Error;
};
/**
 * Get the number of transactions costing at most maxGas this account can perform
 * @param signingManager the signingManager to check
 * @param maxGas the maxGas one transaction will cost
 * @param gasPriceGwei (optional) the gasPrice in gwei
 * @returns the number of transactions
 */
export async function getNumTransactions(signingManager, maxGas, gasPriceGwei: number | null = null): Promise<FundedLiquidator> {
    let provider = signingManager.provider;
    let accountAddress, gasPrice;
    try {
        if (gasPriceGwei === null) {
            [accountAddress, gasPrice] = await Promise.all([signingManager.signer.getAddress(), provider.getGasPrice()]);
        } else {
            accountAddress = await signingManager.signer.getAddress();
            gasPrice = ethers.utils.parseUnits(gasPriceGwei, "gwei");
        }
        let accountBalance = await getAccountBalance(signingManager.provider, accountAddress);
        let numTransactions = accountBalance.div(gasPrice.mul(BN.from(maxGas)));
        return {
            [accountAddress]: Math.floor(numTransactions.toNumber()),
        };
    } catch (e) {
        return {
            [accountAddress?.toString() || "error getting address " + Math.random()]: e as Error,
        };
    }
}

async function getAccountBalance(provider, accountAddress): Promise<any> {
    const balance = await provider.getBalance(accountAddress);
    return balance;
}

export function getManagerAbi() {
    //when using the walletUtils script in programs from the github repo (sovryn-perpetual-swap) its relative path is different than when using it from the npm module
    return getAbi("IPerpetualManager");
}

export function getAbi(abiName: string) {
    //sanitize the input a bit.
    abiName = abiName
        .replace(/\.json/g, "")
        .replace(/\./g, "")
        .replace(/\//g, "")
        .replace(/\\/g, "");

    //when using the walletUtils script in programs from the github repo (sovryn-perpetual-swap) its relative path is different than when using it from the npm module
    let abiPath = __dirname.indexOf("node_modules/@sovryn") === -1 ? `../../abi/${abiName}.json` : `../../../abi/${abiName}.json`;
    let managerAbi = require(abiPath);
    return managerAbi;
}

export function getSigningManagersConnectedToRandomNode(
    ctrAddr,
    mnemonic,
    nodeURLs: Array<string> = [],
    fromAddressNo: number = 0,
    numSigners: number = 1,
    baseDerivationPath: string = "m/44'/60'/0'/0"
) {
    return getSigningContractInstance(ctrAddr, mnemonic, nodeURLs, "IPerpetualManager", fromAddressNo, numSigners, baseDerivationPath);
}

/**
 * Returns a set of contract instances, with signing wallets connected to them.
 * @param ctrAddr the address where the contract is deployed
 * @param mnemonic BIP39 mnemonic from which to derive the private keys of the wallets used to sign transactions when interacting with the contract
 * @param nodeURLs array of node endpoints that the wallets will chose from, to use as RPC providers
 * @param abiName filename of the contract ABI to use (one of the filenames in the ../../abi/ folder)
 * @param fromAddressNo the starting address number in the derivation path (addr X has a derivation path of m/44'/60'/0'/0/X)
 * @param numSigners the total number of contract connected wallets to return (the last will have the derivation path of of m/44'/60'/0'/0/(X+numSigners - 1))
 * @param baseDerivationPath default is m/44'/60'/0'/0

 */
export function getSigningContractInstance(
    ctrAddr,
    mnemonic,
    nodeURLs: Array<string> = [],
    abiName: string,
    fromAddressNo: number = 0,
    numSigners: number = 1,
    baseDerivationPath: string = "m/44'/60'/0'/0"
) {
    const managerAbi = getAbi(abiName);
    if (!nodeURLs.length) {
        throw new Error(`No nodeUrls are present`);
    }
    let randomNode = nodeURLs[Math.floor(Math.random() * nodeURLs.length)];
    return getSigningManagerInstances(ctrAddr, managerAbi, randomNode, mnemonic, fromAddressNo, numSigners, baseDerivationPath);
}

/**
 * Returns a contract instance based on its address and its name
 * @param ctrAddr where the contract is deployed
 * @param nodeURLs an array of node URLs
 * @param abiName the name of the contract (like 'IPerpetualManager')
 */
export function getReadOnlyContractInstance(ctrAddr, nodeURLs, abiName) {
    const ctrAbi = getAbi(abiName);
    if (!nodeURLs.length) {
        throw new Error(`No nodeUrls are present`);
    }
    let randomNode = nodeURLs[Math.floor(Math.random() * nodeURLs.length)];

    return getReadOnlyManagerInstance(ctrAddr, ctrAbi, randomNode);
}

/**
 * Returns a set of contract instances, with signing wallets connected to the fastest responding node (benchmarked against queryAMMState).
 * @param ctrAddr the address where the contract is deployed
 * @param mnemonic BIP39 mnemonic from which to derive the private keys of the wallets used to sign transactions when interacting with the contract
 * @param nodeURLs array of node endpoints that the wallets will chose from, to use as RPC providers
 * @param abiName filename of the contract ABI to use (one of the filenames in the ../../abi/ folder)
 * @param fromAddressNo the starting address number in the derivation path (addr X has a derivation path of m/44'/60'/0'/0/X)
 * @param numSigners the total number of contract connected wallets to return (the last will have the derivation path of of m/44'/60'/0'/0/(X+numSigners - 1))
 * @param perpId the perpId against which to benchmark the queryAMMState 
 * @param baseDerivationPath default is m/44'/60'/0'/0

 */
export async function getSigningManagersConnectedToFastestNode(
    ctrAddr,
    mnemonic,
    nodeURLs: Array<string> = [],
    fromAddressNo: number = 0,
    numSigners: number = 1,
    perpId: any,
    baseDerivationPath: string = "m/44'/60'/0'/0"
) {
    let timeStart = new Date().getTime();
    let promises = Array();
    let i = 0;
    const managerAbi = getAbi("IPerpetualManager");
    for (const node of nodeURLs) {
        let [manager] = getSigningManagerInstances(ctrAddr, managerAbi, node, mnemonic, i, 1, baseDerivationPath);
        promises.push(
            queryAMMState(manager, perpId)
                .then((ammState) => ({ node, queryTime: new Date().getTime() - timeStart }))
                .catch((e) => null)
        );
        i++;
    }

    const fulfilled = await Promise.all(promises);
    let fastestNode = fulfilled.filter( f => f !== null).sort( (a, b) => a.queryTime - b.queryTime).map( f => f.node).shift();

    return getSigningManagerInstances(ctrAddr, managerAbi, fastestNode, mnemonic, fromAddressNo, numSigners, baseDerivationPath);
}
