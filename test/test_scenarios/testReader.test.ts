import { expect, use, util } from "chai";
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
import {ITResultRecord, ITScheduleTraders, TestScenarioReader} from "./TestScenarioReader";

describe("#test reader", async () => {
    let tsreader: TestScenarioReader;
    before(async () => {
        tsreader = new TestScenarioReader();
    });
    it("should read test scenarios", async () => {
        tsreader.setScenarioFolderName("scenario1");

        const params = await tsreader.readParams();
        expect(params[0]).not.eql(undefined);

        const scenario = await tsreader.readScenario();
        expect(scenario[0]).not.eql(undefined);

        const scheduleTraders: Map<number, ITScheduleTraders[]> = await tsreader.readScheduleTraders();
        expect(scheduleTraders.size).gt(0);
        expect(scheduleTraders.size).greaterThan(0);
    });
    it("should read test result", async () => {
        const res: ITResultRecord[] = tsreader.readResult("./ResultDataTemplate.json");
        expect(res[0].trades[0].cash).to.be.gt(0);
    });
});
