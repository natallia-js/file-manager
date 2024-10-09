import os from 'os';
import readline from 'readline';
import * as fsp from 'fs/promises';
import fs from 'fs';
import path from 'path';
import Event from 'node:events';
import zlib from 'zlib';
import crypto from 'crypto';

import OUTPUT_MESSAGE_TYPES from './types/outputMessageTypes.js';
import COMMANDS from './types/commands.js';
import OS_COMMANDS from './types/osCommands.js';

// !!! TODO: заменить console.table

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
    }

    write(data, messageType = OUTPUT_MESSAGE_TYPES.none, newLine = false) {
        this.#ignoreStdin = true;
        let outputString = data;
        if (messageType === OUTPUT_MESSAGE_TYPES.error)
            outputString = `\x1b[31m$ ${data} \x1b[0m`;
        if (newLine)
            outputString += '\n';
        this.#rl.write(outputString);
        this.#ignoreStdin = false;
    }

    writeln(data, messageType = OUTPUT_MESSAGE_TYPES.none) {
        this.write(data, messageType, true);
    }

    printCurrentWorkDir() {
        this.writeln(`You are currently in ${this.#currentWorkDir}`);
    }

    #showInvalidInputMessage() {
        this.writeln('Invalid input', OUTPUT_MESSAGE_TYPES.error);
    }

    #showOperationFailedMessage() {
        this.writeln('Operation failed', OUTPUT_MESSAGE_TYPES.error);
    }

    close() {
        this.writeln(`Thank you for using File Manager, ${this.#userName}, goodbye!`);
        this.#rl.close();

        this.emit('close');
    }

    async #existsAsync(path) {
        try {
            await fsp.access(path, fsp.constants.F_OK);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Returns false if path is not a directory or directory path does not exist.
     * path can be absolute or relative
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
     * Returns false if pathToFile is not a file or file pathToFile does not exist.
     * pathToFile can be absolute or relative path to the file
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
     * For the given ABSOLUTE path absolutePath returns true if:
     * - absolutePath has a non-zero length and...
     * - it is an existing directory path and...
     * - it is an absolute path and...
     * - this absolute path starts with #rootWorkDir (we cannot work outside our root directory)
     */
    async #ifAbsolutePathOK(absolutePath) {
        if (!absolutePath?.length || !await this.#isDirectory(absolutePath) || !path.isAbsolute(absolutePath))
            return false;
        return absolutePath.toLowerCase().startsWith(this.#rootWorkDir.toLowerCase());
    }

    async #handleUserInput(inputs) {
        if (this.#ignoreStdin)
            return;
        const _commandWithParams = this.#getCommandWithParameters(inputs.toString());
        if (!_commandWithParams?.length)
            return;
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
        this.printCurrentWorkDir();
    }

    #getCommandWithParameters(input) {
        const _input = input.trim();
        if (!_input?.length)
            return [];
        return _input.split(' ').map(_el => _el.trim()).filter(_el => _el);
    }

    // --------------- GENERAL OPERATIONS

    #exit(commandWithParams) {
        if (!commandWithParams?.length || commandWithParams.length > 1 || commandWithParams[0] !== COMMANDS.exit) {
            this.#showInvalidInputMessage();
            return;
        }
        this.close();
    }

    // --------------- DIRECTORY OPERATIONS

    #goUpper(commandWithParams) {
        if (!commandWithParams?.length || commandWithParams.length > 1 || commandWithParams[0] !== COMMANDS.goUpper) {
            this.#showInvalidInputMessage();
            return;
        }
        if (this.#currentWorkDir === this.#rootWorkDir)
            return;
        this.#currentWorkDir = path.resolve(this.#currentWorkDir, '..');
    }

    async #changeDir(commandWithParams) {
        if (!commandWithParams?.length || commandWithParams.length > 2 || commandWithParams[0] !== COMMANDS.changeDir) {
            this.#showInvalidInputMessage();
            return;
        }
        try {
            const nextDir = path.resolve(this.#currentWorkDir, commandWithParams[1]);
            if (!this.#ifAbsolutePathOK(nextDir)) {
                this.#showInvalidInputMessage();
                return;
            }
            this.#currentWorkDir = nextDir;
        } catch {
            this.#showOperationFailedMessage();
        }
    }

    async #listDir(commandWithParams) {
        if (!commandWithParams?.length || commandWithParams.length > 1 || commandWithParams[0] !== COMMANDS.listDir) {
            this.#showInvalidInputMessage();
            return;
        }
        try {
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
            console.table(objects, ['Name','Type']);
        } catch {
            this.#showOperationFailedMessage();
        }
    }

    // --------------- FILE OPERATIONS

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
        console.table(os.cpus().map(el => ({ ...el, speed: `${el.speed} GHz` })), ['model', 'speed']);
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
        if (!commandWithParams?.length || commandWithParams.length > 2 || commandWithParams[0] !== COMMANDS.getFileHash) {
            this.#showInvalidInputMessage();
            return;
        }
        const fullFilePath = path.resolve(this.#currentWorkDir, commandWithParams[1]);
        const fullFileDirname = path.dirname(fullFilePath);
        if (!await this.#isFile(fullFilePath) || !this.#ifAbsolutePathOK(fullFileDirname)) {
            this.#showInvalidInputMessage();
            return;
        }
        async function getSha256Hash(path) {
            return new Promise((resolve, reject) => {
                const hash = crypto.createHash('sha256');
                const readStream = fs.createReadStream(path);
                readStream.on('error', reject);
                readStream.on('data', chunk => hash.update(chunk));
                readStream.on('end', () => resolve(hash.digest('hex')));
            });
        }
        const hashValue = await getSha256Hash(fullFilePath);
        this.writeln(hashValue);
    }
    
    // --------------- COMPRESS/DECOMPRESS OPERATIONS

    async #compressFile(commandWithParams) {
        if (!commandWithParams?.length || commandWithParams.length > 3 || commandWithParams[0] !== COMMANDS.compressFile) {
            this.#showInvalidInputMessage();
            return;
        }
        try {
            const initialFilePath = path.resolve(this.#currentWorkDir, commandWithParams[1]);
            const initialFileDirname = path.dirname(initialFilePath);
            const compressedFilePath = path.resolve(this.#currentWorkDir, commandWithParams[2]);
            const compressedFileDirname = path.dirname(compressedFilePath);
            if (!await this.#isFile(initialFilePath) || !this.#ifAbsolutePathOK(initialFileDirname) ||
                !this.#ifAbsolutePathOK(compressedFileDirname)) {
                this.#showInvalidInputMessage();
                return;
            }
            const readStream = fs.createReadStream(initialFilePath);
            const writeStream = fs.createWriteStream(compressedFilePath);
            const brotli = zlib.createBrotliCompress();
            readStream.pipe(brotli).pipe(writeStream);
        } catch {
            this.#showOperationFailedMessage();
        } 
    }

    async #decompressFile(commandWithParams) {
        if (!commandWithParams?.length || commandWithParams.length > 3 || commandWithParams[0] !== COMMANDS.decompressFile) {
            this.#showInvalidInputMessage();
            return;
        }
        try {
            const initialFilePath = path.resolve(this.#currentWorkDir, commandWithParams[1]);
            const initialFileDirname = path.dirname(initialFilePath);
            const decompressedFilePath = path.resolve(this.#currentWorkDir, commandWithParams[2]);
            const decompressedFileDirname = path.dirname(decompressedFilePath);
            if (!await this.#isFile(initialFilePath) || !this.#ifAbsolutePathOK(initialFileDirname) ||
                !this.#ifAbsolutePathOK(decompressedFileDirname)) {
                this.#showInvalidInputMessage();
                return;
            }
            const readStream = fs.createReadStream(initialFilePath);
            const writeStream = fs.createWriteStream(decompressedFilePath);
            const brotli = zlib.createBrotliDecompress();
            readStream.pipe(brotli).pipe(writeStream);
        } catch {
            this.#showOperationFailedMessage();
        } 
    }    
}

export default FileManager;
