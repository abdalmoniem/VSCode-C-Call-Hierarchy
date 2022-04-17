/**
 * file: extension.js
 * 
 * date: 03-Apr-22
 * 
 * author: AbdAlMoniem AlHifnawy
 * 
 * description: main extension file that executes extension functionalities
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zip from 'adm-zip';
import * as https from 'https';
import * as vscode from 'vscode';
import { lookpath } from 'lookpath';
import * as callHierarchyProvider from './cCallHierarchyProvider';

let outputChannel: vscode.OutputChannel;
let statusbarItem: vscode.StatusBarItem;
let extensionContext: vscode.ExtensionContext;

enum FormatterStatus {
	RECHECK = "sync",
	ERROR = "alert",
	DISABLED = "circle-slash"
}

export async function activate(context: vscode.ExtensionContext) {
	extensionContext = context;

	outputChannel = vscode.window.createOutputChannel("C Call Hierarchy");
	statusbarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);

	outputChannel.appendLine('activating C Call Hierarchy...');
	context.subscriptions.push(vscode.commands.registerCommand('cCallHierarchy.resolveDependencies', async () => await resolveDependencies()));

	if (await resolveDependencies()) {
		await initializeSubscriptions();
	}
	outputChannel.appendLine('C Call Hierarchy activated!');
}

export function deactivate() { }

export async function resolveDependencies(): Promise<boolean> {
	let dependenciesFound = false;

	if (process.platform === 'win32') {
		if ((await lookpath(`${process.env.USERPROFILE!}/c-call-hierarchy/cscope/cscope.exe`, { env: process.env })) &&
			(await lookpath(`${process.env.USERPROFILE!}/c-call-hierarchy/ctags/ctags.exe`, { env: process.env })) &&
			(await lookpath(`${process.env.USERPROFILE!}/c-call-hierarchy/ctags/readtags.exe`, { env: process.env }))) {
			callHierarchyProvider.setCSCOPE_PATH(`${process.env.USERPROFILE!}/c-call-hierarchy/cscope/cscope.exe`);
			callHierarchyProvider.setCTAGS_PATH(`${process.env.USERPROFILE!}/c-call-hierarchy/ctags/ctags.exe`);
			callHierarchyProvider.setREADTAGS_PATH(`${process.env.USERPROFILE!}/c-call-hierarchy/ctags/readtags.exe`);

			dependenciesFound = true;
		}
	}

	if ((await lookpath(callHierarchyProvider.getCSCOPE_PATH())) &&
		(await lookpath(callHierarchyProvider.getCTAGS_PATH())) &&
		(await lookpath(callHierarchyProvider.getREADTAGS_PATH()))) {
		dependenciesFound = true;
	}

	if (!dependenciesFound) {
		if (await vscode.window.showWarningMessage(
			'CSCOPE or CTAGS are not installed on your system, do you want to download and install them?', 'Yes', 'No') === 'Yes') {
			if (process.platform === 'win32') {
				await installCSCOPE_CTAGS();

				await resolveDependencies();
			} else {
				// install cscope / ctags on a linux / unix platform
				if (await vscode.window.showInformationMessage(
					'Please use your native package manager to install cscope & universal-ctags', 'copy dependencies', 'dismiss') === 'copy dependencies') {
					await vscode.env.clipboard.writeText('install cscope universal-ctags');

					updateStatusbar(true, FormatterStatus.RECHECK);
				} else {
					updateStatusbar(true, FormatterStatus.ERROR);
				}
			}
		} else {
			// callHierarchyProvider.showMessageWindow('Extension deactivated, dependencies not found!!!', callHierarchyProvider.LogLevel.ERROR);

			updateStatusbar(true, FormatterStatus.DISABLED);
		}
	} else {
		await initializeSubscriptions();

		updateStatusbar(false);
	}

	return dependenciesFound;
}

export function updateStatusbar(show: boolean, status?: FormatterStatus): void {
	if (show) {
		statusbarItem.color = '#ff0000';
		statusbarItem.command = 'cCallHierarchy.resolveDependencies';
		statusbarItem.text = `${status === undefined ? '!' : `$(${status.toString()})`} Install CSCOPE & CTAGS`;
		statusbarItem.tooltip = 'Install CSCOPE & CTAGS utilities';
		statusbarItem.accessibilityInformation = { label: 'Install CSCOPE & CTAGS utilities' };
		statusbarItem.show();
	} else {
		statusbarItem.hide();
	}
}

export async function initializeSubscriptions() {
	await vscode.commands.executeCommand('setContext', 'enableCommands', true);
	const cCallHierarchyProvider = new callHierarchyProvider.CCallHierarchyProvider();
	const commands = await vscode.commands.getCommands(true);

	extensionContext.subscriptions.push(
		!commands.includes('cCallHierarchy.build') ?
			vscode.commands.registerCommand('cCallHierarchy.build',
				async () => await callHierarchyProvider.buildDatabase(callHierarchyProvider.DatabaseType.BOTH)) :
			new vscode.Disposable(() => undefined),
		!commands.includes('cCallHierarchy.showIncludeHierarchy') ?
			vscode.commands.registerCommand('cCallHierarchy.showIncludeHierarchy',
				async () => await vscode.commands.executeCommand('references-view.showCallHierarchy')) :
			new vscode.Disposable(() => undefined),
		vscode.languages.registerCallHierarchyProvider(
			{
				scheme: 'file',
				language: 'c'
			},
			cCallHierarchyProvider
		),
		vscode.languages.registerCallHierarchyProvider(
			{
				scheme: 'file',
				language: 'cpp'
			},
			cCallHierarchyProvider
		)
	);
}

export async function installCSCOPE_CTAGS() {
	if (!fs.existsSync(`${process.env.USERPROFILE!}/c-call-hierarchy`)) {
		fs.mkdir(path.resolve(`${process.env.USERPROFILE!}/c-call-hierarchy`), (err) => {
			if (err) {
				return console.error(err);
			}
			console.info(`Directory "${path.resolve(process.env.USERPROFILE!)}/c-call-hierarchy" was created successfully!`);
		});
	} else {
		console.info(`Directory "${path.resolve(process.env.USERPROFILE!)}/c-call-hierarchy" exists, skipping creation!`);
	}

	const cscopeDownloadPath = await download('https://github.com/abdalmoniem/VSCode-C-Call-Hierarchy/releases/download/v1.7.4/cscope.zip', `${process.env.USERPROFILE}/c-call-hierarchy/cscope.zip`);

	const ctagsDownloadPath = await download('https://github.com/abdalmoniem/VSCode-C-Call-Hierarchy/releases/download/v1.7.4/ctags.zip', `${process.env.USERPROFILE}/c-call-hierarchy/ctags.zip`);

	const cscopeZipFile = new zip(cscopeDownloadPath);
	outputChannel.appendLine(`extracting ${cscopeDownloadPath}...\n`);
	cscopeZipFile.extractAllTo(path.dirname(cscopeDownloadPath), true, true);
	// outputChannel.appendLine(`extracted ${cscopeDownloadPath} to ${path.resolve(path.dirname(cscopeDownloadPath))}\n`);

	const ctagsZipFile = new zip(ctagsDownloadPath);
	outputChannel.appendLine(`extracting ${ctagsDownloadPath}...\n`);
	ctagsZipFile.extractAllTo(path.dirname(ctagsDownloadPath), true, true);
	// outputChannel.appendLine(`extracted ${ctagsDownloadPath} to ${path.resolve(path.dirname(ctagsDownloadPath))}\n`);

	outputChannel.appendLine(`removing ${cscopeDownloadPath}...\n`);
	fs.unlinkSync(cscopeDownloadPath);
	// outputChannel.appendLine(`removed ${cscopeDownloadPath}\n`);

	outputChannel.appendLine(`removing ${ctagsDownloadPath}...\n`);
	fs.unlinkSync(ctagsDownloadPath);
	// outputChannel.appendLine(`removed ${ctagsDownloadPath}\n`);

	callHierarchyProvider.setCSCOPE_PATH(path.resolve(`${process.env.USERPROFILE!}/c-call-hierarchy/cscope/cscope.exe`));
	callHierarchyProvider.setCTAGS_PATH(path.resolve(`${process.env.USERPROFILE!}/c-call-hierarchy/ctags/ctags.exe`));
	callHierarchyProvider.setREADTAGS_PATH(path.resolve(`${process.env.USERPROFILE!}/c-call-hierarchy/ctags/readtags.exe`));
}

export async function download(url: string, downloadPath: string): Promise<string> {
	outputChannel.show();
	outputChannel.appendLine(`downloading ${url} to ${path.resolve(downloadPath)}\n`);

	return new Promise((resolve, reject) => {
		https.get(url, response => {
			if (response.statusCode === 302) {
				outputChannel.appendLine(`${url} redirected to ${response.headers.location!}\n`);
				resolve(download(response.headers.location!, downloadPath));
			} else {
				if (response.statusCode !== 200) {
					return reject(`Download Error: ${response.statusCode}`);
				}

				const writeStream = fs.createWriteStream(downloadPath);
				response.pipe(writeStream);

				writeStream.on('error', () => reject('Error writing to file!'));
				writeStream.on('finish', () => {
					writeStream.close();
					resolve(path.resolve(downloadPath));
				});
			}
		});
	});
}
