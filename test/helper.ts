import { use } from "chai";
import { BigNumber } from "ethers";
declare global {
    namespace Chai {
        interface Assertion {
            approximateBigNumber(expected: BigNumber | string, error?: BigNumber | string): Assertion;
        }
    }
}
export function approximation(chai: Chai.ChaiStatic, utils: Chai.ChaiUtils): void {
    utils.overwriteMethod(chai.Assertion.prototype, "approximateBigNumber", function (_super: any) {
        return function (this: any, expected: BigNumber | string, error?: BigNumber | string) {
            var actual = utils.flag(this, "object");
            if (typeof error === "undefined") {
                error = "100000";
            }
            error = BigNumber.from(error);
            const success: boolean = BigNumber.from(expected).sub(BigNumber.from(actual)).abs().lte(error);
            this.assert(
                success,
                `Expected "${expected}" to be approximately ${actual}`,
                `Expected "${expected}" NOT to be approximately ${actual}`,
                expected,
                actual
            );
        };
    });
}
use(approximation);
