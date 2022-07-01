const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

export type ITParameters = {
    parameter_name: string;
    value1: number;
    value2: number;
    category: string;
    comment: string;
};

export type ITPriceScenario = {
    id: number;
    priceIndex: number;
};

export type ITScheduleTraders = {
    traderNo: number;
    time: number;
    tradePos: number;
};

export type ITResultRecord = {
    timeindex: number;
    activeTraders: number;
    trades: [
        {
            traderNoAMM: number;
            cash: number;
            lockedIn: number;
            position: number;
        },
        {
            traderNoAMM: number;
            cash: number;
            lockedIn: number;
            position: number;
        }
    ];
    defaultfund: number;
    ammfund: number;
    participationFund: number;
};

export class TestScenarioReader {
    PARAMS_FILE_NAME = "IntegrationTestParameters.csv";
    PRICE_SCENARIO_FILE_NAME = "PriceScenario.csv";
    SCHEDULE_TRADERS_FILE_NAME = "ScheduleTraders.csv";

    public folder: string = "";

    // READ INPUT
    public setScenarioFolderName(_folder: string) {
        this.folder = _folder;
    }

    public async readParams(): Promise<ITParameters[]> {
        let testParams: ITParameters[] = [];
        let lfolder = this.folder;
        const FILE_NAME = this.PARAMS_FILE_NAME;
        return new Promise(function (resolve, reject) {
            fs.createReadStream(path.join(__dirname, path.sep, lfolder, path.sep, FILE_NAME))
                .pipe(csv())
                .on("data", function (row: ITParameters) {
                    const params: ITParameters = {
                        parameter_name: row.parameter_name,
                        value1: row.value1,
                        value2: row.value2,
                        category: row.category,
                        comment: row.comment,
                    };
                    testParams.push(params);
                })
                .on("end", function () {
                    // console.log("DONE READING PARAMS");
                    resolve(testParams);
                })
                .on("error", reject);
        });
    }

    public async readScenario(): Promise<ITPriceScenario[]> {
        let priceScenario: ITPriceScenario[] = [];
        let lfolder = this.folder;
        const FILE_NAME = this.PRICE_SCENARIO_FILE_NAME;
        return new Promise(function (resolve, reject) {
            //read price scenario
            fs.createReadStream(path.join(__dirname, path.sep, lfolder, path.sep, FILE_NAME))
                .pipe(csv())
                .on("data", function (row: ITPriceScenario) {
                    const scenario: ITPriceScenario = {
                        id: row.id,
                        priceIndex: row.priceIndex,
                    };
                    priceScenario.push(scenario);
                })
                .on("end", function () {
                    // console.log("DONE PRICE SCENARIO");
                    resolve(priceScenario);
                })
                .on("error", reject);
        });
    }

    public async readScheduleTraders(): Promise<Map<number, ITScheduleTraders[]>> {
        let scheduleTraders = new Map();
        let lfolder = this.folder;
        const FILE_NAME = this.SCHEDULE_TRADERS_FILE_NAME;
        return new Promise(function (resolve, reject) {
            //read schedule trader
            fs.createReadStream(path.join(__dirname, path.sep, lfolder, path.sep, FILE_NAME))
                .pipe(csv())
                .on("data", function (row: ITScheduleTraders) {
                    const schedule: ITScheduleTraders = {
                        traderNo: row.traderNo,
                        time: row.time,
                        tradePos: row.tradePos,
                    };
                    let timeSchedules = scheduleTraders.get(row.time);
                    if (timeSchedules == null) {
                        timeSchedules = [];
                    }
                    timeSchedules.push(schedule);
                    scheduleTraders.set(row.time, timeSchedules);
                })
                .on("end", function () {
                    // console.log("DONE SCHEDULE TRADERS");
                    resolve(scheduleTraders);
                })
                .on("error", reject);
        });
    }

    public readResult(filePath: string): ITResultRecord[] {
        return require(filePath);
    }
}

//USAGE
const reader = new TestScenarioReader();
// console.log(reader.readResult("./ResultDataTemplate.json"));
// reader.setScenarioFolderName("scenario1");
// const params = reader.readParams();
// const scenario = reader.readScenario();
// const scheduleTraders = reader.readScheduleTraders();
