// @ts-nocheck

import readline from "readline";
import AES from 'crypto-js/aes';
import Utf8 from 'crypto-js/enc-utf8';
import {HardhatRuntimeEnvironment} from "hardhat/types";

const question = function(question) {

    let rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    let response;

    rl.setPrompt(question);
    rl.prompt();

    rl._writeToOutput = function _writeToOutput(data) {
        rl.output.write("*");
    };

    return new Promise(( resolve , reject) => {

        rl.on('line', (userInput) => {
            response = userInput;
            rl.close();
        });

        rl.on('close', () => {
            resolve(response);
        });

    });

};

const decryptWithAES = (ciphertext, passphrase) => {
    const bytes = AES.decrypt(ciphertext, passphrase);
    return bytes.toString(Utf8);
}

export async function decryptPK(hre: HardhatRuntimeEnvironment) {
    if (process.env.PKE == undefined) {
        throw new Error("Please set PKE env variable");
    }

    let password: string = "";
    await question("Enter the password to decrypt account: ").then(response => password = response.toString());
    console.log();

    if (password == "") {
        throw new Error("Please enter password");
    }

    let encryptedText = process.env.PKE;
    let decryptedText = decryptWithAES(encryptedText, password);
    if (decryptedText == "") {
        throw new Error("Incorrect password");
    }

    if (!decryptedText.startsWith("0x")) {
        decryptedText = "0x" + decryptedText;
    }
    hre.config.networks[hre.network.name].accounts = [decryptedText];
}
