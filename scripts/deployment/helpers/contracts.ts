import { deployments, ethers, waffle, getNamedAccounts } from "hardhat";
import { Signer, Contract, BigNumber } from "ethers";
import { validMainnetChainsId } from "./constants";
import hre from "hardhat";

import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction, DeployResult } from "hardhat-deploy/types";
import { PerpetualManagerProxy, IMockPerpetualManager, IPerpetualManager, MockToken, OracleFactory } from "../../../typechain/";

export const isValidMainnet = () => {
    return validMainnetChainsId[hre.network.name] == hre.network.config.chainId;
};

export const proxySetImplementation = async (deployTx: DeployResult, contractName: string) => {
    const {
        deployments: { get, log },
    } = hre;
    if (contractName.toUpperCase().includes("MOCK")) {
        log(">>>>>>>>>> WARNING: MOCK CONTRACT DEPLOYMENT DETECTED!", contractName, " IMPLEMENTATION IS SET TO THE PROXY MANAGER <<<<<<<<<<");

        if (validMainnetChainsId[hre.network.name] == hre.network.config.chainId) {
            throw "TRYING TO DEPLOY MOCKS TO THE MAINNET!";
        }
    }
    const manager: PerpetualManagerProxy = await getPerpetualManagerProxy();
    const tx = await manager.setImplementation(deployTx.address);
    await tx.wait();
};

export const getIMockPerpetualManager = async (): Promise<IMockPerpetualManager> => {
    const {
        deployments: { get },
    } = hre;
    const perpetualManagerProxyDeployment = await get("PerpetualManagerProxy");
    return (await ethers.getContractAt("IMockPerpetualManager", perpetualManagerProxyDeployment.address)) as IMockPerpetualManager;
};

export const getIPerpetualManager = async (): Promise<IPerpetualManager> => {
    const {
        deployments: { get },
    } = hre;
    const perpetualManagerProxyDeployment = await get("PerpetualManagerProxy");
    return (await ethers.getContractAt("IPerpetualManager", perpetualManagerProxyDeployment.address)) as IPerpetualManager;
};

export const getPerpetualManagerProxy = async (): Promise<PerpetualManagerProxy> => {
    const {
        deployments: { get },
    } = hre;
    const perpetualManagerProxyDeployment = await get("PerpetualManagerProxy");
    return (await ethers.getContractAt("PerpetualManagerProxy", perpetualManagerProxyDeployment.address)) as PerpetualManagerProxy;
};

export const getOracleFactory = async (): Promise<OracleFactory> => {
    const {
        deployments: { get },
    } = hre;
    const oracleFactory = await get("OracleFactory");
    return (await ethers.getContractAt("OracleFactory", oracleFactory.address)) as OracleFactory;
};

export const isDeployMocks = (): boolean => {
    return process.env.DEPLOY_MOCKS == "true";
};

export const getPerpetualManagerOrMock = async (): Promise<IMockPerpetualManager | IPerpetualManager> => {
    if (isDeployMocks()) {
        return await getIMockPerpetualManager();
    } else {
        return await getIPerpetualManager();
    }
};

export const deployContract = async (contractName: string, args?: any[]): Promise<Contract> => {
    const {
        deployments: { deploy, log, get },
        getNamedAccounts,
        ethers,
    } = hre;

    const { deployer } = await getNamedAccounts();

    await deploy(contractName, {
        from: deployer,
        args: args,
        log: true,
    });
    return await ethers.getContractAt(contractName, (await get(contractName)).address);
};

export const deployModuleContract = async (contractName: string, args?: any[]) => {
    const {
        deployments: { deploy },
        getNamedAccounts,
    } = hre;

    const { deployer } = await getNamedAccounts();

    const deployTx = await deploy(contractName, {
        from: deployer,
        args: args,
        log: true,
    });
    if (deployTx.newlyDeployed) {
        await proxySetImplementation(deployTx, contractName);
    }
    return deployTx;
};

export const deployMockToken = async (): Promise<MockToken> => {
    return (await deployContract("MockToken")) as MockToken;
};

export function getContracts(hre: HardhatRuntimeEnvironment) {
    return null;
}
