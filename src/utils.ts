import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { platform } from 'os';
import path from 'path';
import * as vscode from 'vscode';
import JSZip from 'jszip';

import config from './config';
import { getProbSaveLocation } from './parser';
import {
    getCArgsPref,
    getCppArgsPref,
    getPythonArgsPref,
    getRustArgsPref,
    getJavaArgsPref,
    getJsArgsPref,
    getGoArgsPref,
    getHaskellArgsPref,
    getCCommand,
    getCppCommand,
    getPythonCommand,
    getRustCommand,
    getJavaCommand,
    getJsCommand,
    getGoCommand,
    getHaskellCommand,
} from './preferences';
import { Language, Problem, TestCase } from './types';
import telmetry from './telmetry';
import { getJudgeViewProvider } from './extension';

const oc = vscode.window.createOutputChannel('cph');

/**
 * Get language based on file extension
 */
export const getLanguage = (srcPath: string): Language => {
    const extension = path.extname(srcPath).split('.').pop();
    let langName: string | void = undefined;
    for (const [lang, ext] of Object.entries(config.extensions)) {
        if (ext === extension) {
            langName = lang;
        }
    }

    if (langName === undefined) {
        throw new Error('Invalid extension');
    }

    switch (langName) {
        case 'cpp': {
            return {
                name: langName,
                args: [...getCppArgsPref()],
                compiler: getCppCommand(),
                skipCompile: false,
            };
        }
        case 'c': {
            return {
                name: langName,
                args: [...getCArgsPref()],
                compiler: getCCommand(),
                skipCompile: false,
            };
        }
        case 'python': {
            return {
                name: langName,
                args: [...getPythonArgsPref()],
                compiler: getPythonCommand(),
                skipCompile: true,
            };
        }
        case 'rust': {
            return {
                name: langName,
                args: [...getRustArgsPref()],
                compiler: getRustCommand(),
                skipCompile: false,
            };
        }
        case 'java': {
            return {
                name: langName,
                args: [...getJavaArgsPref()],
                compiler: getJavaCommand(),
                skipCompile: false,
            };
        }
        case 'js': {
            return {
                name: langName,
                args: [...getJsArgsPref()],
                compiler: getJsCommand(),
                skipCompile: true,
            };
        }
        case 'go': {
            return {
                name: langName,
                args: [...getGoArgsPref()],
                compiler: getGoCommand(),
                skipCompile: false,
            };
        }
        case 'hs': {
            return {
                name: langName,
                args: [...getHaskellArgsPref()],
                compiler: getHaskellCommand(),
                skipCompile: false,
            };
        }
    }
    throw new Error('Invalid State');
};

export const isValidLanguage = (srcPath: string): boolean => {
    return config.supportedExtensions.includes(
        path.extname(srcPath).split('.')[1],
    );
};

export const isCodeforcesUrl = (url: URL): boolean => {
    return url.hostname === 'codeforces.com';
};

export const ocAppend = (string: string) => {
    oc.append(string);
};

export const ocWrite = (string: string) => {
    oc.clear();
    oc.append(string);
};

export const ocShow = () => {
    oc.show();
};

export const ocHide = () => {
    oc.clear();
    oc.hide();
};

export const randomId = () => Math.floor(Date.now() + Math.random() * 100);

/**
 * Check if file is supported. If not, shows an error dialog. Returns true if
 * unsupported.
 */
export const checkUnsupported = (srcPath: string): boolean => {
    if (!isValidLanguage(srcPath)) {
        vscode.window.showErrorMessage(
            `Unsupported file extension. Only these types are valid: ${config.supportedExtensions}`,
        );
        return true;
    }
    return false;
};

/** Deletes the .prob problem file for a given source code path. */
export const deleteProblemFile = (srcPath: string) => {
    globalThis.reporter.sendTelemetryEvent(telmetry.DELETE_ALL_TESTCASES);
    const probPath = getProbSaveLocation(srcPath);
    try {
        if (platform() === 'win32') {
            spawn('del', [probPath]);
        } else {
            spawn('rm', [probPath]);
        }
    } catch (error) {
        console.error('Error while deleting problem file ', error);
    }
};

export const getProblemForDocument = (
    document: vscode.TextDocument | undefined,
): Problem | undefined => {
    if (document === undefined) {
        return undefined;
    }

    const srcPath = document.fileName;
    const probPath = getProbSaveLocation(srcPath);
    if (!existsSync(probPath)) {
        return undefined;
    }
    const problem: Problem = JSON.parse(readFileSync(probPath).toString());
    return problem;
};

export const readFromDOMjudgeZip = async () => {
    const currentDocument = vscode.window.activeTextEditor?.document;

    const problem = getProblemForDocument(currentDocument);

    if (!problem) {
        // Show a warning message if no problem is associated with the current document
        vscode.window.showWarningMessage(
            'No problem found for the current document.',
        );
        return; // Optionally return from the function if you don't want to proceed further
    }

    // Open a file-picker to let the user select the ZIP file
    const options: vscode.OpenDialogOptions = {
        canSelectMany: false,
        canSelectFolders: false,
        canSelectFiles: true,
        title: 'Select a DOMjudge samples ZIP file',
        openLabel: 'Open',
        filters: {
            'Zip files': ['zip'],
        },
    };

    const fileUri = await vscode.window.showOpenDialog(options);
    if (fileUri && fileUri[0]) {
        const zipFileUri = fileUri[0];
        const zipData = await vscode.workspace.fs.readFile(zipFileUri);
        const zip = new JSZip();
        await zip.loadAsync(zipData);

        // Create an object to hold matching input and output files
        const testCases: Record<string, TestCase> = {};

        // Iterate through each file in the ZIP
        zip.forEach((relativePath, file) => {
            if (!file.dir) {
                const fileExtension = relativePath.split('.').pop();
                const fileNameRaw = relativePath.replace(/\.\w+$/, '');

                file.async('string').then((content) => {
                    if (!testCases[fileNameRaw]) {
                        testCases[fileNameRaw] = {
                            input: '',
                            output: '',
                            id: Date.now(),
                        };
                    }

                    if (fileExtension === 'in') {
                        testCases[fileNameRaw].input = content;
                    } else if (fileExtension === 'out') {
                        testCases[fileNameRaw].output = content;
                    }

                    // Check if both input and output are set, then send to webview
                    if (
                        testCases[fileNameRaw].input &&
                        testCases[fileNameRaw].output
                    ) {
                        getJudgeViewProvider().extensionToJudgeViewMessage({
                            command: 'new-case',
                            testcase: testCases[fileNameRaw],
                        });
                    }
                });
            }
        });
    } else {
        vscode.window.showInformationMessage('No file selected.');
    }
};
