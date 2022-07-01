// @ts-nocheck
import { ethers } from "hardhat";
import { BigNumber } from "ethers";
import { expect} from "chai";
import { createOracle, createLiquidityPool, createPerpetual, createPerpetualManager, createMockPerpetual, getBTCBaseParams } from "./TestFactory";
import { floatToABK64x64, ABK64x64ToFloat, calculateLiquidationPriceCollateralBase,
    calculateMaintenanceMarginRate 
} from "../scripts/utils/perpMath";
import { toBytes32, createContract } from "../scripts/utils/utils";
import { IMockPerpetualManager } from "../typechain";
import { liquidateByBot } from "../scripts/liquidations/liquidations"; 
const BN = BigNumber;

const ONE_DEC18 = BN.from(10).pow(BN.from(18));
const ONE_64x64 = BN.from("0x010000000000000000");

// constants based on enums
const COLLATERAL_CURRENCY_QUOTE = 0;
const COLLATERAL_CURRENCY_BASE = 1;
const COLLATERAL_CURRENCY_QUANTO = 2;
const PerpetualStateINVALID = 0;
const PerpetualStateINITIALIZING = 1;
const PerpetualStateNORMAL = 2;
const PerpetualStateEMERGENCY = 3;
const PerpetualStateCLEARED = 4;

let s2: number, s3: number, premium: number;
let baseParamsBTC: BigNumber[];
let accounts, owner, trader1, trader2, liquidators;
let manager: IMockPerpetualManager;
let signingManagers: IMockPerpetualManager[] = [];
let perpetualId, perpetual, poolData, poolId, marginToken;
let S2Oracle;
let oracleBTCUSD;;
let governanceAccount;

