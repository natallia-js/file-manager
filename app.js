import os from 'os';
import FileManager from './src/cli/file-manager/fileManager.js';
import getUserName, { UNKNOWN_USERNAME } from './src/cli/program-arguments/getUserName.js';

let userName = UNKNOWN_USERNAME;
try {
    userName = getUserName(process.argv);
} catch (error) {
    process.stdout.write(`\x1b[31m${error.message}\x1b[0m\n`);
}

const fileManager = new FileManager(os.homedir(), userName);
fileManager.on('close', function() {
    process.exit(0);
});
