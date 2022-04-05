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
import * as vscode from 'vscode';
import * as process from 'child_process';

enum ClickJumpLocation {
	SymbolDefinition = 'Symbol Definition',
	SymboldCall = 'Symbol Call'
}

enum LogLevel {
	INFO,
	WARN,
	ERROR
}

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.commands.registerCommand('cCallHierarchy.build', buildDatabase));

	vscode.languages.registerCallHierarchyProvider(
		{
			scheme: 'file',
			language: 'c'
		},
		new CCallHierarchyProvider());

	vscode.languages.registerCallHierarchyProvider(
		{
			scheme: 'file',
			language: 'cpp'
		},
		new CCallHierarchyProvider());
}

export function deactivate() { }

class FuncInfo {
	name: string;
	fileName: string;
	description: string;
	position: number;

	constructor(name?: string, fileName?: string, position?: number) {
		this.name = name ?? '';
		this.fileName = fileName ?? '';
		this.position = position ?? -1;

		this.description = '';
	}

	public static convertToFuncInfo(line: string): FuncInfo {
		let lineSplit = line.split(/\s+/);
		return new FuncInfo(lineSplit[1], lineSplit[0], Number(lineSplit[2]));
	}

	public getFileName(): string {
		let folders = this.fileName.split(/[\\/]/);

		return folders.slice(-1)[0];
	}
}

export class CCallHierarchyProvider implements vscode.CallHierarchyProvider {
	private readonly cwd: string;

	constructor() {
		this.cwd = getWorkspaceRootPath();
	}

	async prepareCallHierarchy(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken): Promise<vscode.CallHierarchyItem | vscode.CallHierarchyItem[] | null | undefined> {
		if (!token.isCancellationRequested) {
			if (!fs.existsSync(`${this.cwd}/cscope.out`)) {
				showMessageWindow(`Database doesn't exist, rebuilding...`);
				await buildDatabase();
			}

			let wordRange = document.getWordRangeAtPosition(position);

			if (wordRange !== undefined) {
				let funcName: string = document.getText(wordRange);
				let definition = await doCLI(`cscope -d -f cscope.out -L1 ${funcName}`);

				if (definition.length > 0) {
					let funcInfo = FuncInfo.convertToFuncInfo(definition as string);

					let config = vscode.workspace.getConfiguration('ccallhierarchy');
					let canShowFileNames = config.get('showFileNamesInSearchResults');
					let clickJumpLocation = config.get('clickJumpLocation');

					let functionRange = wordRange;

					let fileLocation = vscode.Uri.file(`${document.fileName}`);

					let fileName = document.fileName.split(/[\\/]/).slice(-1)[0];

					let description = `${canShowFileNames ? fileName : ''} @ ${(position.line + 1).toString()}`;

					if (clickJumpLocation === ClickJumpLocation.SymbolDefinition) {
						let functionPosition = new vscode.Position(funcInfo.position - 1, 0);
						functionRange = new vscode.Range(functionPosition, functionPosition);

						fileLocation = vscode.Uri.file(`${this.cwd}/${funcInfo.fileName}`);

						description = `${canShowFileNames ? funcInfo.getFileName() : ''} @ ${funcInfo.position.toString()}`;
					}

					let item = new vscode.CallHierarchyItem(
						await getSymbolKind(funcName),
						funcName,
						description,
						fileLocation,
						functionRange,
						functionRange);

					return item;
				}
			}
		}
	}

