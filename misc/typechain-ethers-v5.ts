// a simplified version of 'import "hardhat-typechain"' where *Factory will not contain bytecode

import Ethers, { IEthersCfg } from "@typechain/ethers-v5";
import { TContext, TFileDesc, TOutput, TsGeneratorPlugin } from "ts-generator";
import { TLogger } from "ts-generator/dist/logger";
import {
  extractAbi,
  extractDocumentation,
  getFilename,
  parse,
} from "typechain";

import { task } from "hardhat/config";
import { TASK_COMPILE } from "hardhat/builtin-tasks/task-names";
import { TypeChain } from "typechain/dist/TypeChain";
import { tsGenerator } from "ts-generator";
task(
  TASK_COMPILE,
  "Compiles the entire project, building all artifacts"
).setAction(async ({ global }: { global: boolean }, { config }, runSuper) => {
  if (global) {
    return;
  }
  await runSuper();

  // RUN TYPECHAIN TASK
  console.log(`Creating simplified Typechain`);
  const cwd = process.cwd();
  await tsGenerator(
    { cwd },
    new TypeChain({
      cwd,
      rawConfig: {
        files: `${config.paths.artifacts}/!(build-info)/**/+([a-zA-Z0-9]).json`,
        outDir: "typechain",
        target: "./misc/typechain-ethers-v5",
      },
    })
  );
  console.log(`Successfully generated simplified Typechain artifacts!`);
});

export default class Gen implements TsGeneratorPlugin {
  readonly ctx!: TContext;
  readonly logger!: TLogger;
  name = "Ethers";
  e: Ethers;

  constructor(ctx: TContext<IEthersCfg>) {
    this.e = new Ethers(ctx);
  }

  beforeRun(): TOutput | Promise<TOutput> {
    return this.e.beforeRun();
  }

  afterRun(): TOutput | Promise<TOutput> {
    return this.e.afterRun();
  }

  transformFile(file: TFileDesc): TFileDesc[] | void {
    const name = getFilename(file.path);
    const abi = extractAbi(file.contents);
    if (abi.length === 0) {
      return;
    }
    const documentation = extractDocumentation(file.contents);
    const contract = parse(abi, name, documentation);
    return [
      this.e.genContractTypingsFile(contract),
      this.e.genContractFactoryFile(contract, abi),
    ];
  }
}