describe("PerpetualLiquidatorBot", () => {
    const initialize = async () => {
        accounts = await ethers.getSigners();
        owner = accounts[0].address;
        governanceAccount = accounts[2];
        trader1 = accounts[1];
        trader2 = accounts[2];
        liquidators = [ accounts[3], accounts[4] ];
        manager = (await createPerpetualManager()) as IMockPerpetualManager;
        let poolData = await createLiquidityPool(manager, owner);
        poolId = poolData.id;

        marginToken = poolData.marginToken;
        await marginToken.transfer(manager.address, ONE_DEC18.mul(100000));
        // oracle
        const BTC = toBytes32("BTC");
        const USD = toBytes32("USD");
        const ETH = toBytes32("ETH");
        S2Oracle = 60000
        let prices = [];
        for(var k = 0; k<20; k++) {
            prices.push(floatToABK64x64(S2Oracle));
        }
        oracleBTCUSD = await createContract("MockPriceScenarioOracle", [BTC, USD, prices]);
        let oracles = [oracleBTCUSD.address, await createOracle(ETH, USD)];
        perpetualId = await createPerpetual(manager, poolData.id, baseParamsBTC, null, null, COLLATERAL_CURRENCY_BASE, oracles);
        await initPerp(perpetualId);
        let tokenAmount = floatToABK64x64(9);
        // transfer 'some' tokens to governance
        await poolData.marginToken.mint(governanceAccount.address, ONE_DEC18.mul(100));
        await poolData.marginToken.connect(governanceAccount).approve(manager.address, ONE_DEC18.mul(1000));
        await manager.addAmmGovernanceAddress(governanceAccount.address);
        await manager.setPerpetualState(perpetualId, PerpetualStateINITIALIZING);
        await manager.connect(governanceAccount).addAMMLiquidityToPerpetual(perpetualId, tokenAmount);
        await manager.runLiquidityPool(poolId);

        // ensure trader in active accounts
        let depositAmount = floatToABK64x64(0.1);
        await marginToken.transfer(trader1.address, ONE_DEC18.mul(100));
        await marginToken.transfer(trader2.address, ONE_DEC18.mul(100));
        await marginToken.connect(trader1).approve(manager.address, ONE_DEC18.mul(100));
        await marginToken.connect(trader2).approve(manager.address, ONE_DEC18.mul(100));
        await manager.connect(trader1).deposit(perpetualId, depositAmount);
        await manager.connect(trader2).deposit(perpetualId, depositAmount);
        for (const liq of liquidators){
            signingManagers.push( Object.assign({}, await manager.connect(liq)) );
        }
    };
    async function initPerp(_perpetualId) {
        s2 = 47200;
        s3 = 3600;
        premium = 5;
    
        await manager.setGenericPriceData(_perpetualId, "indexS2PriceData", floatToABK64x64(s2));
        await manager.setGenericPriceData(_perpetualId, "indexS3PriceData", floatToABK64x64(s3));
        await manager.setGenericPriceData(_perpetualId, "currentPremiumEMA", floatToABK64x64(premium));
        await manager.setPerpetualState(_perpetualId, PerpetualStateNORMAL);
        perpetual = await manager.getPerpetual(_perpetualId);
    };
    before(async () => {
        await initialize();
    });

    describe("liquidateByBot", async () => {
        
        
        it("should not liquidate a healthy position", async () => {
            let traderStateBeforeLiquidation = await manager.getTraderState(perpetualId, trader1.address);
            //await liquidateByBot(manager, owner);
            let traderStateAfterLiquidation = await manager.getTraderState(perpetualId, trader1.address);
            expect(traderStateBeforeLiquidation[0]).to.be.eq(traderStateAfterLiquidation[0]);
        });

        it("should liquidate unhealthy position correctly", async () => {
            let L = -46000; // entry price $46000 short
            let pos = -1; // 1 BTC short
            let S2 = 102273; // current share price
            let cash = 0; // 0.2*s2 = 6000
            let premium = 0;
            let perp1 = await manager.getPerpetual(perpetualId);
            let alpha = ABK64x64ToFloat(perp1.fMaintenanceMarginRateAlpha);
            let cap = ABK64x64ToFloat(perp1.fInitialMarginRateCap);
            let alpha1 = ABK64x64ToFloat(perp1.fInitialMarginRateAlpha);
            let beta = ABK64x64ToFloat(perp1.fMarginRateBeta);
            let m = calculateMaintenanceMarginRate(alpha1, alpha, cap, beta, pos);
            let S2Tresh = calculateLiquidationPriceCollateralBase(L, pos, cash, m);   
            let bal = (pos*S2-L)/S2+cash
            
            await manager.setGenericPriceData(perpetualId, "currentPremiumEMA", floatToABK64x64(premium));
            await manager.setGenericPriceData(perpetualId, "indexS2PriceData", floatToABK64x64(S2));
            await manager.setMarginAccount(perpetualId, trader1.address, 
                floatToABK64x64(L), 
                floatToABK64x64(cash), 
                floatToABK64x64(pos));

            let isSafe = await manager.isMaintenanceMarginSafe(perpetualId, trader1.address);
        
            let liqAmount = await manager.getPositionAmountToLiquidate(perpetualId, trader1.address);

            console.log("S2 threshold = ", S2Tresh);
            console.log("margin balance cc should be = ", bal);
            console.log("maintenance margin cc should be = ", Math.abs(pos)*m);
            console.log("trader1 is safe?", isSafe);
            console.log("Liquidation amount = ", ABK64x64ToFloat(liqAmount));

            //  Trader 2 
            S2Tresh = calculateLiquidationPriceCollateralBase(L, pos, cash, m);
            
            bal = (pos*S2-L)/S2+cash
            
            await manager.setGenericPriceData(perpetualId, "currentPremiumEMA", floatToABK64x64(premium));
            await manager.setGenericPriceData(perpetualId, "indexS2PriceData", floatToABK64x64(S2));
            await manager.setMarginAccount(perpetualId, trader2.address, 
                    floatToABK64x64(L), 
                    floatToABK64x64(cash), 
                    floatToABK64x64(pos));

            isSafe = await manager.isMaintenanceMarginSafe(perpetualId, trader2.address);
            liqAmount = await manager.getPositionAmountToLiquidate(perpetualId, trader2.address);

            console.log("trader 2");
            console.log("S2 threshold = ", S2Tresh);
            console.log("margin balance cc should be = ", bal);
            console.log("maintenance margin cc should be = ", Math.abs(pos)*m);
            console.log("trader2 is safe?", isSafe);
            console.log("Liquidation amount = ", ABK64x64ToFloat(liqAmount));
            
            console.log("----------- BEFORE LIQUIDATION ----------------");

            let liqAmountAfter1 = await manager.getPositionAmountToLiquidate(perpetualId, trader1.address);
            let liqAmountAfter2 = await manager.getPositionAmountToLiquidate(perpetualId, trader2.address);

            console.log("Liquidation 1 amount after = "+ ABK64x64ToFloat(liqAmountAfter1) + " Liquidation 1 amount after = " + ABK64x64ToFloat(liqAmountAfter2) );
            
        });
    });
});