	async provideCallHierarchyIncomingCalls(
		item: vscode.CallHierarchyItem,
		token: vscode.CancellationToken): Promise<vscode.CallHierarchyIncomingCall[] | null | undefined> {
		if (!token.isCancellationRequested) {
			let incomingCalls: Array<vscode.CallHierarchyIncomingCall> = new Array();

			let callers = await findCallers(item.name);

			for (let callerItem of callers) {
				let ranges: Array<vscode.Range> = new Array();

				let config = vscode.workspace.getConfiguration('ccallhierarchy');
				let canShowFileNames = config.get('showFileNamesInSearchResults');
				let clickJumpLocation = config.get('clickJumpLocation');

				let callerItemPosition = new vscode.Position(callerItem.position - 1, 0);

				let fileLocation = vscode.Uri.file(`${this.cwd}/${callerItem.fileName}`);

				let description = `${canShowFileNames ? callerItem.getFileName() : ''} @ ${callerItem.position.toString()}`;

				if (clickJumpLocation === ClickJumpLocation.SymbolDefinition) {
					let definition = await doCLI(`cscope -d -f cscope.out -L1 ${callerItem.name}`);

					if (definition.length > 0) {
						let funcInfo = FuncInfo.convertToFuncInfo(definition as string);

						callerItemPosition = new vscode.Position(funcInfo.position - 1, 0);

						fileLocation = vscode.Uri.file(`${this.cwd}/${funcInfo.fileName}`);

						description = `${canShowFileNames ? funcInfo.getFileName() : ''} @ ${funcInfo.position.toString()}`;
					}
				}

				let callerItemRange = new vscode.Range(callerItemPosition, callerItemPosition);

				let fromCaller = new vscode.CallHierarchyItem(
					await getSymbolKind(callerItem.name),
					callerItem.name,
					description,
					fileLocation,
					callerItemRange,
					callerItemRange);

				ranges.push(callerItemRange);

				incomingCalls.push(new vscode.CallHierarchyIncomingCall(fromCaller, ranges));
			}

			return incomingCalls;
		}
	}

	async provideCallHierarchyOutgoingCalls(
		item: vscode.CallHierarchyItem,
		token: vscode.CancellationToken): Promise<vscode.CallHierarchyOutgoingCall[] | null | undefined> {
		if (!token.isCancellationRequested) {
			let outgoingCalls: Array<vscode.CallHierarchyOutgoingCall> = new Array();

			let callees = await findCallees(item.name);

			for (let calleeItem of callees) {
				let ranges: Array<vscode.Range> = new Array();

				let config = vscode.workspace.getConfiguration('ccallhierarchy');
				let canShowFileNames = config.get('showFileNamesInSearchResults');
				let clickJumpLocation = config.get('clickJumpLocation');

				let calleeItemPosition = new vscode.Position(calleeItem.position - 1, 0);

				let fileLocation = vscode.Uri.file(`${this.cwd}/${calleeItem.fileName}`);

				let description = `${canShowFileNames ? calleeItem.getFileName() : ''} @ ${calleeItem.position.toString()}`;

				if (clickJumpLocation === ClickJumpLocation.SymbolDefinition) {
					let definition = await doCLI(`cscope -d -f cscope.out -L1 ${calleeItem.name}`);

					if (definition.length > 0) {
						let funcInfo = FuncInfo.convertToFuncInfo(definition as string);

						calleeItemPosition = new vscode.Position(funcInfo.position - 1, 0);

						fileLocation = vscode.Uri.file(`${this.cwd}/${funcInfo.fileName}`);

						description = `${canShowFileNames ? funcInfo.getFileName() : ''} @ ${funcInfo.position.toString()}`;
					}
				}

				let calleeItemRange = new vscode.Range(calleeItemPosition, calleeItemPosition);

				let toCallee = new vscode.CallHierarchyItem(
					await getSymbolKind(calleeItem.name),
					calleeItem.name,
					description,
					fileLocation,
					calleeItemRange,
					calleeItemRange);

				ranges.push(calleeItemRange);

				outgoingCalls.push(new vscode.CallHierarchyOutgoingCall(toCallee, ranges));
			}

			return outgoingCalls;
		}
	}
}

export async function buildDatabase() {
	vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		// location: vscode.ProgressLocation.Window,
		// title: "Database Build",
		// cancellable: true
	}, async (progress/* , token */) => {
		// token.onCancellationRequested(() => {
		// 	console.log("User canceled the long running operation");
		// });

		progress.report({ increment: 0, message: "Building Database..." });

		// showMessageWindow('Building Database...');

		await doCLI(`cscope -Rcbf cscope.out`);

		await delay(500);

		progress.report({ increment: 50, message: "Building ctags database..." });

		await doCLI(`ctags --fields=+i -Rno ctags.out`);

		await delay(500);

		progress.report({ increment: 100, message: "Finished building database" });

		await delay(1500);

		// showMessageWindow('Finished building database');
	});
}

