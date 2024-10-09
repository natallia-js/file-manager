const COMMANDS = Object.freeze({
    goUpper: 'up',
    exit: '.exit',
    changeDir: 'cd',
    listDir: 'ls',

    printFileContent: 'cat',
    createEmptyFile: 'add',
    renameFile: 'rn',
    copyFile: 'cp',
    moveFile: 'mv',
    deleteFile: 'rm',

    os: 'os',

    getFileHash: 'hash',
    compressFile: 'compress',
    decompressFile: 'decompress',
});

export default COMMANDS;
