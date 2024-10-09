const WRONG_COMMAND_LINE_ARGUMENTS = 'Wrong command line arguments!';
const USERNAME_COMMAND_LINE_ARG_NAME = 'username';
export const UNKNOWN_USERNAME = 'Unknown';

const parseCommandLineArgs = (args) => {
    if (!args?.length)
        return [];
    let argsArray = args.slice(2);
    if (!argsArray.length)
        return [];
    argsArray = argsArray.map(el => {
        const nameAndValue = el.split('=');
        if (nameAndValue.length != 2 || !nameAndValue[0].startsWith('--') || nameAndValue[0].length === 2) {
            throw new Error(WRONG_COMMAND_LINE_ARGUMENTS);
        }
        return {
            name: nameAndValue[0].slice(2),
            value: nameAndValue[1],
        };
    });
    return argsArray;
};

const checkParsedCommandLineArgs = (argsArray) => {
    if (argsArray?.length !== 1 || argsArray[0].name !== USERNAME_COMMAND_LINE_ARG_NAME)
        throw new Error(WRONG_COMMAND_LINE_ARGUMENTS);
};

const getUserName = (args) => {
    const argsArray = parseCommandLineArgs(args);
    checkParsedCommandLineArgs(argsArray);
    return argsArray.find(el => el.name === USERNAME_COMMAND_LINE_ARG_NAME)?.value || UNKNOWN_USERNAME;
};

export default getUserName;
