import * as os from 'node:os';
import * as readline from 'node:readline';
import * as fsp from 'node:fs/promises';
import * as fs from 'node:fs';
import path from 'node:path';
import Event from 'node:events';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

import OUTPUT_MESSAGE_TYPES from './types/outputMessageTypes.js';
import COMMANDS from './types/commands.js';
import OS_COMMANDS from './types/osCommands.js';

class FileManager extends Event.EventEmitter {
    #rootWorkDir = '';
    #currentWorkDir = '';
    #rl = null;
    #ignoreStdin = false;
    #userName = '';

    constructor(currentWorkDir, userName) {
        super();

        this.#rootWorkDir = currentWorkDir;
        this.#currentWorkDir = currentWorkDir;

        this.#userName = userName;

        this.#rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        this.#rl.on('SIGINT', () => {
            this.close();
        });
        this.#rl.on('line',  async inputs => {
            this.#handleUserInput(inputs);
        });

        this.writeln(`Welcome to the File Manager, ${userName}!`);
        this.printCurrentWorkDir();
        this.#printProptForCommand();
    }

    write(data, messageType = OUTPUT_MESSAGE_TYPES.none, newLine = false) {
        this.#ignoreStdin = true;
        let outputString = data;
        switch (messageType) {
            case OUTPUT_MESSAGE_TYPES.error:
                outputString = `\x1b[31m${data}\x1b[0m`;
                break;
            case OUTPUT_MESSAGE_TYPES.currDirMessage:
                outputString = `\x1b[33m${data}\x1b[0m`;
                break;
        }
        if (newLine)
            outputString += '\n';
        this.#rl.write(outputString);
        this.#ignoreStdin = false;
    }

    writeln(data, messageType = OUTPUT_MESSAGE_TYPES.none) {
        this.write(data || '', messageType, true);
    }

    printTable(data, properties = []) {
        if (!properties.length)
            console.table(data || []);
        else
            console.table(data || [], properties);
    }

    printCurrentWorkDir() {
        this.writeln(`You are currently in ${this.#currentWorkDir}`, OUTPUT_MESSAGE_TYPES.currDirMessage);
    }

    #printProptForCommand() {
        this.writeln('> Print command:');
    }

    #showInvalidInputMessage() {
        this.writeln('Invalid input', OUTPUT_MESSAGE_TYPES.error);
    }

    #showOperationFailedMessage(errorMessage) {
        this.writeln(`Operation failed: ${errorMessage}`, OUTPUT_MESSAGE_TYPES.error);
    }

    close() {
        this.writeln(`Thank you for using File Manager, ${this.#userName}, goodbye!`);
        this.#rl.close();
        this.emit('close');
    }

    /**
     * Returns false if:
     * - directory pathToDir does not exist or...
     * - pathToDir is not a directory
     * pathToDir must be absolute!
     */
    async #isDirectory(pathToDir) {
        try {
            const stats = await fsp.stat(pathToDir);
            return stats.isDirectory();
        } catch {
          return false;
        }
    }

    /**
     * Returns false if:
     * - file pathToFile does not exist or...
     * - pathToFile is not a file
     * pathToFile must be an absolute path to a file!
     */
    async #isFile(pathToFile) {
        try {
            const stats = await fsp.stat(pathToFile);
            return stats.isFile();
        } catch {
            return false;
        }
    }

    /**
     * For given absolute or relative path to the file pathToFile checks that:
     * - pathToFile has a non-zero length and...
     * - checkFileExistance = true and pathToFile is an existing file and...
     * - checkFileNonExistance = true and pathToFile is a non-existing file and...
     * - pathToFile's absolute path is #rootWorkDir or subdirectory of #rootWorkDir
     */
    async #ifFileOK({ pathToFile, checkFileExistance = true, checkFileNonExistance = false }) {
        if (!pathToFile?.length)
            throw new Error('Path to file is not set');
        const fullFilePath = path.resolve(this.#currentWorkDir, pathToFile);
        const fullFileDirname = path.dirname(fullFilePath);
        if (checkFileExistance && !await this.#isFile(fullFilePath))
            throw new Error(`File '${fullFilePath}' does not exist`);
        if (checkFileNonExistance && await this.#isFile(fullFilePath))
            throw new Error(`File '${fullFilePath}' already exists`);
        await this.#ifAbsolutePathOK({ absolutePath: fullFileDirname });
    }

    /**
     * For the given ABSOLUTE path absolutePath checks that:
     * - absolutePath has a non-zero length and...
     * - checkDirectoryExistance = true and absolutePath is an existing directory path and...
     * - absolutePath is an absolute path and...
     * - this absolute path starts with #rootWorkDir (we cannot work outside our root directory)
     */
    async #ifAbsolutePathOK({ absolutePath, checkDirectoryExistance = true }) {
        if (!absolutePath?.length)
            throw new Error('Path to directory is not set');
        if (!path.isAbsolute(absolutePath))
            throw new Error(`Path '${absolutePath}' is not absolute`);
        if (checkDirectoryExistance && !await this.#isDirectory(absolutePath))
            throw new Error(`Directory '${absolutePath}' does not exist`);
        if (!absolutePath.toLowerCase().startsWith(this.#rootWorkDir.toLowerCase()))
            throw new Error(`You can't go upper than root directory`);
    }

    async #handleUserInput(inputs) {
        if (this.#ignoreStdin)
            return;
        const _commandWithParams = this.#getCommandWithParameters(inputs.toString());
        if (!_commandWithParams?.length)
            return;
        try {
            switch (_commandWithParams[0]) {
                // --------------- GENERAL OPERATIONS
                case COMMANDS.exit:
                    this.#exit(_commandWithParams);
                    break;
                // --------------- DIRECTORY OPERATIONS
                case COMMANDS.goUpper:
                    this.#goUpper(_commandWithParams);
                    break;
                case COMMANDS.changeDir:
                    await this.#changeDir(_commandWithParams);
                    break;
                case COMMANDS.listDir:
                    await this.#listDir(_commandWithParams);
                    break;
                // --------------- FILE OPERATIONS
                case COMMANDS.printFileContent:
                    await this.#printFileContent(_commandWithParams);
                    break;
                case COMMANDS.createEmptyFile:
                    await this.#createEmptyFile(_commandWithParams);
                    break;
                case COMMANDS.renameFile:
                    await this.#renameFile(_commandWithParams);
                    break;
                case COMMANDS.copyFile:
                    await this.#copyFile(_commandWithParams);
                    break;
                case COMMANDS.moveFile:
                    await this.#moveFile(_commandWithParams);
                    break;
                case COMMANDS.deleteFile:
                    await this.#deleteFile(_commandWithParams);
                    break;
                // --------------- SYSTEM OPERATIONS
                case COMMANDS.os:
                    const commandParameter = this.#getOSCommandParameter(_commandWithParams);
                    switch (commandParameter) {
                        case OS_COMMANDS.getDefaultSystemEOL:
                            this.#getEOL();
                            break;
                        case OS_COMMANDS.getSystemCPUsInfo:
                            this.#getCPUsInfo();
                            break;
                        case OS_COMMANDS.getHomeDir:
                            this.#getHomeDir();
                            break;
                        case OS_COMMANDS.getUserName:
                            this.#getUserName();
                            break;
                        case OS_COMMANDS.getCPUArchitecture:
                            this.#getCPUArchitecture();
                            break;
                        default:
                            this.#showInvalidInputMessage();
                            break;
                    }
                    break;
                // --------------- HASH OPERATIONS
                case COMMANDS.getFileHash:
                    await this.#getFileHash(_commandWithParams);
                    break;
                // --------------- COMPRESS/DECOMPRESS OPERATIONS
                case COMMANDS.compressFile:
                    await this.#compressFile(_commandWithParams);
                    break;
                case COMMANDS.decompressFile:
                    await this.#decompressFile(_commandWithParams);
                    break;                
                // --------------- DIFAULT OPERATION
                default:
                    this.#showInvalidInputMessage();
                    break;
            }
        } catch (error) {
            this.#showOperationFailedMessage(error.message);
        } finally {
            this.printCurrentWorkDir();
            this.#printProptForCommand();
        }
    }

    #charIsBracket(charSymbol) {
        return ["'", '"'].includes(charSymbol);
    }

    /**
     * Parses command with all user params.
     * Path, FileName and DirectoryName paramaters can be in brackets.
     */
    #getCommandWithParameters(input) {
        if (!input?.length)
            return [];
        const params = [];
        const stringToParse = input.trim();
        let tmp = '';
        let paramInBracketsStarted = false;
        for (let i = 0; i < stringToParse.length; i++) {
            const nextSymbol = stringToParse[i];
            if (this.#charIsBracket(nextSymbol)) {
                paramInBracketsStarted = !paramInBracketsStarted;
            }
            if (nextSymbol !== ' ') {
                tmp += nextSymbol;
            } else {
                if (paramInBracketsStarted)
                    tmp += nextSymbol;
                else {
                    if (tmp.length) {
                        params.push(tmp);
                        tmp = '';
                    }
                }
            }
        }
        if (tmp.length)
            params.push(tmp);
        return params;
    }

    #unbraketString(str) {
        if (!str?.length)
            return str;
        let res = str;
        if (!this.#charIsBracket(res[0]))
            return res;
        if (res[0] !== res[res.length-1])
            return res;
        res = res.slice(1);
        if (!res.length)
            return res;
        res = res.slice(0, res.length - 1);
        return res;
    }

    // --------------- GENERAL OPERATIONS

    #exit(commandWithParams) {
        if (!commandWithParams?.length || commandWithParams.length !== 1 || commandWithParams[0] !== COMMANDS.exit) {
            this.#showInvalidInputMessage();
            return;
        }
        this.close();
    }

    // --------------- DIRECTORY OPERATIONS

    #goUpper(commandWithParams) {
        if (!commandWithParams?.length || commandWithParams.length !== 1 || commandWithParams[0] !== COMMANDS.goUpper) {
            this.#showInvalidInputMessage();
            return;
        }
        if (this.#currentWorkDir === this.#rootWorkDir)
            return;
        this.#currentWorkDir = path.resolve(this.#currentWorkDir, '..');
    }

    async #changeDir(commandWithParams) {
        if (!commandWithParams?.length || commandWithParams.length !== 2 || commandWithParams[0] !== COMMANDS.changeDir) {
            this.#showInvalidInputMessage();
            return;
        }
        const nextDir = path.resolve(this.#currentWorkDir, this.#unbraketString(commandWithParams[1]));
        await this.#ifAbsolutePathOK({ absolutePath: nextDir });
        this.#currentWorkDir = nextDir;
    }

    async #listDir(commandWithParams) {
        if (!commandWithParams?.length || commandWithParams.length !== 1 || commandWithParams[0] !== COMMANDS.listDir) {
            this.#showInvalidInputMessage();
            return;
        }
        let objects = await Promise.all(
            (await fsp.readdir(this.#currentWorkDir))
                .map(async (element) => {
                    return {
                        Name: element,
                        isDirectory: await this.#isDirectory(path.join(this.#currentWorkDir, element)),
                    };
                })
            );
        objects.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory)
                return -1;
            if (!a.isDirectory && b.isDirectory)
                return 1;
            if (a.name < b.name) {
                return -1;
            }
            if (a.name > b.name) {
                return 1;
            }
            return 0;
        });
        objects = objects.map(object => {
            const objectType = object.isDirectory ? 'directory' : 'file';
            return {
                ...object,
                Type: objectType,
            };
        });
        this.printTable(objects, ['Name','Type']);
    }

    // --------------- FILE OPERATIONS

    async #printFileContent(commandWithParams) {
        if (!commandWithParams?.length || commandWithParams.length !== 2 || commandWithParams[0] !== COMMANDS.printFileContent) {
            this.#showInvalidInputMessage();
            return;
        }
        const pathToFile = path.resolve(this.#currentWorkDir, this.#unbraketString(commandWithParams[1]));
        await this.#ifFileOK({ pathToFile });
        return new Promise((resolve, reject) => {
            const readableStream = fs.createReadStream(pathToFile, 'utf-8');
            readableStream.on('data', chunk => {
                this.write(chunk.toString());
            });
            readableStream.on('end', () => {
                this.writeln();
                resolve();
            });
            readableStream.on('error', reject);
        });
    }

    async #createEmptyFile(commandWithParams) {
        if (!commandWithParams?.length || commandWithParams.length !== 2 || commandWithParams[0] !== COMMANDS.createEmptyFile) {
            this.#showInvalidInputMessage();
            return;
        }
        const pathToFile = path.resolve(this.#currentWorkDir, this.#unbraketString(commandWithParams[1]));
        await this.#ifFileOK({ pathToFile, checkFileExistance: false, checkFileNonExistance: true });
        await fsp.writeFile(pathToFile, '', 'utf-8');
    }

    async #renameFile(commandWithParams) {
        if (!commandWithParams?.length || commandWithParams.length !== 3 || commandWithParams[0] !== COMMANDS.renameFile) {
            this.#showInvalidInputMessage();
            return;
        }
        const filePath = path.resolve(this.#currentWorkDir, this.#unbraketString(commandWithParams[1]));
        const newFilePath = path.resolve(this.#currentWorkDir, this.#unbraketString(commandWithParams[2]));
        await this.#ifFileOK({ pathToFile: filePath, checkFileExistance: true });
        await this.#ifFileOK({ pathToFile: newFilePath, checkFileExistance: false, checkFileNonExistance: true });
        await fsp.rename(filePath, newFilePath);
    }

    async #createCopyingPromise(filePath, newFilePath) {
        return new Promise((resolve, reject) => {
            try {
                const readableStream = fs.createReadStream(filePath, 'utf-8');
                const writableStream = fs.createWriteStream(newFilePath);
                readableStream.pipe(writableStream);
                writableStream.on('finish', resolve);
            } catch (error) {
                reject(error);
            }
        });
    }

    async #copyFile(commandWithParams) {
        if (!commandWithParams?.length || commandWithParams.length !== 3 || commandWithParams[0] !== COMMANDS.copyFile) {
            this.#showInvalidInputMessage();
            return;
        }
        const filePath = path.resolve(this.#currentWorkDir, this.#unbraketString(commandWithParams[1]));
        const newFilePath = path.resolve(this.#currentWorkDir, this.#unbraketString(commandWithParams[2]));
        await this.#ifFileOK({ pathToFile: filePath, checkFileExistance: true });
        await this.#ifFileOK({ pathToFile: newFilePath, checkFileExistance: false, checkFileNonExistance: true });
        await this.#createCopyingPromise(filePath, newFilePath);
    }

    async #moveFile(commandWithParams) {
        if (!commandWithParams?.length || commandWithParams.length !== 3 || commandWithParams[0] !== COMMANDS.moveFile) {
            this.#showInvalidInputMessage();
            return;
        }
        const filePath = path.resolve(this.#currentWorkDir, this.#unbraketString(commandWithParams[1]));
        const newFilePath = path.resolve(this.#currentWorkDir, this.#unbraketString(commandWithParams[2]));
        await this.#ifFileOK({ pathToFile: filePath, checkFileExistance: true });
        await this.#ifFileOK({ pathToFile: newFilePath, checkFileExistance: false, checkFileNonExistance: true });
        await this.#createCopyingPromise(filePath, newFilePath);
        await fsp.unlink(filePath);
    }

    async #deleteFile(commandWithParams) {
        if (!commandWithParams?.length || commandWithParams.length !== 2 || commandWithParams[0] !== COMMANDS.deleteFile) {
            this.#showInvalidInputMessage();
            return;
        }
        const pathToFile = path.resolve(this.#currentWorkDir, this.#unbraketString(commandWithParams[1]));
        await this.#ifFileOK({ pathToFile });
        await fsp.unlink(pathToFile);
    }

    // --------------- SYSTEM OPERATIONS

    #getOSCommandParameter(commandWithParams) {
        if (!commandWithParams?.length || commandWithParams.length > 2 ||
            commandWithParams[0] !== COMMANDS.os || !Object.values(OS_COMMANDS).includes(commandWithParams[1])) {
            return null;
        }
        return commandWithParams[1];
    }

    #getEOL() {
        this.writeln(JSON.stringify(os.EOL));
    }

    #getCPUsInfo() {
        this.printTable(os.cpus().map(el => ({ ...el, speed: `${el.speed} GHz` })), ['model', 'speed']);
    }

    #getHomeDir() {
        this.writeln(this.#rootWorkDir);
    }

    #getUserName() {
        this.writeln(this.#userName);
    }

    #getCPUArchitecture() {
        this.writeln(os.arch());
    }

    // --------------- HASH OPERATIONS

    async #getFileHash(commandWithParams) {
        if (!commandWithParams?.length || commandWithParams.length !== 2 || commandWithParams[0] !== COMMANDS.getFileHash) {
            this.#showInvalidInputMessage();
            return;
        }
        const pathToFile = path.resolve(this.#currentWorkDir, this.#unbraketString(commandWithParams[1]));
        await this.#ifFileOK({ pathToFile });
        async function getSha256Hash(path) {
            return new Promise((resolve, reject) => {
                const hash = crypto.createHash('sha256');
                const readStream = fs.createReadStream(path);
                readStream.on('error', reject);
                readStream.on('data', chunk => hash.update(chunk));
                readStream.on('end', () => resolve(hash.digest('hex')));
            });
        }
        const hashValue = await getSha256Hash(pathToFile);
        this.writeln(hashValue);
    }
    
    // --------------- COMPRESS/DECOMPRESS OPERATIONS

    async #compressFile(commandWithParams) {
        if (!commandWithParams?.length || commandWithParams.length !== 3 || commandWithParams[0] !== COMMANDS.compressFile) {
            this.#showInvalidInputMessage();
            return;
        }
        const initialFilePath = path.resolve(this.#currentWorkDir, this.#unbraketString(commandWithParams[1]));
        const compressedFilePath = path.resolve(this.#currentWorkDir, this.#unbraketString(commandWithParams[2]));
        await this.#ifFileOK({ pathToFile: initialFilePath });
        await this.#ifFileOK({ pathToFile: compressedFilePath, checkFileExistance: false, checkFileNonExistance: true });
        return new Promise((resolve, reject) => {
            const readStream = fs.createReadStream(initialFilePath, 'utf-8');
            const writeStream = fs.createWriteStream(compressedFilePath);
            const brotli = zlib.createBrotliCompress();
            readStream.pipe(brotli).pipe(writeStream);
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
        });
    }

    async #decompressFile(commandWithParams) {
        if (!commandWithParams?.length || commandWithParams.length !== 3 || commandWithParams[0] !== COMMANDS.decompressFile) {
            this.#showInvalidInputMessage();
            return;
        }
        const compressedFilePath = path.resolve(this.#currentWorkDir, this.#unbraketString(commandWithParams[1]));
        const decompressedFilePath = path.resolve(this.#currentWorkDir, this.#unbraketString(commandWithParams[2]));
        await this.#ifFileOK({ pathToFile: compressedFilePath });
        await this.#ifFileOK({ pathToFile: decompressedFilePath, checkFileExistance: false, checkFileNonExistance: true });
        return new Promise((resolve, reject) => {
            const readStream = fs.createReadStream(compressedFilePath);
            const writeStream = fs.createWriteStream(decompressedFilePath);
            const brotli = zlib.createBrotliDecompress();
            readStream.pipe(brotli).pipe(writeStream);
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
        });
    }    
}

export default FileManager;