export async function findCallers(funcName: string): Promise<Array<FuncInfo>> {
	let callers: Array<FuncInfo> = new Array();

	let data: string = await doCLI(`cscope -d -f cscope.out -L3 ${funcName}`) as string;

	let lines = data.split('\n');

	for (let line of lines) {
		if (line.length > 0) {
			let funcInfo = FuncInfo.convertToFuncInfo(line);
			callers.push(funcInfo);
		}
	}

	return callers;
}

export async function findCallees(funcName: string): Promise<Array<FuncInfo>> {
	let callees: Array<FuncInfo> = new Array();

	let data: string = await doCLI(`cscope -d -f cscope.out -L2 ${funcName}`) as string;

	let lines = data.split('\n');

	for (let line of lines) {
		if (line.length > 0) {
			let funcInfo = FuncInfo.convertToFuncInfo(line);
			callees.push(funcInfo);
		}
	}

	return callees;
}

export async function getSymbolKind(symbolName: string): Promise<vscode.SymbolKind> {
	let data = await doCLI(`readtags -t ctags.out -F "(list $name \\" \\" $input \\" \\" $line \\" \\" $kind #t)" ${symbolName}`);

	let lines = data.split(/\n/);

	let kind: vscode.SymbolKind = vscode.SymbolKind.Constant;

	for (let line of lines) {
		let fields = line.split(/\s+/);

		if (fields.length >= 4) {
			switch (fields[3]) {
				case 'd':
					kind = vscode.SymbolKind.Constant;
					break;
				case 'e':
					kind = vscode.SymbolKind.Enum;
					break;
				case 'f':
					kind = vscode.SymbolKind.Function;
					break;
				case 'g':
					kind = vscode.SymbolKind.EnumMember;
					break;
				case 'h':
					kind = vscode.SymbolKind.File;
					break;
				case 'l':
					kind = vscode.SymbolKind.Variable;
					break;
				case 'm':
					kind = vscode.SymbolKind.Field;
					break;
				case 'p':
					kind = vscode.SymbolKind.Function;
					break;
				case 's':
					kind = vscode.SymbolKind.Struct;
					break;
				case 't':
					kind = vscode.SymbolKind.Class;
					break;
				case 'u':
					kind = vscode.SymbolKind.Struct;
					break;
				case 'v':
					kind = vscode.SymbolKind.Variable;
					break;
				case 'x':
					kind = vscode.SymbolKind.Variable;
					break;
				case 'z':
					kind = vscode.SymbolKind.TypeParameter;
					break;
				case 'L':
					kind = vscode.SymbolKind.Namespace;
					break;
				case 'D':
					kind = vscode.SymbolKind.TypeParameter;
					break;
				default:
					kind = vscode.SymbolKind.Class;
					break;
			}
		}
	}

	return kind;
}

export async function doCLI(command: string): Promise<string> {
	let dir = getWorkspaceRootPath();

	return new Promise((resolve, reject) => {
		process.exec(
			command,
			{ cwd: dir },
			(error: process.ExecException | null, stdout: string, stderr: string) => {
				if (error) {
					showMessageWindow(`exec error: ${error}`, LogLevel.ERROR);
					showMessageWindow(stderr, LogLevel.ERROR);
					reject(stderr);
				} else {
					resolve(stdout);
				}
			});
	});
}

export function getWorkspaceRootPath(): string {
	return vscode.workspace.workspaceFolders !== undefined ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
}

export function showMessageWindow(msg: string, logLevl: LogLevel = LogLevel.INFO) {
	let config = vscode.workspace.getConfiguration('ccallhierarchy');
	let canShowMessages = config.get('showMessages');

	if (canShowMessages) {
		switch (logLevl) {
			case LogLevel.INFO:
				vscode.window.showInformationMessage(msg);
				break;
			case LogLevel.WARN:
				vscode.window.showWarningMessage(msg);
				break;
			case LogLevel.ERROR:
				vscode.window.showErrorMessage(msg);
				break;
			default:
				break;
		}
	}
}

export async function delay(ms: number) {
	return new Promise( resolve => setTimeout(resolve, ms) );
}